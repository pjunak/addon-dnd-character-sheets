import { translator } from "./character-locale.js";
import { abilities, object, rows } from "./character-client.js";
import { button, combo, el, field, label, numberInput, panel, select, textInput } from "./character-ui.js";
/** The same typed contribution editor creates and amends character exceptions. */
export function grantForm(input, evaluation, feats, previous, submit, locale = "en") {
    const t = translator(locale);
    const grant = previous ? structuredClone(previous) : { id: "", name: "", reason: "", actorId: "", grantedAt: "", active: true, effectiveLevel: input.build.levels.length || 1, condition: "always", effects: [], waivers: [] };
    const effects = panel(t("Mechanical effects")), list = el("div");
    const renameEffects = () => { [...list.children].forEach((row, index) => { row.querySelector("h3").textContent = t("Effect {0}: {1}", [index + 1, t(label(grant.effects[index].target))]); }); };
    const appendEffect = (effect) => {
        const row = panel(""), identity = "grant-effect-" + crypto.randomUUID(), keySlot = el("div");
        const heading = row.querySelector("h3");
        heading.id = identity;
        row.setAttribute("role", "group");
        row.setAttribute("aria-labelledby", identity);
        const ownedField = (name, control) => {
            const wrapper = field(t(name), control);
            wrapper.dataset["uiKey"] = identity + ":" + name;
            return wrapper;
        };
        // Keep existing controls mounted. Updating one target must not replace every
        // row, lose its keyboard position, or reuse a sibling's enhancement identity.
        const renderKey = () => {
            const keys = effect.target.startsWith("ability") || effect.target === "savingThrow" ? [...abilities] : effect.target === "proficiency" ? [...abilities, ...Object.keys(object(evaluation?.sheet["skills"]))] : effect.target === "resourceMax" ? rows(evaluation?.sheet["resources"]).map(row => String(row["key"])) : effect.target === "sense" ? ["darkvision", "blindsight", "tremorsense", "truesight"] : [];
            keySlot.replaceChildren();
            if (["abilityScore", "abilityCap", "savingThrow", "proficiency", "resourceMax", "sense"].includes(effect.target)) {
                const key = select(effect.key ?? "", keys.map(id => ({ id, label: t(label(id)) })), value => { effect.key = value; }, t);
                key.required = true;
                keySlot.append(ownedField("Applies to", key));
            }
        };
        const target = select(effect.target, ["abilityScore", "abilityCap", "armorClass", "savingThrow", "initiative", "speed", "maxHp", "attunementLimit", "sense", "resourceMax", "proficiency"].map(id => ({ id, label: t(label(id)) })), value => { effect.target = value; delete effect.key; renderKey(); renameEffects(); }, t);
        const mode = select(effect.mode, ["add", "set", "minimum", "maximum"].map(id => ({ id, label: t(label(id)) })), value => { effect.mode = value; }, t);
        const amount = numberInput(effect.value, value => { effect.value = value ?? 0; });
        target.required = true;
        mode.required = true;
        amount.required = true;
        row.append(ownedField("Effect", target), keySlot, ownedField("Operation", mode), ownedField("Amount", amount), button(t("Remove effect"), () => {
            const index = grant.effects.indexOf(effect);
            grant.effects.splice(index, 1);
            row.remove();
            renameEffects();
            const next = list.children[index] ?? list.children[index - 1];
            (next?.querySelector("select") ?? add).focus();
        }));
        renderKey();
        list.append(row);
        renameEffects();
        return target;
    };
    const add = button(t("Add effect"), () => {
        const effect = { target: "maxHp", mode: "add", value: 0 };
        grant.effects.push(effect);
        appendEffect(effect).focus();
    });
    effects.append(el("p", t("Leave empty for a narrative reward. Typed effects participate in calculation and can be reversed.")), list, add);
    for (const effect of grant.effects)
        appendEffect(effect);
    const name = textInput(grant.name, value => { grant.name = value; });
    name.required = true;
    const reason = textInput(previous ? "" : grant.reason, value => { grant.reason = value; }, true);
    reason.required = true;
    if (previous)
        grant.reason = "";
    const level = numberInput(grant.effectiveLevel, value => { grant.effectiveLevel = value ?? 1; }, 1);
    level.required = true;
    const condition = select(grant.condition, ["always", "equipped", "attuned"].map(id => ({ id, label: t(label(id)) })), value => { grant.condition = value; }, t);
    condition.required = true;
    const apply = button(t("Apply DM grant"), () => undefined);
    apply.type = "submit";
    const form = el("form", field(t("Name"), name), field(t(previous ? "Reason for amendment" : "Reason"), reason), field(t("Effective character level"), level), effects, field(t("Granted feat (optional)"), combo(grant.feat?.id ?? "", feats.map(record => ({ id: record.id, label: String(record.value["name"] ?? record.id) })), value => { if (value)
        grant.feat = { kind: "feat", id: value };
    else
        delete grant.feat; }, t)), field(t("Exact prerequisite issue IDs to waive (comma-separated, optional)"), textInput(grant.waivers.join(", "), value => { grant.waivers = value.split(",").map(value => value.trim()).filter(Boolean); })), field(t("Condition"), condition), field(t("Item instance"), combo(grant.itemId ?? "", input.play.inventory.map(item => ({ id: item.id, label: item.name })), value => { if (value)
        grant.itemId = value;
    else
        delete grant.itemId; }, t)), field(t("Expires at (RFC 3339, optional)"), textInput(grant.expiresAt ?? "", value => { grant.expiresAt = value; })), apply);
    // Native form validation focuses the missing field and retains the draft.
    // Mechanical validity and authorization still belong to the worker/engine.
    form.addEventListener("submit", event => { event.preventDefault(); void submit(grant); });
    return [form];
}
