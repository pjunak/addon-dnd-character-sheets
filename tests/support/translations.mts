// Importing this module gives the sheet's translator this package's own
// catalogs per view language, as the host's ui.i18n would.
import { readFileSync } from "node:fs";
import { useTranslations, type I18n } from "#web/character-locale";

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
    message: ({ text, key, args = {} }) =>
      key === undefined ? text : fill(lookup(key) ?? text, args),
    onChange: () => () => {},
  };
}

useTranslations(catalogI18n);
