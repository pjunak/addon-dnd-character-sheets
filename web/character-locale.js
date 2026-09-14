import { catalogs } from "./character-messages.js";
export function translator(locale) {
    const catalog = locale === "cs" ? catalogs.cs : catalogs.en;
    return (key, values = []) => (catalog[key] ?? key ?? "").replace(/\{(\d+)\}/gu, (_token, index) => String(values[Number(index)] ?? ""));
}
