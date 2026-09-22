import { grantedSpellsRead } from "./character-spells.js";
import { senseDetails } from "./character-sheet.js";
import type { Projection, State } from "./character-model.js";
import { translator } from "./character-locale.js";
import { abilities, object, rows } from "./character-client.js";
import { el, human, label, panel, rule } from "./character-ui.js";

export function projectionView(projection: Projection, locale = "en"): HTMLElement {
  const t = translator(locale);
  const sheet = projection.sheet, root = el("div"); root.className = "character-projection";
  const savedRule: typeof rule = (name, reference, explanation, summary) => {
    const node = rule(name, reference, explanation, summary) as HTMLElement & { details: Record<string, unknown> };
    const references = reference ? [reference] : explanation?.sources ?? [];
    const sources = projection.evidence.filter(source => references.some(ref => ref.kind === source.reference.kind && ref.id === source.reference.id));
    if (sources.length) node.details["savedSources"] = sources.map(({ reference, name, summary, hash }) => ({ reference, name, summary, hash }));
    return node;
  };
  if (sheet["status"] === "needs-choices") { root.append(panel(t("Calculated values"), rule(t("Needs a choice"), undefined, projection.explanations["status"]))); return root; }
  const stat = (name: string, path: string, value: unknown): HTMLElement => el("div", savedRule(name, undefined, projection.explanations[path]), el("strong", human(value)));
  const derived = object(sheet["derived"]), vitals = el("div"); vitals.className = "character-stats";
  for (const key of ["armorClass", "initiative", "speed", "proficiencyBonus", "maxHp"]) vitals.append(stat(t(label(key)), `derived.${key}`, derived[key]));
  root.append(vitals);
  const scores = el("div"); scores.className = "character-stats";
  for (const ability of abilities) { const score = object(object(sheet["abilities"])[ability]); scores.append(panel(ability, stat(t("Score"), `abilities.${ability}.score`, score["score"]), stat(t("Modifier"), `abilities.${ability}.mod`, score["mod"]))); }
  root.append(scores);
  for (const group of ["skills", "saves"]) {
    const list = el("dl"); list.className = "character-values";
    for (const [key, value] of Object.entries(object(sheet[group]))) { list.append(el("dt", savedRule(t(label(key)), group === "skills" ? { kind: "skill", id: key } : undefined, projection.explanations[`${group}.${key}.total`])), el("dd", human(object(value)["total"]))); }
    root.append(panel(t(label(group)), list));
  }
  root.append(senseDetails(projection,locale));
  for (const group of ["weapons", "spellcasting", "resources", "features"]) {
    const list = el("div");
    const prefix = group === "spellcasting" ? "spellcasting.perClass" : group;
    rows(group === "spellcasting" ? object(sheet[group])["perClass"] : sheet[group]).forEach((row, index) => {
      const name = String(row["name"] ?? row["key"] ?? row["id"] ?? t(label(group)));
      const id = row["ref"] ?? row["id"] ?? row["classId"];
      const source = object(row["source"]);
      const reference = group === "resources" && typeof source["id"] === "string" && typeof source["type"] === "string" ? { kind: source["type"], id: source["id"] } : typeof id === "string" ? { kind: group === "features" ? "feature" : group === "weapons" ? "weapon" : "class", id } : undefined;
      const details = el("details", el("summary", savedRule(name, reference)));
      const evidence = projection.evidence.find(entry => reference && entry.reference.kind === reference.kind && entry.reference.id === reference.id);
      if (evidence?.summary && group === "features") details.append(el("p", evidence.summary));
      const values = el("dl");
      for (const [key, value] of Object.entries(row)) { if (["id", "name", "key", "kind", "classId", "source", "ref", "text", "description", "legacyKey", "resourceKey"].includes(key)) continue; const path = group === "resources" ? `resources.${String(row["key"])}.${key}` : `${prefix}.${index}.${key}`; values.append(el("dt", savedRule(t(label(key)), undefined, projection.explanations[path])), el("dd", key === "recharge" ? rows(value).map(entry=>t("{0} rest: {1}", [t(label(String(entry["on"]))), entry["amount"] === "full" ? t("all uses") : human(entry["amount"])])).join("; ") : human(value))); }
      details.append(values); list.append(details);
    });
    if (list.children.length) root.append(panel(t(label(group)), list));
  }
  const granted=grantedSpellsRead(projection,locale); if(granted)root.append(granted);
  for (const group of ["languages", "resistances", "damageImmunities", "conditionImmunities", "traits"]) {
    if (human(sheet[group]) && sheet[group] !== undefined && (!Array.isArray(sheet[group]) || (sheet[group] as unknown[]).length > 0)) root.append(panel(t(label(group)), el("p", human(sheet[group]))));
  }
  const active = rows(sheet["activations"]).filter(row=>row["active"] && row["condition"]);
  if (active.length) root.append(panel(t("Active conditions"), ...active.map(row=>el("p", t("{0}: {1}", [human(row["name"]), human(row["condition"])])))));
  return root;
}

export function printCharacter(state: State, _revision: number, name: string, options: { spells: boolean; equipment: boolean; provenance: boolean }, locale = "en"): void {
  const t = translator(locale);
  const view = window.open("about:blank", "_blank", "popup,width=1000,height=850");
  if (!view) throw new Error("Allow the print window, then try again.");
  view.document.title = name;
  view.document.documentElement.lang = locale;
  const style = view.document.createElement("style"); style.textContent = "body{font:12pt system-ui;max-width:1000px;margin:2rem;color:#111;overflow-wrap:anywhere}h1,h2,h3,summary{break-after:avoid}section,details{margin-block:1rem}details,tr,dl{break-inside:avoid}p{white-space:pre-wrap;orphans:3;widows:3}small{display:block;margin-top:.25rem}dl{display:grid;grid-template-columns:1fr 2fr;gap:.35rem}dd{margin:0} .character-stats{display:flex;gap:1rem;flex-wrap:wrap}.character-stats>div{min-width:6rem}strong{display:block}button{display:none}@page{margin:15mm}@media print{body{margin:0;font-size:10pt}}"; view.document.head.append(style);
  const root = el("main", el("h1", name), el("p", t("Calculated with engine {0}. This print preserves the saved rules revision.", [state.rules.engineVersion])));
  const projection = structuredClone(state.projection);
  if (!options.spells) delete projection.sheet["spellcasting"];
  root.append(panel(t("Hit points"), el("p", t("Current: {0} / {1}. Temporary: {2}.", [state.inputs.play.hp, human(object(projection.sheet["derived"])["maxHp"]), state.inputs.play.temporaryHp]))));
  root.append(projectionView(projection, locale));
  if (options.equipment && state.inputs.play.inventory.some(item => item.quantity > 0)) root.append(panel(t("Equipment"), ...state.inputs.play.inventory.filter(item => item.quantity > 0).map(item => el("p", t("{0} × {1}; {2}{3}. {4}", [item.quantity, item.name, t(label(item.location)), item.attuned ? t("; attuned") : "", item.notes])))));
  const recordName = (kind: string, id: string): string => state.projection.evidence.find(source => source.reference.kind === kind && source.reference.id === id)?.name ?? id;
  if (options.spells) {
    const sections = [["Cantrips", state.inputs.build.spells.cantrips], ["Spellbook", state.inputs.build.spells.spellbook], ["Prepared spells", state.inputs.play.preparedSpells]] as const;
    for (const [title, groups] of sections) {
      const entries = Object.entries(groups).filter(([, ids]) => ids.length > 0);
      if (entries.length) root.append(panel(t(title), ...entries.map(([id, ids]) => el("p", `${recordName("class", id)}: ${ids.map(spell => recordName("spell", spell)).join(", ")}`))));
    }
  }
  if (state.inputs.grants.length) root.append(panel(t("DM given"), ...state.inputs.grants.map(grant => el("p", t("{0}: {1}; {2}; {3}; {4}", [grant.name, grant.reason, grant.actorId, grant.grantedAt, t(grant.active ? "active" : "revoked")])))));
  if (options.provenance) {
    const build = state.inputs.build;
    root.append(panel(t("Build decisions"), el("p", `${recordName("species", build.species)} · ${recordName("background", build.background)} · ${t(label(build.method))}`),
      el("p", human(build.baseScores)), ...build.levels.map((level, index) => el("p", t("Level {0}: {1}", [index + 1, recordName("class", level.classId)]))),
      ...build.choices.map(choice => el("p", `${choice.id} (${choice.slot + 1}): ${human(choice.value)}`))), panel(t("Rules revision"), el("p", human(state.rules))));
    if (build.spells.acquisitions.length) root.append(panel(t("Spell acquisitions"), ...build.spells.acquisitions.map(entry => el("p", `${recordName("spell", entry.spellId)} · ${entry.costGp} GP · ${entry.origin === "import" ? t("Imported claim") : t("Recorded")}`))));
    root.append(panel(t("Sources"), ...state.projection.evidence.map(source => el("p", t("{0} ({1}:{2}), {3}, {4}", [source.name, source.reference.kind, source.reference.id, source.book ?? "", source.hash]),
      ...(source.packageId ? [el("small", `${t("Source package")}: ${source.packageId} · ${source.packageGeneration ?? ""}`)] : [])))));
  }
  // Print is frozen text from the saved character; no provider is contacted.
  for (const details of root.querySelectorAll("details")) details.open = true;
  for (const component of root.querySelectorAll("codex-addon-rule-details")) { const data = (component as HTMLElement & { details: { label: string } }).details; component.replaceWith(el("span", data.label)); }
  view.document.body.append(view.document.importNode(root, true)); view.focus(); view.print();
}
