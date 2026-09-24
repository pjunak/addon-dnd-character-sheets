import type { Inputs, Result } from "./character-model.js";
import { builderLabel, translator } from "./character-locale.js";
import { abilities, newId, object, rows, strings, type CatalogRecord } from "./character-client.js";
import { builderTarget, button, combo, el, field, human, label, panel, refreshSteppers, rule, select, stepper, styled, type Option } from "./character-ui.js";

export interface BuildView {
  locale: string; input: Inputs; evaluation: Result | undefined; policy: Record<string, unknown>; catalogs: Map<string, CatalogRecord[]>;
  changed(): void; refresh(): void; navigate?(tab: string): void;
}
const options = (records: readonly CatalogRecord[]): Option[] => records.map(record => ({ id: record.id, label: String(record.value["name"] ?? record.id), description: String(record.value["summary"] ?? record.value["text"] ?? "").slice(0, 1200) }));
export const guidanceOptions = (value: unknown, locale = "en"): Option[] => rows(value).map(row => ({ id: String(row["id"]), label: row["labelKey"] ? builderLabel(row, locale) : String(row["label"] ?? row["name"] ?? row["id"]), description: String(row["description"] ?? "") }));
export function buildView(view: BuildView, active = "character"): HTMLElement {
  const t = translator(view.locale), { input, policy } = view, build = input.build, root = styled("div", "character-build");
  const plan = view.evaluation?.plan ?? {}, guidance = object(view.evaluation?.guidance["choices"]);
  const update = (action: () => void, render = false): void => { action(); view.changed(); refreshSteppers(root); if (render) view.refresh(); };
  if (active === "character") {
    const foundation = panel(t("Character")); foundation.classList.add("character-foundation");
    const pointBuy = object(plan["pointBuy"]), costs = object(pointBuy["cost"]), minimum = Number(pointBuy["min"]), maximum = Number(pointBuy["max"]), budget = Number(pointBuy["budget"]);
    const method = select(build.method, ["point-buy", "array", "rolled"].map(id => ({ id, label: t(label(id)) })), value => {
      if (!value) return;
      update(() => {
        build.method = value; build.rolls = []; build.baseScores = {};
        if (value === "point-buy" && Number.isFinite(minimum)) for (const ability of abilities) build.baseScores[ability] = minimum;
        if (value === "array") abilities.forEach((ability,index) => { build.baseScores[ability] = Number((policy["standardArray"] as number[])[index]); });
      }, true);
    }, t);
    foundation.append(field(t("Creation method"), method));
    const scores = styled("div", "character-stats"); scores.dataset["builderTarget"] = "abilities";
    const spent = (): number => abilities.reduce((sum,ability) => sum + Number(costs[String(build.baseScores[ability] ?? minimum)] ?? 0),0);
    const progress = styled("p", "dnd-builder-progress"); progress.setAttribute("role","status");
    const refreshBudget = (): void => { progress.textContent = t("{0} / {1} points used · {2} remaining", [spent(),budget,budget-spent()]); };
    for (const ability of abilities) {
      if (build.method === "point-buy" && Number.isFinite(minimum) && Number.isFinite(maximum)) {
        const limit = (): number => { const current = build.baseScores[ability] ?? minimum; let allowed = current; for (let next = current+1; next<=maximum; next++) if (spent()-Number(costs[String(current)])+Number(costs[String(next)])<=budget) allowed=next; return allowed; };
        scores.append(field(ability, stepper(() => build.baseScores[ability] ?? minimum, value => update(() => { for (const key of abilities) build.baseScores[key] ??= minimum; build.baseScores[ability] = value; refreshBudget(); }),minimum,limit)));
      } else if (build.method === "array") {
        const array = (policy["standardArray"] ?? []) as number[];
        scores.append(field(ability, select(String(build.baseScores[ability] ?? ""), [...new Set(array)].map(score => ({ id: String(score), label: String(score) })), value => {
          if (!value) return; update(() => { const other = abilities.find(key => key !== ability && build.baseScores[key] === Number(value)); if (other) { const prior=build.baseScores[ability]; if(prior===undefined) delete build.baseScores[other]; else build.baseScores[other]=prior; } build.baseScores[ability]=Number(value); },true);
        },t)));
      } else if (build.method === "rolled") {
        const dice = build.rolls.find(roll => roll.ability === ability)?.dice ?? Array.from({length:Number(policy["rollDice"] ?? 0)},()=>1);
        const group = panel(ability), result = el("strong", human(build.baseScores[ability]));
        dice.forEach((_,index) => group.append(field(t("Die {0}",[index+1]),stepper(()=>dice[index]!,value=>update(()=>{
          dice[index]=value;
          const kept=dice.map((value,index)=>({value,index})).sort((a,b)=>b.value-a.value||a.index-b.index).slice(0,Number(policy["rollKeep"])).map(row=>row.index);
          build.rolls=build.rolls.filter(roll=>roll.ability!==ability); build.rolls.push({id:newId(),ability,dice:[...dice],kept});
          build.baseScores[ability]=kept.reduce((sum,index)=>sum+dice[index]!,0); result.textContent=String(build.baseScores[ability]);
        }),1,Number(policy["rollSides"])))));
        group.append(result); scores.append(group);
      }
    }
    foundation.append(scores);
    if (build.method === "point-buy" && Number.isFinite(budget)) { refreshBudget(); foundation.append(progress); }
    for (const kind of ["species", "background"] as const) {
      const records = view.catalogs.get(kind) ?? [], choice = combo(build[kind], options(records), value => update(() => { build[kind] = value; if(kind === "species") build.lineage=""; },true),t);
      const source = field(t(label(kind)),choice); source.dataset["builderTarget"]=kind; foundation.append(source);
      const selected = records.find(record => record.id === build[kind]);
      if (kind === "species" && selected && rows(selected.value["lineages"]).length) foundation.append(builderTarget("lineage",field(t("Lineage"),combo(build.lineage,guidanceOptions(selected.value["lineages"]),value=>update(()=>{build.lineage=value;},true),t))));
    }
    root.append(foundation);
    const choices = panel(t("Granted choices"));
    for (const repair of unassignedFeatChoices(view, rows(plan["creationChoices"]), guidance)) choices.append(repair);
    for (const key of ["creationChoices", "creationAbilityChoices"]) for (const descriptor of rows(plan[key])) choices.append(choiceView(descriptor,object(guidance[String(descriptor["id"])]),view));
    if (choices.children.length>1) root.append(choices);
    return root;
  }
  const classes = rows(view.evaluation?.guidance["classes"]), available = guidanceOptions(view.evaluation?.guidance["classOptions"]);
  const add = (classId: string): void => update(()=>{build.levels.push({id:newId(),classId}); view.navigate?.(classId);},true);
  if (active === "add-class") {
    const existing = new Set(build.levels.map(level=>level.classId)), eligible = available.filter(option=>!existing.has(option.id));
    root.append(builderTarget("add-class",field(t("Add class"),combo("",eligible,add,t))));
    if (!eligible.length) root.append(el("p",t("No additional classes meet the rules at this level.")));
    return root;
  }
  const remove = (index: number): void => update(()=>{
    build.levels.splice(index,1);
    const counts = new Map<string,number>(); for(const level of build.levels) counts.set(level.classId,(counts.get(level.classId)??0)+1);
    for(const descriptor of rows(plan["classChoices"])) if (Number(object(descriptor["source"])["level"] ?? descriptor["level"] ?? 1)>(counts.get(String(descriptor["classId"]))??0)) {
      const id=String(descriptor["id"]); build.choices=build.choices.filter(choice=>choice.id!==id&&!choice.id.startsWith(id+":"));
    }
    for(const id of Object.keys(build.subclasses)) if (!counts.has(id) || (counts.get(id)??0)<Number(classes.find(row=>row["classId"]===id)?.["subclassLevel"])) delete build.subclasses[id];
    for(const selections of [build.spells.cantrips,build.spells.spellbook,input.play.preparedSpells]) for(const id of Object.keys(selections)) if(!counts.has(id)) delete selections[id];
  },true);
  const currentClass = classes.find(row=>row["classId"]===active), title = active === "levels" ? t("Levels") : String(currentClass?.["name"] ?? active), levels = panel(title);
  let classLevel=0;
  build.levels.forEach((level,index)=>{
    if(active!=="levels"&&level.classId!==active)return;
    classLevel++;
    const row = styled("details","dse-build-level"); row.open=true; row.id="character-level-"+encodeURIComponent(level.id); row.dataset["builderTarget"]="class:"+level.classId;
    const name=String((view.catalogs.get("class")??[]).find(record=>record.id===level.classId)?.value["name"]??level.classId);
    row.append(styled("summary","dse-build-level-head",el("strong",t("Level {0}",[active==="levels"?index+1:classLevel])),el("span",active==="levels"?name:t("Character level {0}",[index+1]))));
    if(active!=="levels") {
      for(const feature of rows(rows(currentClass?.["levels"]).find(value=>Number(value["level"])===classLevel)?.["features"]))row.append(rule(String(feature["label"]??feature["id"]),{kind:"feature",id:String(feature["id"])},undefined,String(feature["summary"]??"")));
      for(const descriptor of rows(plan["classChoices"]).filter(choice=>choice["classId"]===active&&Number(object(choice["source"])["level"]??choice["level"]??1)===classLevel))row.append(choiceView(descriptor,object(guidance[String(descriptor["id"])]),view));
      if(classLevel===Number(currentClass?.["subclassLevel"])&&rows(currentClass?.["subclasses"]).length)row.append(builderTarget("subclass:"+active,field(t("Subclass"),combo(build.subclasses[active]??"",guidanceOptions(currentClass?.["subclasses"]),value=>update(()=>{build.subclasses[active]=value;},true),t))));
      if(index>0) {
        row.append(field(t("HP gain"),select(level.hitPoints===undefined?"fixed":"rolled",[{id:"fixed",label:t("Fixed")},{id:"rolled",label:t("Recorded roll")}],value=>update(()=>{if(value==="rolled")level.hitPoints=1;else delete level.hitPoints;},true),t)));
        if(level.hitPoints!==undefined)row.append(field(t("Recorded hit-die roll"),stepper(()=>level.hitPoints!,value=>update(()=>{level.hitPoints=value;}),1,Number(currentClass?.["hitDieMax"]))));
      }
    }
    row.append(button(t("Remove level"),()=>remove(index),false)); levels.append(row);
  });
  if(active!=="levels") levels.append(button(t("Add level"),()=>add(active),!available.some(option=>option.id===active)));
  if(!build.levels.length) levels.append(el("p",t("Use + to choose your first class.")));
  root.append(levels); return root;
}

function unassignedFeatChoices(view: BuildView, descriptors: Record<string, unknown>[], guidance: Record<string, unknown>): HTMLElement[] {
  const t=translator(view.locale), result: HTMLElement[]=[], aliases=new Set(descriptors.map(row=>String(row["legacyId"]??"")).filter(Boolean));
  for(const alias of aliases) {
    if(!view.input.build.choices.some(choice=>choice.id===alias))continue;
    const owners=descriptors.filter(row=>row["legacyId"]===alias);
    const repair=panel(t("Assign saved feat choices")); repair.id=`character-choice-${encodeURIComponent(alias)}`;
    const available=owners.filter(row=>!view.input.build.choices.some(choice=>choice.id===row["id"])).map(row=>({
      id:String(row["id"]), label:builderLabel(object(guidance[String(row["id"])]),view.locale,String(row["name"]??row["id"]))
    }));
    repair.append(field(t("Granting source"),combo("",available,id=>{
      if(!id)return;
      view.input.build.choices=view.input.build.choices.map(choice=>choice.id===alias?{...choice,id}:choice);
      view.changed(); view.refresh();
    },t)));
    repair.append(button(t("Discard saved choices"),()=>{
      view.input.build.choices=view.input.build.choices.filter(choice=>choice.id!==alias);
      view.changed(); view.refresh();
    },false));
    result.push(repair);
  }
  return result;
}

function choiceView(descriptor: Record<string, unknown>, guidance: Record<string, unknown>, view: BuildView): HTMLElement {
  const t=translator(view.locale),id=String(descriptor["id"]),kind=String(descriptor["kind"]),root=panel(builderLabel(guidance,view.locale,String(descriptor["name"]??id)));root.id=`character-choice-${encodeURIComponent(id)}`;
  const current=(slot:number):unknown=>view.input.build.choices.find(choice=>choice.id===id&&choice.slot===slot)?.value;
  const set=(slot:number,value:unknown):void=>{view.input.build.choices=view.input.build.choices.filter(choice=>choice.id!==id||choice.slot!==slot);if(value!=="")view.input.build.choices.push({id,slot,value});view.changed();refreshSteppers(root);};
  if(kind==="abilityBudget"||descriptor["budget"]!==undefined) {
    const budget=Number(descriptor["budget"]),limit=Number(descriptor["perAbilityMax"]),eligible=Array.isArray(descriptor["eligible"])?strings(descriptor["eligible"]):[...abilities];
    const spent=():number=>Object.values(object(current(0))).reduce<number>((sum,value)=>sum+Number(value),0),progress=el("p");
    const refresh=():void=>{progress.textContent=t("{0} / {1} points used · {2} remaining",[spent(),budget,budget-spent()]);};refresh();root.append(progress);
    const scores=styled("div","character-stats");
    for(const ability of eligible)scores.append(field(ability,stepper(()=>Number(object(current(0))[ability]??0),value=>{set(0,{...object(current(0)),[ability]:value});refresh();},0,()=>Math.min(limit,budget-spent()+Number(object(current(0))[ability]??0)))));
    root.append(scores);
  } else if(kind==="asiMode") {
    const mode=String(current(0)??"");root.append(field(t("Advancement"),select(mode,[{id:"asi",label:t("Ability increases")},{id:"feat",label:t("Feat")}],value=>{view.input.build.choices=view.input.build.choices.filter(choice=>!choice.id.startsWith(id+":"));set(0,value);view.refresh();},t)));
    if(mode==="asi")root.append(choiceView({...object(descriptor["ability"]),kind:"abilityBudget"},{},view));
    if(mode==="feat") {const feat=object(descriptor["feat"]);root.append(choiceView({...feat,kind:"feat"},{options:guidance["featOptions"]},view));const ability=object(feat["ability"]);if(strings(ability["eligible"]).length)root.append(choiceView({...ability,kind:"abilityBudget"},{},view));}
  } else {
    const choices=guidanceOptions(guidance["options"],view.locale);
    for(let slot=0;slot<Number(descriptor["count"]??1);slot++) {
      const selection=field(t("Selection {0}",[slot+1]),combo(String(current(slot)??""),()=>choices.filter(option=>!view.input.build.choices.some(choice=>choice.id===id&&choice.slot!==slot&&choice.value===option.id)),value=>{set(slot,value);if(kind==="feat")view.refresh();},t));
      if(!choices.some(option=>option.id===current(slot)))selection.dataset["builderPending"]="";
      root.append(selection);
    }
  }
  return root;
}
