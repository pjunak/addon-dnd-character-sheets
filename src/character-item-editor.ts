// Controls that edit one inventory entry. Classic's inline backpack rows and
// the Backpack window's item editor share them, so both keep the same rules,
// focus keys and labels.
import type { Item } from "./character-model.js";
import type { SheetView } from "./character-sheet.js";
import { object, text } from "./character-client.js";
import {
  attuneEquipment,
  attunementChoice,
  equipmentReason,
  moveEquipment,
  pinQuickUse,
  removeInventoryItem,
  setItemQuantity,
  stowAndUnattune,
  weightText,
} from "./character-inventory.js";
import { translator } from "./character-locale.js";
import { gearFields } from "./character-magic-gear.js";
import {
  button,
  el,
  field,
  label,
  numberInput,
  select,
  styled,
  textInput,
} from "./character-ui.js";

function focusKey<T extends HTMLElement>(control: T, item: Item, action: string): T {
  control.dataset["focusKey"] = "inventory/" + item.id + "/" + action;
  return control;
}

export function quantityInput(view: SheetView, item: Item): HTMLInputElement {
  const control = numberInput(
    item.quantity,
    (value) => {
      setItemQuantity(item, value ?? 0);
      view.change();
    },
    0,
  );
  control.className = "dse-number";
  control.setAttribute("aria-label", translator(view.locale)("{0} quantity", [item.name]));
  return focusKey(control, item, "quantity");
}

/** − count + for lists, where a typed field would be too wide. */
export function quantityStepper(view: SheetView, item: Item): HTMLElement {
  const t = translator(view.locale),
    step = (delta: number): void => {
      setItemQuantity(item, item.quantity + delta);
      view.change();
      view.refresh();
    };
  const fewer = focusKey(
      button("−", () => step(-1), !view.editing || item.quantity < 1),
      item,
      "fewer",
    ),
    more = focusKey(
      button("+", () => step(1), !view.editing),
      item,
      "more",
    );
  fewer.setAttribute("aria-label", t("One fewer {0}", [item.name]));
  more.setAttribute("aria-label", t("One more {0}", [item.name]));
  return styled("span", "dsc-stepper", fewer, el("span", String(item.quantity)), more);
}

/** The attunement toggle and, when it cannot change, the reason. */
export function attuneControl(
  view: SheetView,
  item: Item,
): { control: HTMLButtonElement; reason: string } {
  const t = translator(view.locale),
    eligibility = object(view.equipment[item.id]),
    choice = attunementChoice(item, view.equipment);
  const control = button(
    item.attuned ? "★" : "☆",
    () => {
      if (attuneEquipment(item, !item.attuned, view.equipment)) {
        view.change();
        view.refresh();
      }
    },
    !item.attuned && !choice.allowed,
  );
  control.setAttribute("aria-label", t("Attune {0}", [item.name]));
  control.setAttribute("aria-pressed", String(item.attuned));
  const reason = equipmentReason(
    item.attuned ? eligibility["attuneReason"] : choice.reason,
    view.locale,
  );
  if (reason) {
    control.title = reason;
    control.setAttribute("aria-description", reason);
  }
  return { control: focusKey(control, item, "attune"), reason };
}

export function locationSelect(view: SheetView, item: Item): HTMLSelectElement {
  const t = translator(view.locale),
    eligibility = object(view.equipment[item.id]);
  const control = select(
    item.location,
    ["equipped", "carried", "stored"].map((id) => ({
      id,
      label: t(label(id)),
      disabled: id === "equipped" && eligibility["canEquip"] !== true,
    })),
    (value) => {
      if (
        value &&
        moveEquipment(view.input.play.inventory, item.id, value, view.equipment, view.projection)
      ) {
        view.change();
        view.refresh();
      }
    },
    t,
  );
  control.className = "dse-item-location";
  control.setAttribute("aria-label", t("Move {0}", [item.name]));
  return focusKey(control, item, "move");
}

export function removeButton(view: SheetView, item: Item, label = "×"): HTMLButtonElement {
  const control = button(label, () => {
    removeInventoryItem(view.input, item.id);
    view.change();
    view.refresh();
  });
  control.setAttribute("aria-label", translator(view.locale)("Remove {0}", [item.name]));
  return focusKey(control, item, "remove");
}

export function quickUseButton(view: SheetView, item: Item): HTMLButtonElement {
  const t = translator(view.locale),
    pinned = (view.input.play.quickUse ?? []).includes(item.id);
  const control = button(
    t("Quick use"),
    () => {
      if (pinQuickUse(view.input, item.id, !pinned)) {
        view.change();
        view.refresh();
      }
    },
    !view.canEditQuickUse,
  );
  control.setAttribute("aria-label", t("Quick use: {0}", [item.name]));
  control.setAttribute("aria-pressed", String(pinned));
  return focusKey(control, item, "quick-use");
}

/** The ★ that pins an item to Quick use in lists. */
export function pinStar(view: SheetView, item: Item): HTMLButtonElement {
  const pinned = (view.input.play.quickUse ?? []).includes(item.id);
  const control = button(
    pinned ? "★" : "☆",
    () => {
      if (pinQuickUse(view.input, item.id, !pinned)) {
        view.change();
        view.refresh();
      }
    },
    !view.canEditQuickUse,
    "pack/" + item.id + "/pin",
  );
  control.className = "dsc-pin";
  control.setAttribute("aria-label", translator(view.locale)("Quick use: {0}", [item.name]));
  control.setAttribute("aria-pressed", String(pinned));
  return control;
}

/** Stow & unattune for an attuned item; afterwards focus moves to `next`. */
export function stowButton(
  view: SheetView,
  item: Item,
  next?: HTMLElement,
): HTMLButtonElement | undefined {
  if (!item.attuned) return undefined;
  const t = translator(view.locale);
  const control = button(t("Stow & unattune"), () => {
    if (stowAndUnattune(item)) {
      next?.focus();
      view.change();
      view.refresh();
    }
  });
  control.setAttribute("aria-label", t("Stow & unattune {0}", [item.name]));
  return focusKey(control, item, "stow");
}

// Rules items show their weight; custom items, and items the rules give no
// weight, take one in pounds for each unit.
export function itemWeight(view: SheetView, item: Item): HTMLElement {
  const t = translator(view.locale),
    known = object(object(object(view.projection?.sheet["carrying"])["items"])[item.id]);
  if (item.reference && known["custom"] === false && item.weightLb === undefined)
    return el(
      "p",
      t("Weight: {0} each", [weightText(known["eachLb"], view.locale)]) +
        (item.quantity > 1
          ? " · " + t("{0} in total", [weightText(known["totalLb"], view.locale)])
          : ""),
    );
  const control = numberInput(
    item.weightLb,
    (value) => {
      if (value === undefined) delete item.weightLb;
      else item.weightLb = value;
      view.change();
    },
    0,
    100000,
  );
  control.step = "any";
  return field(
    "inventory/" + item.id + "/weight",
    t("Weight in lb, each"),
    focusKey(control, item, "weight"),
  );
}

/** Name, magic weapon or armor picks, weight, acquisition, notes and scroll spell. */
export function itemFields(view: SheetView, item: Item): HTMLElement[] {
  const t = translator(view.locale);
  return [
    field(
      "inventory/" + item.id + "/name",
      t("Name"),
      textInput(item.name, (value) => {
        item.name = value;
        view.change();
      }),
    ),
    ...gearFields(view, item),
    itemWeight(view, item),
    field(
      "inventory/" + item.id + "/acquisition",
      t("Acquired from"),
      textInput(item.acquisition, (value) => {
        item.acquisition = value;
        view.change();
      }),
    ),
    field(
      "inventory/" + item.id + "/notes",
      t("Notes"),
      textInput(
        item.notes,
        (value) => {
          item.notes = value;
          view.change();
        },
        true,
      ),
    ),
    field(
      "inventory/" + item.id + "/scroll-spell",
      t("Scroll spell (optional)"),
      select(
        item.spellId ?? "",
        (view.catalogs.get("spell") ?? []).map((row) => ({
          id: row.id,
          label: text(row.value["name"], row.id),
        })),
        (value) => {
          if (value) item.spellId = value;
          else delete item.spellId;
          view.change();
        },
        t,
      ),
    ),
  ];
}

/** Why an item cannot be attuned or equipped, once each. */
export function itemReasons(view: SheetView, item: Item, attuneReason: string): HTMLElement[] {
  const t = translator(view.locale),
    equipReason = equipmentReason(object(view.equipment[item.id])["equipReason"], view.locale);
  return [
    ...(attuneReason ? [el("p", t("Attunement") + ": " + attuneReason)] : []),
    ...(equipReason && equipReason !== attuneReason
      ? [el("p", t("Equipment") + ": " + equipReason)]
      : []),
  ];
}
