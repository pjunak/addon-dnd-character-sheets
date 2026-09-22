import { object, rows } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, field, human, label, panel, rule, select, styled, textInput } from "./character-ui.js";
export function spellSourceLabel(sourceValue, locale = "en") {
    const source = object(sourceValue), acquired = object(source["acquisition"]), t = translator(locale);
    const name = String(source["name"] ?? label(String(source["id"] ?? source["type"] ?? "")));
    if (!acquired["id"])
        return name;
    const owner = acquired["classId"] ? t(label(String(acquired["classId"]))) : String(acquired["name"] ?? acquired["id"]);
    return [name, owner, t("Level {0}", [acquired["level"]])].join(" · ");
}
// Every spell surface uses the same two native controls, enhanced by the host.
// Filtering is local presentation and never changes an authored selection.
export function spellFilters(key, locale, changed) {
    const t = translator(locale), search = textInput("", changed);
    search.type = "search";
    search.dataset["ui"] = "search";
    const level = select("", [{ id: "0", label: t("Cantrips") }, ...Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1), label: t("Level {0}", [i + 1]) }))], changed, t);
    level.options[0].textContent = t("All spell levels");
    const nameField = field(t("Filter spells"), search), levelField = field(t("Spell level"), level);
    nameField.dataset["uiKey"] = key + ":name";
    levelField.dataset["uiKey"] = key + ":level";
    const status = el("p");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.dataset["spellResults"] = "";
    return {
        controls: el("div", styled("div", "dnd-workflow-controls", nameField, levelField), status),
        matches: (name, value) => name.toLocaleLowerCase(locale).includes(search.value.trim().toLocaleLowerCase(locale)) && (!level.value || String(value) === level.value),
        report: shown => { status.textContent = shown ? t("{0} spells shown", [shown]) : t("No matching spells."); },
    };
}
export function markSpellRow(row, id, catalog) {
    const spell = catalog.find(record => record.id === id);
    row.dataset["spellName"] = String(spell?.value["name"] ?? id);
    row.dataset["spellLevel"] = String(spell?.value["level"] ?? "");
    return row;
}
export function unassignedSpellState(input, evaluation, changed, locale) {
    if (!evaluation)
        return [];
    const t = translator(locale), panels = [];
    const groups = [
        [input.build.spells.grantChoices, rows(evaluation.spellOptions["pendingChoices"])],
        [input.build.spells.castingAbilities, rows(evaluation.spellOptions["castingAbilityChoices"])],
        [input.play.resourceUses, rows(evaluation.sheet["resources"])],
        [input.play.activeFeatures, rows(evaluation.sheet["activations"])],
    ];
    for (const [saved, descriptors] of groups)
        for (const [key, value] of Object.entries(saved)) {
            if (descriptors.some(row => row["key"] === key))
                continue;
            const owners = descriptors.filter(row => row["legacyKey"] === key && !Object.hasOwn(saved, String(row["key"])));
            if (!owners.length && (Array.isArray(value) && !value.length || value === 0 || value === false))
                continue;
            const root = panel(t("Assign saved spell state"), el("p", key + ": " + human(value)));
            root.dataset["spellRepair"] = key;
            if (owners.length) {
                const control = select("", owners.map(row => ({ id: String(row["key"]), label: spellSourceLabel(row["source"], locale) })), id => {
                    if (!id)
                        return;
                    saved[id] = structuredClone(value);
                    delete saved[key];
                    changed();
                }, t);
                control.dataset["ui"] = "combobox";
                const ownerField = field(t("Granting source"), control);
                ownerField.dataset["uiKey"] = "spell-repair:" + key;
                root.append(ownerField);
            }
            root.append(button(t("Discard saved spell state"), () => { delete saved[key]; changed(); }));
            panels.push(root);
        }
    return panels;
}
function savedSpellRule(projection, id, name) {
    const node = rule(name, { kind: "spell", id });
    const evidence = projection?.evidence.find(row => row.reference.kind === "spell" && row.reference.id === id);
    if (evidence)
        node.details["savedSources"] = [evidence];
    return node;
}
export function grantedSpellsRead(projection, locale) {
    const grants = rows(object(projection?.sheet["spellcasting"])["granted"]), t = translator(locale);
    if (!grants.length)
        return;
    const root = panel(t("Granted spells"));
    for (const grant of grants) {
        const name = String(grant["name"] ?? grant["ref"]), row = el("p", savedSpellRule(projection, String(grant["ref"]), name), " · ", spellSourceLabel(grant["source"], locale), " · ", human(grant["castingAbility"]));
        row.dataset["spellName"] = name;
        row.dataset["spellLevel"] = String(grant["level"] ?? "");
        root.append(row);
    }
    return root;
}
export function savedSpellBook(input, projection, locale) {
    const t = translator(locale), root = el("div");
    const filters = spellFilters("saved-spells", locale, () => filter());
    const filter = () => { let shown = 0; for (const row of root.querySelectorAll("[data-spell-name]")) {
        row.hidden = !filters.matches(row.dataset["spellName"], row.dataset["spellLevel"]);
        if (!row.hidden)
            shown++;
    } filters.report(shown); };
    root.append(filters.controls);
    for (const [title, groups] of [["Cantrips", input.build.spells.cantrips], ["Spellbook", input.build.spells.spellbook], ["Prepared spells", input.play.preparedSpells]])
        for (const [classId, ids] of Object.entries(groups)) {
            const group = panel(t(title) + " · " + label(classId));
            for (const id of ids) {
                const evidence = projection?.evidence.find(row => row.reference.kind === "spell" && row.reference.id === id), name = evidence?.name ?? id;
                const row = el("p", savedSpellRule(projection, id, name));
                row.dataset["spellName"] = name;
                row.dataset["spellLevel"] = String(evidence?.facts["level"] ?? "");
                group.append(row);
            }
            root.append(group);
        }
    const grants = grantedSpellsRead(projection, locale);
    if (grants)
        root.append(grants);
    filter();
    return root;
}
