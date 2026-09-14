import { catalogs } from "./character-messages.js";

export function translator(locale: string): (key: string, values?: readonly unknown[]) => string {
  const catalog: Readonly<Record<string, string>> = locale === "cs" ? catalogs.cs : catalogs.en;
  return (key, values = []) => (catalog[key] ?? key ?? "").replace(/\{(\d+)\}/gu, (_token, index: string) => String(values[Number(index)] ?? ""));
}
