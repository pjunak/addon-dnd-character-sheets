import type { Inputs, Result } from "./character-model.js";
import { translator } from "./character-locale.js";
import { newId, object, rows, strings, type CatalogRecord } from "./character-client.js";
import { button, el, field, human, label, numberInput, panel, rule, select, styled, textInput } from "./character-ui.js";

// Options and costs are engine results. This view only gathers command inputs.
export function playActions(input: Inputs, evaluation: Result, catalog: CatalogRecord[], act: (change: Record<string, unknown>, summary: string) => Promise<void>, locale = "en", section: "spells" | "recovery" = "spells"): HTMLElement {
  const t = translator(locale);
  const root = panel(t(section === "recovery" ? "Hit dice" : "Spellcasting")), names = new Map(catalog.map(record => [record.id, String(record.value["name"] ?? record.id)]));
  const spellName = (id: string): string => names.get(id) ?? id;
  const slotName = (key: string): string => { const resource = rows(evaluation.sheet["resources"]).find(row => row["key"] === key); return resource ? t("{0} · {1}/{2}", [resource["name"], resource["remaining"], resource["max"]]) : key; };
  if (section === "recovery") for (const resource of rows(evaluation.sheet["resources"]).filter(row => row["kind"] === "hitdice")) {
    const key = String(resource["key"]); let result: number | undefined;
    root.append(field(t("{0} — recorded die result", [human(resource["name"])]), numberInput(undefined, value => { result = value; }, 1)), button(t("Spend recorded hit die"), async () => { if (result !== undefined) await act({ operation: "spend-hit-die", key, result, rollId: newId() }, `Spend ${human(resource["die"])}: recorded ${result}`); }));
  }
  if (section === "recovery") return root;
  const search = textInput("", () => filter()), level = select("", [{id:"0",label:t("Cantrips")}, ...Array.from({length:9}, (_, i) => ({id:String(i+1),label:t("Level {0}",[i+1])}))], () => filter(), t);
  const filter = (): void => { for (const row of root.querySelectorAll<HTMLElement>("[data-spell-name]")) row.hidden = !(row.dataset["spellName"]!.includes(search.value.toLocaleLowerCase()) && (!level.value || row.dataset["spellLevel"] === level.value)); };
  root.append(styled("div", "dnd-workflow-controls", field(t("Filter spells"), search), field(t("Spell level"), level)));
  const spellRow = (ref: string): HTMLElement => { const row = styled("div", "dnd-spell-row", rule(spellName(ref), {kind:"spell", id:ref})); row.dataset["spellName"] = spellName(ref).toLocaleLowerCase(); row.dataset["spellLevel"] = String(catalog.find(record => record.id === ref)?.value["level"] ?? ""); return row; };
  for (const caster of rows(evaluation.spellOptions["classes"])) {
    const classId = String(caster["classId"]), group = panel(t("{0} spells", [label(classId)]));
    for (const [ref, rawSlots] of Object.entries(object(caster["castSlots"]))) {
      const slots = strings(rawSlots); let slot = slots[0] ?? "";
      const row = spellRow(ref);
      if (slots.length) row.append(field(t("Spend slot"), select(slot, slots.map(id => ({ id, label: slotName(id) })), value => { slot = value; }, t)));
      row.append(button(t("Cast"), () => act({ operation: "cast-spell", classId, ref, slot }, `Cast ${spellName(ref)}`))); group.append(row);
    }
    for (const ref of strings(caster["ritualIds"])) { const row = spellRow(ref); row.append(button(t("Cast as ritual"), () => act({operation:"cast-ritual", classId, ref}, "Ritual: " + spellName(ref)))); group.append(row); }
    const costs = object(caster["copyCosts"]), copyOptions = Object.keys(costs).filter(id => !input.build.spells.spellbook[classId]?.includes(id));
    if (copyOptions.length) {
      let ref = "", scrollId = "";
      group.append(field(t("Spell to copy"), select("", copyOptions.map(id => ({ id, label: t("{0} · {1} GP", [spellName(id), human(costs[id])]) })), value => { ref = value; }, t)), field(t("Owned scroll (optional)"), select("", input.play.inventory.filter(item => item.spellId && item.quantity > 0).map(item => ({ id: item.id, label: item.name })), value => { scrollId = value; }, t)), button(t("Review copying cost"), async () => { if (ref) await act({ operation: "copy-spell", classId, ref, scrollId, acquisitionId: newId() }, `Copy ${spellName(ref)} for ${human(costs[ref])} GP`); }));
    }
    if (caster["canSwap"] === true && input.play.preparedSpells[classId]?.length) {
      let out = "", ref = "";
      group.append(field(t("Replace known spell"), select("", input.play.preparedSpells[classId]!.map(id => ({ id, label: spellName(id) })), value => { out = value; }, t)), field(t("Replacement spell"), select("", strings(caster["spellIds"]).filter(id => Number(catalog.find(record => record.id === id)?.value["level"]) > 0).map(id => ({ id, label: spellName(id) })), value => { ref = value; }, t)), button(t("Review spell replacement"), async () => { if (out && ref) await act({ operation: "swap-spell", classId, out, ref }, `Replace ${spellName(out)} with ${spellName(ref)}`); }));
    }
    root.append(group);
  }
  for (const grant of rows(evaluation.spellOptions["granted"])) {
    const ref = String(grant["ref"]), key = String(grant["key"]), slots = strings(grant["slots"]); let slot = slots[0] ?? "";
    const row = el("div", rule(spellName(ref), { kind: "spell", id: ref }));
    if (slots.length) row.append(field(t("Granted cast resource"), select(slot, slots.map(id => ({ id, label: slotName(id) })), value => { slot = value; }, t)));
    row.append(button(t("Cast granted spell"), () => act({ operation: "cast-granted-spell", key, slot }, `Cast granted ${spellName(ref)}`))); root.append(row);
  }
  return root;
}
