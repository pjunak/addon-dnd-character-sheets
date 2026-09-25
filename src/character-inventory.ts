import type { Inputs, Item, Projection } from "./character-model.js";
import { object } from "./character-client.js";
import { translator } from "./character-locale.js";

export function pinQuickUse(input: Inputs, id: string, pinned: boolean): boolean {
  if (pinned && !input.play.inventory.some(item => item.id === id)) return false;
  const current = input.play.quickUse ?? [];
  if (current.includes(id) === pinned) return false;
  const next = pinned ? [...current, id] : current.filter(itemId => itemId !== id);
  if (next.length) input.play.quickUse = next; else delete input.play.quickUse;
  return true;
}

export function removeInventoryItem(input: Inputs, id: string): void {
  input.play.inventory = input.play.inventory.filter(item => item.id !== id);
  pinQuickUse(input, id, false);
}

export function quickUseReason(reason: unknown, locale: string): string {
  const t = translator(locale);
  switch (reason) {
    case "empty": return t("No items remaining.");
    case "stored": return t("Carry this item before using it.");
    case "missing": return t("This inventory entry is missing. Remove its pin.");
    case "build": return t("Complete the character's required choices before using items.");
    default: return "";
  }
}

export type EquipmentSlot = "armor" | "shield" | "worn" | "attuned";
export type EquipmentGuidance = Record<string, unknown>;

export function equipmentSlot(item: Item, guidance: EquipmentGuidance, projection?: Projection): Exclude<EquipmentSlot, "attuned"> {
  const slot = object(guidance[item.id])["slot"] ?? object(object(projection?.sheet["equipment"])[item.id])["slot"];
  if (slot === "armor" || slot === "shield" || slot === "worn") return slot;
  // Older saved projections have source facts but no per-instance slot facts.
  // Reading them must not depend on whichever live catalog is installed today.
  const facts = item.reference ? projection?.evidence.find(source => source.reference.kind === item.reference!.kind && source.reference.id === item.reference!.id)?.facts : undefined;
  const armor = facts?.["armorType"];
  return armor === "shield" ? "shield" : typeof armor === "string" && armor ? "armor" : "worn";
}

export function moveEquipment(inventory: Item[], id: string, location: string, guidance: EquipmentGuidance, projection?: Projection): boolean {
  const item = inventory.find(item => item.id === id);
  if (!item || !["equipped", "carried", "stored"].includes(location)) return false;
  if (location === "equipped") {
    if (object(guidance[id])["canEquip"] !== true) return false;
    const slot = equipmentSlot(item, guidance, projection);
    if (slot === "armor" || slot === "shield") for (const other of inventory) {
      if (other.id !== id && other.location === "equipped" && equipmentSlot(other, guidance, projection) === slot) other.location = "carried";
    }
  }
  item.location = location;
  return true;
}

export function attunementChoice(item: Item, guidance: EquipmentGuidance): { allowed: boolean; reason?: unknown } {
  if (item.quantity <= 0) return { allowed: false, reason: "empty" };
  const eligibility = object(guidance[item.id]);
  if (eligibility["canAttune"] !== true) return { allowed: false, reason: eligibility["attuneReason"] };
  if (item.location !== "equipped") return { allowed: false, reason: "not-equipped" };
  return { allowed: true };
}

export function attuneEquipment(item: Item, attuned: boolean, guidance: EquipmentGuidance): boolean {
  // Selecting a new allocation requires equipped gear; saved allocations remain
  // valid in other locations and can always be explicitly released.
  if (attuned && !attunementChoice(item, guidance).allowed) return false;
  item.attuned = attuned;
  return true;
}

export function stowAndUnattune(item: Item): boolean {
  if (!item.attuned) return false;
  item.location = "stored";
  item.attuned = false;
  return true;
}

export function equipmentReason(reason: unknown, locale: string): string {
  const t = translator(locale);
  switch (reason) {
    case "empty": return t("Increase the quantity before using this item.");
    case "not-equipped": return t("Equip this item before attuning it.");
    case "source": return t("This item's rules source is unavailable.");
    case "mechanics": return t("This item needs supported rules or active DM mechanics.");
    case "not-required": return t("This item does not require attunement.");
    case "build": return t("Choose abilities, species, background and a class before attuning items.");
    case "capacity": return t("All attunement slots are in use. Unattune an item first.");
    case "duplicate": return t("Another copy of this item is already attuned.");
    case "prerequisite": return t("Meet this item's prerequisite or record a DM ruling.");
    default: return "";
  }
}
