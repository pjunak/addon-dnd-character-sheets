import { object } from "./character-client.js";
import { abilityNames, translator } from "./character-locale.js";
import { el, label, panel, rule, styled } from "./character-ui.js";
const categoryNames = {
    armor: { light: "Light armor", medium: "Medium armor", heavy: "Heavy armor", shield: "Shields", shields: "Shields" },
    weapon: { simple: "Simple weapons", martial: "Martial weapons", "martial (finesse)": "Martial weapons (finesse)" },
};
const abilityOrder = Object.keys(abilityNames);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// This is a reading view of saved training, never a catalog lookup or a rule calculation.
export function proficiencyGroups(projection, locale) {
    const t = translator(locale), training = object(projection?.sheet["proficiencies"]);
    const entry = (kind, id, path) => {
        const evidence = projection?.evidence.find(source => source.reference.kind === kind && source.reference.id === id);
        const name = kind === "save" ? t(abilityNames[id] ?? label(id))
            : kind === "skill" ? t(label(id)) : evidence?.name ?? t(categoryNames[kind]?.[id] ?? label(id));
        return { name, ...(evidence ? { reference: { ...evidence.reference } } : {}), ...(path ? { path } : {}) };
    };
    const dictionary = (id, name, raw, accepts, kind, prefix) => ({
        id, name: t(name), available: isObject(raw),
        entries: Object.entries(object(raw)).filter(([, value]) => accepts(value))
            .sort(([left], [right]) => kind === "save" ? abilityOrder.indexOf(left) - abilityOrder.indexOf(right) : 0)
            .map(([key]) => entry(kind, key, prefix + "." + key + ".total")),
    });
    const list = (id, name, kind, raw) => ({
        id, name: t(name), available: Array.isArray(raw),
        entries: [...new Set(Array.isArray(raw) ? raw.filter((value) => typeof value === "string" && value.trim().length > 0) : [])].map(value => entry(kind, value)),
    });
    return [
        dictionary("saves", "Saving throws", training["saves"], value => value === true, "save", "saves"),
        dictionary("skills", "Skills", training["skills"], value => value === "proficient", "skill", "skills"),
        dictionary("expertise", "Expertise", training["skills"], value => value === "expertise", "skill", "skills"),
        list("armor", "Armor", "armor", training["armor"]),
        list("weapons", "Weapons", "weapon", training["weapons"]),
        list("tools", "Tools", "tool", training["tools"]),
        list("languages", "Languages", "language", training["languages"] ?? projection?.sheet["languages"]),
    ];
}
export function proficiencyDetails(projection, locale) {
    const t = translator(locale), root = panel(t("Proficiencies")), groups = proficiencyGroups(projection, locale);
    root.classList.add("dse-section", "dse-proficiencies");
    if (!groups.some(group => group.available)) {
        root.append(el("p", t("Proficiency details were not saved.")));
        return root;
    }
    const values = el("dl");
    for (const group of groups) {
        const contents = el("dd"), heading = el("dt", group.name);
        if (group.entries.length) {
            const items = el("ul");
            items.setAttribute("aria-label", group.name);
            for (const entry of group.entries) {
                const explanation = entry.path ? projection?.explanations[entry.path] : undefined;
                items.append(el("li", explanation || entry.reference
                    ? rule(entry.name, entry.reference, explanation, undefined, projection) : entry.name));
            }
            contents.append(items);
        }
        else
            contents.append(el("span", t(group.available ? "None recorded" : "Not recorded")));
        const row = styled("div", "dse-training-group", heading, contents);
        row.dataset["training"] = group.id;
        values.append(row);
    }
    root.append(values);
    return root;
}
