// A magic weapon or armor is a base weapon or armor record with a bonus. The
// Engine lists what an inventory entry may be; the owner picks the base and
// bonus when there are several, and the sheet names what was picked.
import type { Item, Option } from "./character-model.js";
import type { SheetView } from "./character-sheet.js";
import { object, text } from "./character-client.js";
import { translator } from "./character-locale.js";
import { recordName } from "./character-sheet.js";
import { field, select, styled } from "./character-ui.js";

type GearView = Pick<SheetView, "locale" | "equipment" | "catalogs" | "projection">;

/** The base records and bonuses the Engine offers for an inventory entry. */
export function gearOptions(
  view: Pick<SheetView, "equipment">,
  item: Item,
): { bases: Option[]; bonuses: number[] } {
  const guidance = object(view.equipment[item.id]),
    bases = Array.isArray(guidance["baseItems"]) ? guidance["baseItems"] : [],
    bonuses = Array.isArray(guidance["bonuses"]) ? guidance["bonuses"] : [];
  return {
    bases: bases
      .map((option) => object(option))
      .filter((option) => text(option["id"]))
      .map((option) => ({
        id: text(option["id"]),
        label: text(option["label"], text(option["id"])),
      })),
    bonuses: bonuses.filter((bonus): bonus is number => typeof bonus === "number"),
  };
}

/** The picked or only base name and bonus of an entry, as far as known. */
function gearParts(view: GearView, item: Item): { base: string; bonus: number | undefined } {
  const { bases, bonuses } = gearOptions(view, item),
    picked = item.baseItemId ?? (bases.length === 1 ? bases[0]!.id : undefined),
    bonus = item.bonus ?? (bonuses.length === 1 ? bonuses[0] : undefined);
  if (!picked) return { base: "", bonus };
  const base =
    bases.find((option) => option.id === picked)?.label ??
    [recordName(view, "weapon", picked), recordName(view, "armor", picked)].find(
      (name) => name !== picked,
    ) ??
    picked;
  return { base, bonus };
}

/**
 * What an entry is, such as "Longsword, +1", once its base or bonus is known;
 * "" for other items. Without rules it names a picked base from the catalogs
 * or saved evidence.
 */
export function gearLabel(view: GearView, item: Item): string {
  const { base, bonus } = gearParts(view, item);
  if (!base) return bonus === undefined ? "" : "+" + bonus;
  return bonus === undefined ? base : translator(view.locale)("{0}, +{1}", [base, bonus]);
}

/**
 * A muted note after an item's name saying what it is, unless the name
 * already does ("+1 Longsword").
 */
export function gearNote(view: GearView, item: Item | undefined): HTMLElement[] {
  if (!item) return [];
  const { base, bonus } = gearParts(view, item),
    name = item.name.toLocaleLowerCase(view.locale),
    said =
      (!base || name.includes(base.toLocaleLowerCase(view.locale))) &&
      (bonus === undefined || name.includes("+" + bonus));
  return said ? [] : [styled("small", "dsc-muted dsc-gear", gearLabel(view, item))];
}

/** Base and bonus pickers, shown when the item offers several or has a pick. */
export function gearFields(view: SheetView, item: Item): HTMLElement[] {
  const t = translator(view.locale),
    { bases, bonuses } = gearOptions(view, item),
    fields: HTMLElement[] = [];
  if (bases.length > 1 || item.baseItemId)
    fields.push(
      field(
        "inventory/" + item.id + "/base-item",
        t("Base weapon or armor"),
        select(
          item.baseItemId ?? "",
          bases,
          (value) => {
            if (value) item.baseItemId = value;
            else delete item.baseItemId;
            view.change();
          },
          t,
        ),
      ),
    );
  if (bonuses.length > 1 || item.bonus !== undefined)
    fields.push(
      field(
        "inventory/" + item.id + "/bonus",
        t("Magic bonus"),
        select(
          item.bonus === undefined ? "" : String(item.bonus),
          bonuses.map((bonus) => ({ id: String(bonus), label: "+" + bonus })),
          (value) => {
            if (value) item.bonus = Number(value);
            else delete item.bonus;
            view.change();
          },
          t,
        ),
      ),
    );
  return fields;
}
