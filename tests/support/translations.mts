// Importing this module gives the sheet's translator this package's own
// catalogs per view language, as the host's ui.i18n would, and a few texts of
// the rules engine's catalog under the add-on ID `engineAddon`.
import { readFileSync } from "node:fs";
import { useEngineCatalog, useTranslations, type I18n } from "#web/character-locale";

type Message = string | Readonly<Record<string, string>>;
interface Catalog {
  readonly sections: Readonly<Record<string, Readonly<Record<string, Message>>>>;
}

function messages(locale: string): Map<string, Message> {
  try {
    const catalog = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), "utf8"),
    ) as Catalog;
    return new Map(Object.values(catalog.sections).flatMap((section) => Object.entries(section)));
  } catch {
    return new Map();
  }
}

/** The rules engine add-on the tests connect; its catalog is `engineMessages`. */
export const engineAddon = "dnd-engine";
/** Czech texts of the Engine's catalog, keyed as the Engine keys them. */
export const engineMessages: Readonly<Record<string, string>> = {
  Small: "Malá",
  "Spell save DC": "SO záchranného hodu proti kouzlům",
  "base + proficiency bonus + spellcasting ability modifier":
    "základ + zdatnostní bonus + oprava sesílací vlastnosti",
  "Proficiency bonus": "Zdatnostní bonus",
  "CON saving throw": "Odolnost: záchranný hod",
  "Coins ({0} ÷ {1})": "Mince ({0} ÷ {1})",
  "Current HP cannot exceed the effective maximum ({0}).":
    "Současné životy nesmí překročit výsledné maximum ({0}).",
  "DM given: {0} waives this requirement.": "Udělení PJ: {0} uděluje výjimku z tohoto požadavku.",
  "Choose {0} subclass": "Vybrat podtřídu: {0}",
};

export function catalogI18n(locale: string): I18n {
  const own = messages(locale),
    english = messages("en");
  const lookup = (key: string): string | undefined => {
    const message = own.get(key) ?? english.get(key);
    return typeof message === "object" ? message["other"] : message;
  };
  const fill = (text: string, args: Readonly<Record<string, string | number>>): string =>
    text.replace(/\{(\w+)\}/gu, (match, name: string) =>
      Object.hasOwn(args, name) ? String(args[name]) : match,
    );
  return {
    locale,
    t: (key, args = {}) => fill(lookup(key) ?? key, args),
    plural: (key, count, args = {}) => fill(lookup(key) ?? key, { n: count, ...args }),
    message: ({ text, key, args = {}, addon }) => {
      if (key === undefined) return text;
      const message =
        addon === undefined ? lookup(key) : locale === "cs" ? engineMessages[key] : undefined;
      // Like the host, an unknown key shows the English text as given.
      return message === undefined ? text : fill(message, args);
    },
    onChange: () => () => {},
  };
}

useTranslations(catalogI18n);
useEngineCatalog(engineAddon);
