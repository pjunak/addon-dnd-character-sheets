import { catalogs } from "./character-messages.js";
export const abilityNames = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
export function builderLabel(guidance, locale, fallback = "") {
    return translator(locale)(String(guidance["labelKey"] ?? guidance["label"] ?? fallback), Array.isArray(guidance["labelArgs"]) ? guidance["labelArgs"] : []);
}
export function translator(locale) {
    const catalog = locale === "cs" ? catalogs.cs : catalogs.en;
    return (key, values = []) => (catalog[key] ?? key ?? "").replace(/\{(\d+)\}/gu, (_token, index) => String(values[Number(index)] ?? ""));
}
