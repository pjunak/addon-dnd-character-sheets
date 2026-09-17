import { object } from "./character-client.js";
import { translator } from "./character-locale.js";
export function equipmentSlot(item, guidance, projection) {
    const slot = object(guidance[item.id])["slot"] ?? object(object(projection?.sheet["equipment"])[item.id])["slot"];
    if (slot === "armor" || slot === "shield" || slot === "worn")
        return slot;
    // Older saved projections have source facts but no per-instance slot facts.
    // Reading them must not depend on whichever live catalog is installed today.
    const facts = item.reference ? projection?.evidence.find(source => source.reference.kind === item.reference.kind && source.reference.id === item.reference.id)?.facts : undefined;
    const armor = facts?.["armorType"];
    return armor === "shield" ? "shield" : typeof armor === "string" && armor ? "armor" : "worn";
}
export function moveEquipment(inventory, id, location, guidance, projection) {
    const item = inventory.find(item => item.id === id);
    if (!item || !["equipped", "carried", "stored"].includes(location))
        return false;
    if (location === "equipped") {
        if (object(guidance[id])["canEquip"] !== true)
            return false;
        const slot = equipmentSlot(item, guidance, projection);
        if (slot === "armor" || slot === "shield")
            for (const other of inventory) {
                if (other.id !== id && other.location === "equipped" && equipmentSlot(other, guidance, projection) === slot)
                    other.location = "carried";
            }
    }
    item.location = location;
    return true;
}
export function attuneEquipment(item, attuned, guidance) {
    if (attuned && object(guidance[item.id])["canAttune"] !== true)
        return false;
    item.attuned = attuned;
    return true;
}
export function equipmentReason(reason, locale) {
    const t = translator(locale);
    switch (reason) {
        case "empty": return t("Increase the quantity before using this item.");
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
