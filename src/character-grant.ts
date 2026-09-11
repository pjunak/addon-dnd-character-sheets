import type { Effect, Grant, Inputs, Result } from "./character-model.js";
import { translator } from "./character-locale.js";
import { abilities, object, rows, type CatalogRecord } from "./character-client.js";
import { button, el, field, label, numberInput, panel, select, textInput } from "./character-ui.js";

/** The same typed contribution editor creates and amends character exceptions. */
export function grantForm(input: Inputs, evaluation: Result | undefined, feats: readonly CatalogRecord[], previous: Grant | undefined, submit: (grant: Grant) => void | Promise<void>, locale = "en"): Node[] {
  const t = translator(locale);
  const grant: Grant = previous ? structuredClone(previous) : { id: "", name: "", reason: "", actorId: "", grantedAt: "", active: true, effectiveLevel: input.build.levels.length || 1, condition: "always", effects: [], waivers: [] };
  const effects = panel(t("Mechanical effects")), list = el("div");
  const renderEffects = (): void => {
    list.replaceChildren();
    for (const [index, effect] of grant.effects.entries()) {
      const keys = effect.target.startsWith("ability") || effect.target === "savingThrow" ? [...abilities] : effect.target === "proficiency" ? [...abilities, ...Object.keys(object(evaluation?.sheet["skills"]))] : effect.target === "resourceMax" ? rows(evaluation?.sheet["resources"]).map(row => String(row["key"])) : effect.target === "sense" ? ["darkvision", "blindsight", "tremorsense", "truesight"] : [];
      list.append(panel(t("Effect {0}", [index + 1]),
        field(t("Effect"), select(effect.target, ["abilityScore", "abilityCap", "armorClass", "savingThrow", "initiative", "speed", "maxHp", "attunementLimit", "sense", "resourceMax", "proficiency"].map(id => ({ id, label: t(label(id)) })), value => { effect.target = value; delete effect.key; renderEffects(); }, t)),
        ...(keys.length ? [field(t("Applies to"), select(effect.key ?? "", keys.map(id => ({ id, label: t(label(id)) })), value => { effect.key = value; }, t))] : []),
        field(t("Operation"), select(effect.mode, ["add", "set", "minimum", "maximum"].map(id => ({ id, label: t(label(id)) })), value => { effect.mode = value; }, t)),
        field(t("Amount"), numberInput(effect.value, value => { effect.value = value ?? 0; })),
        button(t("Remove effect"), () => { grant.effects.splice(index, 1); renderEffects(); })));
    }
  };
  effects.append(el("p", t("Leave empty for a narrative reward. Typed effects participate in calculation and can be reversed.")), list, button(t("Add effect"), () => { grant.effects.push({ target: "maxHp", mode: "add", value: 0 } satisfies Effect); renderEffects(); })); renderEffects();
  const name = textInput(grant.name, value => { grant.name = value; }); name.required = true;
  const reason = textInput(previous ? "" : grant.reason, value => { grant.reason = value; }, true); reason.required = true;
  if (previous) grant.reason = "";
  return [field(t("Name"), name), field(t(previous ? "Reason for amendment" : "Reason"), reason), field(t("Effective character level"), numberInput(grant.effectiveLevel, value => { grant.effectiveLevel = value ?? 1; }, 1)), effects,
    field(t("Granted feat (optional)"), select(grant.feat?.id ?? "", feats.map(record => ({ id: record.id, label: String(record.value["name"] ?? record.id) })), value => { if (value) grant.feat = { kind: "feat", id: value }; else delete grant.feat; }, t)),
    field(t("Exact prerequisite issue IDs to waive (comma-separated, optional)"), textInput(grant.waivers.join(", "), value => { grant.waivers = value.split(",").map(value => value.trim()).filter(Boolean); })),
    field(t("Condition"), select(grant.condition, ["always", "equipped", "attuned"].map(id => ({ id, label: t(label(id)) })), value => { grant.condition = value; }, t)),
    field(t("Item instance"), select(grant.itemId ?? "", input.play.inventory.map(item => ({ id: item.id, label: item.name })), value => { grant.itemId = value; }, t)),
    field(t("Expires at (RFC 3339, optional)"), textInput(grant.expiresAt ?? "", value => { grant.expiresAt = value; })),
    button(t("Review DM grant"), () => { if (!name.reportValidity() || !reason.reportValidity()) return; return submit(grant); })];
}
