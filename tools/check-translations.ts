// Checks the interface catalogs: every literal key the sheet translates is in
// the English catalog, and Czech translates every English text in the same
// section with the same placeholders.
import { readFile, readdir } from "node:fs/promises";
import { extractTranslationKeys } from "./translation-keys.ts";

type Message = string | Readonly<Record<string, string>>;
interface Catalog {
  readonly contractVersion: string;
  readonly locale: string;
  readonly sections: Readonly<Record<string, Readonly<Record<string, Message>>>>;
}

async function catalog(locale: string): Promise<Catalog> {
  const value = JSON.parse(
    await readFile(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
  ) as Catalog;
  if (value.contractVersion !== "message-catalog.v1" || value.locale !== locale)
    throw new Error(`locales/${locale}.json is not a message-catalog.v1 catalog for ${locale}.`);
  return value;
}
const placeholders = (message: Message | undefined): string =>
  JSON.stringify(
    [...new Set([...JSON.stringify(message ?? "").matchAll(/\{\w+\}/gu)].map((m) => m[0]))].sort(),
  );

const english = await catalog("en"),
  czech = await catalog("cs");
const problems: string[] = [];
const englishKeys = new Set<string>();
for (const [section, messages] of Object.entries(english.sections))
  for (const [key, message] of Object.entries(messages)) {
    englishKeys.add(key);
    const translated = czech.sections[section]?.[key];
    if (translated === undefined) problems.push(`Czech is missing ${section}: ${key}`);
    else if (placeholders(translated) !== placeholders(message))
      problems.push(`Czech changes placeholders: ${key}`);
  }
for (const file of await readdir(new URL("../src/", import.meta.url))) {
  if (!file.startsWith("character-") || !file.endsWith(".ts")) continue;
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  for (const key of extractTranslationKeys(file, source))
    if (!englishKeys.has(key))
      problems.push(`${file} translates a key missing from English: ${key}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else console.log(`Catalogs cover all ${englishKeys.size} interface texts in English and Czech.`);
