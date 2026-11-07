import { text } from "./character-client.js";
import type { AddonContext, LocalizedText } from "./sdk.js";

export type I18n = AddonContext["i18n"];
/** Gives the translator for a view language; see useTranslations. */
export type TranslationSource = (locale: string) => I18n | undefined;

// Each generation loads its own copy of this module, so the source set at
// activation serves only that generation's views.
let translations: TranslationSource = () => undefined;

/**
 * Sets where texts come from: the host's ui.i18n at activation, which already
 * follows the reader's language, or a catalog-backed fake per language in tests.
 */
export function useTranslations(source: TranslationSource): void {
  translations = source;
}

export const abilityNames: Record<string, string> = {
  STR: "Strength",
  DEX: "Dexterity",
  CON: "Constitution",
  INT: "Intelligence",
  WIS: "Wisdom",
  CHA: "Charisma",
};
export const armorCategoryLabels: Readonly<Record<string, string>> = {
  light: "Light armor",
  medium: "Medium armor",
  heavy: "Heavy armor",
  shield: "Shields",
};

/**
 * A text to show: this add-on's own English text (its catalog key), or
 * English with its key in a message catalog, such as the rules engine's.
 */
export type Wording = string | LocalizedText;

// The rules engine provider of this generation, whose catalog holds the
// Engine's wording; unset until the engine connects.
let engineCatalog: string | undefined;

/** Names the rules engine add-on whose message catalog keys its wording. */
export function useEngineCatalog(addonId: string | undefined): void {
  engineCatalog = addonId;
}

/**
 * Engine wording: its English text, and its key with {0}-style arguments in
 * the Engine's catalog. Without a key or a connected engine it is plain text,
 * never looked up in this add-on's catalog.
 */
export function engineWording(english: string, key?: unknown, args?: unknown): LocalizedText {
  if (typeof key !== "string" || !key || !engineCatalog) return { text: english };
  const values = Array.isArray(args) ? args.map((value) => text(value)) : [];
  return {
    text: english,
    key,
    addon: engineCatalog,
    ...(values.length
      ? { args: Object.fromEntries(values.map((value, index) => [String(index), value])) }
      : {}),
  };
}

/** Shows wording in the view's language. */
export function wordingText(wording: Wording, locale: string): string {
  if (typeof wording === "string") return translator(locale)(wording);
  const i18n = translations(locale);
  return i18n ? i18n.message(wording) : wording.text;
}

/** A guidance label (Engine `Text`) in the view's language. */
export function builderLabel(
  guidance: Record<string, unknown>,
  locale: string,
  fallback = "",
): string {
  return wordingText(
    engineWording(text(guidance["label"], fallback), guidance["labelKey"], guidance["labelArgs"]),
    locale,
  );
}

/**
 * Texts are keyed by their English wording with positional {0} placeholders,
 * so without a translator the key itself is the English text.
 */
export function translator(locale: string): (key: string, values?: readonly unknown[]) => string {
  const i18n = translations(locale);
  return (key, values = []) => {
    const args: Record<string, string> = {};
    values.forEach((value, index) => (args[String(index)] = text(value)));
    // Catalog keys are 1 to 500 characters; anything else cannot be a message.
    if (i18n && key.length > 0 && key.length <= 500) return i18n.t(key, args);
    return key.replace(/\{(\d+)\}/gu, (token, index: string) => args[index] ?? token);
  };
}
