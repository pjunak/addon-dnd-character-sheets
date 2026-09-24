import type { Inputs, Projection, Result } from "./character-model.js";
import { object, rows, type CatalogRecord } from "./character-client.js";
import { translator } from "./character-locale.js";
import { builderTarget, button, checkbox, el, field, human, label, panel, rule, select, styled, textInput } from "./character-ui.js";

export function spellSourceLabel(sourceValue: unknown, locale = "en"): string {
  const source = object(sourceValue), acquired = object(source["acquisition"]), t = translator(locale);
  const name = String(source["name"] ?? label(String(source["id"] ?? source["type"] ?? "")));
  if (!acquired["id"]) return name;
  const owner = acquired["classId"] ? t(label(String(acquired["classId"]))) : String(acquired["name"] ?? acquired["id"]);
  return [name, owner, t("Level {0}", [acquired["level"]])].join(" · ");
}

// Every spell surface uses the same two native controls, enhanced by the host.
// Filtering is local presentation and never changes an authored selection.
export interface SpellFilterState { query: string; level: string }
export interface SpellPickerState extends SpellFilterState { open: boolean }
export function spellFilters(key: string, locale: string, changed: () => void, state: SpellFilterState = { query: "", level: "" }): {
  controls: HTMLElement; matches(name: string, level: unknown): boolean; report(shown: number): void;
} {
  const t = translator(locale), search = textInput(state.query, value => { state.query = value; changed(); }) as HTMLInputElement;
  search.type = "search"; search.dataset["ui"]="search";
  const level = select(state.level, [{id:"0",label:t("Cantrips")}, ...Array.from({length:9}, (_, i) => ({id:String(i+1),label:t("Level {0}",[i+1])}))], value => { state.level = value; changed(); }, t);
  level.options[0]!.textContent = t("All spell levels");
  const nameField = field(t("Filter spells"), search), levelField = field(t("Spell level"), level);
  nameField.dataset["uiKey"] = key+":name"; levelField.dataset["uiKey"] = key+":level";
  const status = el("p"); status.setAttribute("role","status"); status.setAttribute("aria-live","polite"); status.dataset["spellResults"] = "";
  return {
    controls: el("div", styled("div","dnd-workflow-controls",nameField,levelField),status),
    matches: (name, value) => name.toLocaleLowerCase(locale).includes(search.value.trim().toLocaleLowerCase(locale)) && (!level.value || String(value)===level.value),
    report: shown => { status.textContent = shown ? t("{0} spells shown",[shown]) : t("No matching spells."); },
  };
}

// Builder and Manage spells share selection, filtering and host-owned focus behavior.
export function spellPicker(title: string, key: string, ids: string[], selected: string[], maximum: number,
  catalog: CatalogRecord[], state: SpellPickerState, locale: string, changed: (ids: string[]) => void): HTMLElement {
  const t = translator(locale), summary = el("summary"), details = el("details", summary), list = el("fieldset");
  details.open = state.open; details.dataset["spellPicker"] = key;
  details.addEventListener("toggle", () => { if (details.isConnected) state.open = details.open; });
  const filters = spellFilters(key, locale, () => render(), state);
  const render = (): void => {
    summary.textContent = t("{0} ({1} selected)", [title, selected.length]);
    list.replaceChildren(el("legend", title));
    const shown = [...new Set([...selected, ...ids])].filter(id => {
      const record = catalog.find(record => record.id === id);
      return filters.matches(String(record?.value["name"] ?? id), record?.value["level"]);
    });
    filters.report(shown.length);
    for (const id of shown) {
      const record = catalog.find(record => record.id === id);
      const choice = checkbox(String(record?.value["name"] ?? id), selected.includes(id), checked => {
        if (checked && (selected.length >= maximum || !ids.includes(id))) return;
        selected = checked ? [...selected, id] : selected.filter(item => item !== id);
        changed(selected); render();
      });
      // ui.controls.v1 restores a replaced field's child control by this stable key.
      choice.dataset["uiKey"] = key + ":spell:" + id;
      const control = choice.querySelector<HTMLInputElement>("input")!;
      control.dataset["focusKey"] = choice.dataset["uiKey"];
      control.disabled = !selected.includes(id) && (selected.length >= maximum || !ids.includes(id));
      list.append(styled("div", "dnd-workflow-controls", choice, rule(t("Details"), { kind: "spell", id })));
    }
  };
  details.append(filters.controls, list); render(); return builderTarget(key, details);
}

export function markSpellRow(row: HTMLElement, id: string, catalog: CatalogRecord[]): HTMLElement {
  const spell = catalog.find(record => record.id===id);
  row.dataset["spellName"] = String(spell?.value["name"] ?? id);
  row.dataset["spellLevel"] = String(spell?.value["level"] ?? "");
  return row;
}

export function unassignedSpellState(input: Inputs, evaluation: Result | undefined, changed: () => void, locale: string): HTMLElement[] {
  if (!evaluation) return [];
  const t=translator(locale), panels: HTMLElement[]=[];
  const groups: [Record<string,unknown>,Record<string,unknown>[]][] = [
    [input.build.spells.grantChoices,rows(evaluation.spellOptions["pendingChoices"])],
    [input.build.spells.castingAbilities,rows(evaluation.spellOptions["castingAbilityChoices"])],
    [input.play.resourceUses,rows(evaluation.sheet["resources"])],
    [input.play.activeFeatures,rows(evaluation.sheet["activations"])],
  ];
  for (const [saved,descriptors] of groups) for (const [key,value] of Object.entries(saved)) {
    if (descriptors.some(row=>row["key"]===key)) continue;
    const owners=descriptors.filter(row=>row["legacyKey"]===key && !Object.hasOwn(saved,String(row["key"])));
    if (!owners.length && (Array.isArray(value) && !value.length || value===0 || value===false)) continue;
    const root=panel(t("Assign saved spell state"),el("p",key+": "+human(value)));
    root.dataset["spellRepair"]=key;
    if (owners.length) {
      const control=select("",owners.map(row=>({id:String(row["key"]),label:spellSourceLabel(row["source"],locale)})),id=>{
        if(!id)return; saved[id]=structuredClone(value); delete saved[key]; changed();
      },t);
      control.dataset["ui"]="combobox";
      const ownerField=field(t("Granting source"),control); ownerField.dataset["uiKey"]="spell-repair:"+key;
      root.append(ownerField);
    }
    root.append(button(t("Discard saved spell state"),()=>{delete saved[key];changed();}));
    panels.push(root);
  }
  return panels;
}

function savedSpellRule(projection: Projection | undefined, id: string, name: string): HTMLElement {
 return rule(name,{kind:"spell",id},undefined,undefined,projection);
}

export function grantedSpellsRead(projection: Projection | undefined, locale: string): HTMLElement | undefined {
 const grants=rows(object(projection?.sheet["spellcasting"])["granted"]),t=translator(locale);
 if(!grants.length)return;
 const root=panel(t("Granted spells"));
 for(const grant of grants) {
  const name=String(grant["name"]??grant["ref"]),row=el("p",savedSpellRule(projection,String(grant["ref"]),name)," · ",spellSourceLabel(grant["source"],locale)," · ",human(grant["castingAbility"]));
  row.dataset["spellName"]=name;row.dataset["spellLevel"]=String(grant["level"]??"");root.append(row);
 }
 return root;
}

export function savedSpellBook(input: Inputs, projection: Projection | undefined, locale: string): HTMLElement {
 const t=translator(locale),root=el("div");
 const filters=spellFilters("saved-spells",locale,()=>filter());
 const filter=():void=>{let shown=0;for(const row of root.querySelectorAll<HTMLElement>("[data-spell-name]")){row.hidden=!filters.matches(row.dataset["spellName"]!,row.dataset["spellLevel"]);if(!row.hidden)shown++;}filters.report(shown);};
 root.append(filters.controls);
 for(const [title,groups] of [["Cantrips",input.build.spells.cantrips],["Spellbook",input.build.spells.spellbook],["Prepared spells",input.play.preparedSpells]] as const)for(const [classId,ids] of Object.entries(groups)){
  const group=panel(t(title)+" · "+label(classId));
  for(const id of ids){const evidence=projection?.evidence.find(row=>row.reference.kind==="spell"&&row.reference.id===id),name=evidence?.name??id;
    const row=el("p",savedSpellRule(projection,id,name));row.dataset["spellName"]=name;row.dataset["spellLevel"]=String(evidence?.facts["level"]??"");group.append(row);
  }
  root.append(group);
 }
 const grants=grantedSpellsRead(projection,locale);if(grants)root.append(grants);
 filter();return root;
}
