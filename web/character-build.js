import { translator } from "./character-locale.js";
import { abilities, newId, object, rows, strings } from "./character-client.js";
import { button, el, field, human, label, numberInput, panel, rule, select, textInput } from "./character-ui.js";
const options = (records) => records.map(record => ({ id: record.id, label: String(record.value["name"] ?? record.id) }));
const guidanceOptions = (value) => rows(value).map(row => ({ id: String(row["id"]), label: String(row["label"] ?? row["name"] ?? row["id"]) }));
export function buildView(view) {
    const t = translator(view.locale);
    const { input, policy } = view, build = input.build, root = el("div");
    root.className = "character-build";
    const update = (action) => { action(); view.changed(); };
    const foundation = panel(t("Origin and abilities"), field(t("Creation method"), select(build.method, ["point-buy", "array", "rolled"].map(id => ({ id, label: t(label(id)) })), value => { update(() => { build.method = value; }); view.refresh(); }, t)));
    foundation.append(el("p", build.method === "array" ? `Assign the ruleset array: ${human(policy["standardArray"])}.` : build.method === "rolled" ? `Record ${human(policy["rollDice"])} d${human(policy["rollSides"])}; keep the highest ${human(policy["rollKeep"])}. Recalculation never rolls again.` : "Assign the point-buy budget. The rules preview reports remaining requirements."));
    const scores = el("div");
    scores.className = "character-stats";
    for (const ability of abilities) {
        const score = field(ability, numberInput(build.baseScores[ability], value => update(() => { if (value === undefined)
            delete build.baseScores[ability];
        else
            build.baseScores[ability] = value; }), 1));
        scores.append(score);
        if (build.method === "rolled") {
            const existing = build.rolls.find(roll => roll.ability === ability);
            score.append(field(t("Recorded dice, separated by spaces"), textInput(existing?.dice.join(" ") ?? "", value => update(() => {
                const dice = value.trim().split(/\s+/).map(Number), keep = Number(policy["rollKeep"]);
                if (!dice.every(Number.isInteger) || !Number.isInteger(keep))
                    return;
                const kept = dice.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value || a.index - b.index).slice(0, keep).map(die => die.index);
                build.rolls = build.rolls.filter(roll => roll.ability !== ability);
                build.rolls.push({ id: existing?.id ?? newId(), ability, dice, kept });
                build.baseScores[ability] = kept.reduce((sum, index) => sum + (dice[index] ?? 0), 0);
            }))));
        }
    }
    foundation.append(scores);
    for (const kind of ["species", "background"]) {
        const records = view.catalogs.get(kind) ?? [];
        const choice = select(build[kind], options(records), value => { update(() => { build[kind] = value; }); view.refresh(); }, t);
        foundation.append(field(t(label(kind)), choice));
        const selected = records.find(record => record.id === build[kind]);
        if (selected)
            foundation.append(rule(String(selected.value["name"] ?? selected.id), { kind, id: selected.id }, undefined, String(selected.value["summary"] ?? selected.value["text"] ?? "").slice(0, 800)));
        if (kind === "species" && selected) {
            const lineages = rows(selected.value["lineages"]);
            if (lineages.length)
                foundation.append(field(t("Lineage"), select(build.lineage, guidanceOptions(lineages), value => update(() => { build.lineage = value; }), t)));
        }
    }
    root.append(foundation);
    const levels = panel(t("Level history"), el("p", t("Levels are ordered decisions. Swapping an earlier class may invalidate later choices; review shows every resulting change.")));
    build.levels.forEach((level, index) => {
        const row = panel(t("Level {0}", [index + 1]), field(t("Class"), select(level.classId, options(view.catalogs.get("class") ?? []), value => { update(() => { level.classId = value; }); view.refresh(); }, t)));
        if (index > 0)
            row.append(field(t("Recorded hit-die roll"), numberInput(level.hitPoints, value => update(() => { if (value === undefined)
                delete level.hitPoints;
            else
                level.hitPoints = value; }), 1), "Leave blank to use the ruleset's fixed gain."));
        if (index > 0)
            row.append(button(t("Move earlier"), () => { update(() => { [build.levels[index - 1], build.levels[index]] = [level, build.levels[index - 1]]; }); view.refresh(); }));
        row.append(button(t("Remove this level"), () => { update(() => { build.levels.splice(index, 1); }); view.refresh(); }));
        levels.append(row);
    });
    levels.append(button(t("Add level"), () => { update(() => build.levels.push({ id: newId(), classId: "" })); view.refresh(); }, build.levels.length >= Number(policy["maximumLevel"] ?? 20)));
    for (const classRow of rows(view.evaluation?.guidance["classes"])) {
        const id = String(classRow["classId"]);
        if (Number(classRow["level"]) >= Number(classRow["subclassLevel"]) && rows(classRow["subclasses"]).length)
            levels.append(field(t("{0} subclass", [human(classRow["name"])]), select(build.subclasses[id] ?? "", guidanceOptions(classRow["subclasses"]), value => update(() => { build.subclasses[id] = value; }), t)));
    }
    root.append(levels);
    const plan = view.evaluation?.plan ?? {}, guidance = object(view.evaluation?.guidance["choices"]);
    const choices = panel(t("Granted choices"));
    for (const key of ["creationChoices", "creationAbilityChoices", "classChoices"])
        for (const descriptor of rows(plan[key]))
            choices.append(choiceView(descriptor, object(guidance[String(descriptor["id"])]), view));
    if (!choices.children[1])
        choices.append(el("p", t("Choose the foundations and refresh the rules preview to see granted choices.")));
    const invalid = view.evaluation?.issues.filter(issue => issue.id.startsWith("unavailable-choice:") || issue.id.startsWith("invalid-option:")) ?? [];
    for (const issue of invalid)
        choices.append(el("div", el("p", issue.message), button(t("Remove invalid selection {0}", [issue.target]), () => { update(() => { build.choices = build.choices.filter(choice => choice.id !== issue.target); }); view.refresh(); })));
    root.append(choices);
    return root;
}
function choiceView(descriptor, guidance, view) {
    const t = translator(view.locale);
    const id = String(descriptor["id"]), kind = String(descriptor["kind"]), name = String(guidance["label"] ?? descriptor["name"] ?? id), root = panel(name);
    root.id = `character-choice-${encodeURIComponent(id)}`;
    const current = (slot) => view.input.build.choices.find(choice => choice.id === id && choice.slot === slot)?.value;
    const set = (slot, value) => {
        view.input.build.choices = view.input.build.choices.filter(choice => choice.id !== id || choice.slot !== slot);
        if (value !== "")
            view.input.build.choices.push({ id, slot, value });
        view.changed();
    };
    if (kind === "abilityBudget" || descriptor["budget"] !== undefined) {
        root.append(el("p", t("Assign {0} points; up to {1} per ability.", [human(descriptor["budget"]), human(descriptor["perAbilityMax"])])));
        const eligible = Array.isArray(descriptor["eligible"]) ? strings(descriptor["eligible"]) : [...abilities];
        for (const ability of eligible)
            root.append(field(ability, numberInput(Number(object(current(0))[ability] ?? 0), value => set(0, { ...object(current(0)), [ability]: value ?? 0 }), 0, Number(descriptor["perAbilityMax"]))));
    }
    else if (kind === "asiMode") {
        const mode = String(current(0) ?? "");
        root.append(field(t("Advancement"), select(mode, [{ id: "asi", label: t("Ability increases") }, { id: "feat", label: t("Feat") }], value => { set(0, value); view.refresh(); }, t)));
        if (mode === "asi")
            root.append(choiceView({ ...object(descriptor["ability"]), kind: "abilityBudget" }, {}, view));
        if (mode === "feat") {
            const feat = object(descriptor["feat"]);
            root.append(choiceView({ ...feat, kind: "feat" }, { options: guidance["featOptions"] }, view));
            const ability = object(feat["ability"]);
            if (strings(ability["eligible"]).length)
                root.append(choiceView({ ...ability, kind: "abilityBudget" }, {}, view));
        }
    }
    else {
        const choices = guidanceOptions(guidance["options"]);
        for (let slot = 0; slot < Number(descriptor["count"] ?? 1); slot++) {
            const selected = String(current(slot) ?? "");
            root.append(field(t("Selection {0}", [slot + 1]), select(selected, choices, value => set(slot, value), t)));
            if (selected)
                root.append(rule(choices.find(choice => choice.id === selected)?.label ?? selected, { kind: kind === "feat" ? "feat" : kind.includes("skill") ? "skill" : "feature", id: selected }));
        }
    }
    return root;
}
export function inventoryView(view) {
    const t = translator(view.locale);
    const root = panel(t("Inventory and attunement")), inventory = view.input.play.inventory;
    const changed = () => view.changed();
    const attunement = object(view.evaluation?.sheet["attunement"]);
    root.append(el("p", t("{0} attuned / {1} allowed. Eligibility and capacity are checked when you review.", [human(attunement["count"]), human(attunement["limit"])])));
    for (const item of inventory) {
        const row = panel(item.name || t("New item"), field(t("Name"), textInput(item.name, value => { item.name = value; changed(); })), field(t("Quantity"), numberInput(item.quantity, value => { item.quantity = value ?? 0; changed(); }, 0)), field(t("Location"), select(item.location, ["carried", "equipped", "stored"].map(id => ({ id, label: t(label(id)) })), value => { item.location = value; changed(); }, t)), field(t("Acquired from"), textInput(item.acquisition, value => { item.acquisition = value; changed(); })));
        if (item.reference)
            row.append(rule(item.name, item.reference));
        row.append(field(t("Scroll spell (optional)"), select(item.spellId ?? "", (view.catalogs.get("spell") ?? []).map(record => ({ id: record.id, label: String(record.value["name"] ?? record.id) })), value => { if (value)
            item.spellId = value;
        else
            delete item.spellId; changed(); }, t)));
        row.append(field(t("Attunement"), select(item.attuned ? "yes" : "no", [{ id: "no", label: t("Not attuned") }, { id: "yes", label: t("Attuned") }], value => { item.attuned = value === "yes"; changed(); }, t)), field(t("Notes"), textInput(item.notes, value => { item.notes = value; changed(); })), button(t("Remove item"), () => { view.input.play.inventory = inventory.filter(current => current.id !== item.id); changed(); view.refresh(); }));
        root.append(row);
    }
    const catalog = ["armor", "weapon", "magic-item", "gear"].flatMap(kind => view.catalogs.get(kind) ?? []);
    let selected = "";
    const query = textInput("", value => {
        const options = catalog.filter(record => String(record.value["name"] ?? record.id).toLowerCase().includes(value.toLowerCase())).slice(0, 200);
        const replacement = makePicker(options);
        picker.replaceChildren(...replacement.children);
        picker.value = selected;
    });
    const makePicker = (records) => select(selected, records.map(record => ({ id: `${record.kind}:${record.id}`, label: String(record.value["name"] ?? record.id) })), value => { selected = value; }, t);
    let picker = select("", [], () => { }, t);
    picker = makePicker(catalog.slice(0, 200));
    root.append(field(t("Find catalog item"), query), field(t("Catalog item"), picker), button(t("Acquire selected item"), () => {
        const record = catalog.find(record => `${record.kind}:${record.id}` === selected);
        if (!record)
            return;
        inventory.push({ id: newId(), reference: { kind: record.kind, id: record.id }, name: String(record.value["name"] ?? record.id), quantity: 1, location: "carried", attuned: false, acquisition: "", notes: "" });
        changed();
        view.refresh();
    }), button(t("Add narrative item"), () => { inventory.push({ id: newId(), name: "", quantity: 1, location: "carried", attuned: false, acquisition: "", notes: "" }); changed(); view.refresh(); }));
    return root;
}
