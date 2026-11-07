import { text } from "./character-client.js";
import type { AddonContext } from "./sdk.js";

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

export function builderLabel(
  guidance: Record<string, unknown>,
  locale: string,
  fallback = "",
): string {
  return translator(locale)(
    text(guidance["labelKey"] ?? guidance["label"], fallback),
    Array.isArray(guidance["labelArgs"]) ? guidance["labelArgs"] : [],
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
