import { abilityRail, attackDetails, castingDetails, currency, explorationDetails, resourceDetails, savedRule, sizeDetails, wornEquipment } from "./character-sheet.js";
import { abilities, object, rows, strings } from "./character-client.js";
import { assignBodyPlacement, containerOptions, moveEquipment, stowAndUnattune } from "./character-inventory.js";
import { bodyPlacementLabel } from "./character-placement.js";
import { handControls } from "./character-hands.js";
import { quickUse } from "./character-quick-use.js";
import { abilityNames, translator } from "./character-locale.js";
import { button, el, field, human, numberInput, panel, signed, styled } from "./character-ui.js";
export function compactNavigation(nav) {
    const paths = {
        sheet: "M4 3h16v18H4ZM9 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM7 18v-2a5 5 0 0 1 10 0v2",
        combat: "m4 3 7 7-2 2-7-7V3ZM20 3v2L5 20l-2-2L18 3ZM3 14l7 7M14 3l7 7M15 14l5 6-2 2-5-6",
        equipment: "M8 6V4a4 4 0 0 1 8 0v2M5 6h14v15H5ZM5 11h14M9 11v4h6v-4",
        spells: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
        builder: "m3 19 9-9 3 3-9 9ZM9 5l4-3 8 8-3 4Z",
        tools: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
    };
    for (const control of nav.querySelectorAll("button")) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(svg.namespaceURI, "path");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        path.setAttribute("d", paths[control.id.replace("dnd-tab-", "")] ?? "");
        svg.append(path);
        control.prepend(svg);
    }
}
export function compactVitals(view) {
    const t = translator(view.locale), derived = object(view.projection?.sheet["derived"]);
    const root = styled("div", "dsc-vitals");
    root.setAttribute("aria-label", t("Core character values"));
    const hp = styled("section", "dsc-stat dsc-health", styled("span", "dsc-stat-label", t("Hit points")));
    const current = numberInput(view.input.play.hp, value => { view.input.play.hp = value ?? 0; view.change(); paint(); }, 0, Number(derived["maxHp"] ?? 0));
    current.disabled = !view.canEditHP;
    current.setAttribute("aria-label", t("Current HP"));
    current.dataset["focusKey"] = "vitals/current-hp";
    const bar = styled("div", "dsc-health-track", el("span"));
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", t("Current health"));
    const maximum = Number(derived["maxHp"] ?? 0);
    const paint = () => {
        const value = view.input.play.hp, ratio = maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
        bar.style.setProperty("--health", ratio * 100 + "%");
        bar.dataset["health"] = ratio > .5 ? "high" : ratio > .25 ? "medium" : "low";
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", String(maximum));
        bar.setAttribute("aria-valuenow", String(value));
    };
    paint();
    const temporary = numberInput(view.input.play.temporaryHp, value => { view.input.play.temporaryHp = value ?? 0; view.change(); }, 0);
    temporary.disabled = !view.canPlay;
    temporary.setAttribute("aria-label", t("Temporary HP"));
    temporary.dataset["focusKey"] = "vitals/temporary-hp";
    hp.append(styled("div", "dsc-hp-values", current, el("span", "/"), savedRule(view.projection, human(derived["maxHp"]), "derived.maxHp")), bar, styled("label", "dsc-temp", t("Temporary HP"), temporary));
    root.append(hp);
    for (const [name, key, sign] of [["Armor class", "armorClass", false], ["Speed", "speed", false], ["Proficiency", "proficiencyBonus", true]]) {
        const card = styled("section", "dsc-stat", styled("span", "dsc-stat-label", t(name)), el("strong", savedRule(view.projection, sign ? signed(derived[key]) : human(derived[key]), "derived." + key)));
        if (view.projection?.explanations["derived." + key]?.unit)
            card.append(el("small", view.projection.explanations["derived." + key].unit));
        card.dataset["stat"] = key;
        root.append(card);
    }
    const inspiration = styled("label", "dsc-stat dsc-inspiration"), toggle = el("input");
    toggle.type = "checkbox";
    toggle.checked = view.input.play.inspiration === true;
    toggle.disabled = !view.canEditInspiration;
    toggle.setAttribute("aria-label", t("Inspiration"));
    toggle.dataset["focusKey"] = "vitals/inspiration";
    toggle.addEventListener("change", () => { view.input.play.inspiration = toggle.checked; view.change(); view.refresh(); });
    const star = el("span", view.input.play.inspiration ? "★" : "☆");
    star.setAttribute("aria-hidden", "true");
    inspiration.append(toggle, styled("span", "dsc-stat-label", t("Inspiration")), star, el("small", t(view.input.play.inspiration ? "Ready" : "Not active")));
    root.append(inspiration);
    return root;
}
function combatAbilities(view) {
    const t = translator(view.locale), sheet = view.projection?.sheet ?? {}, root = styled("div", "dsc-combat-abilities");
    root.setAttribute("aria-label", t("Ability modifiers and saving throws"));
    for (const ability of abilities) {
        const score = object(object(sheet["abilities"])[ability]), save = object(object(sheet["saves"])[ability]);
        const shield = styled("span", "dse-dot dse-shield");
        shield.dataset["proficient"] = String(save["proficient"] === true);
        shield.setAttribute("role", "img");
        shield.setAttribute("aria-label", t("{0} — saving throw: {1}", [t(abilityNames[ability]), t(save["proficient"] ? "Proficient" : "Untrained")]));
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(svg.namespaceURI, "path");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        path.setAttribute("d", "M12 2.4 19.3 5.3V11c0 4.8-3.3 8.6-7.3 10.5C8 19.6 4.7 15.8 4.7 11V5.3Z");
        svg.append(path);
        shield.append(svg);
        root.append(styled("section", "dsc-combat-ability", el("small", ability), el("strong", savedRule(view.projection, signed(score["mod"]), "abilities." + ability + ".mod")), styled("span", "dsc-save", shield, savedRule(view.projection, signed(save["total"]), "saves." + ability + ".total"))));
    }
    return root;
}
function combatReference(view) {
    const t = translator(view.locale), sheet = view.projection?.sheet ?? {}, derived = object(sheet["derived"]), root = styled("aside", "dsc-reference");
    for (const [name, key, sign] of [["Initiative", "initiative", true], ["Passive perception", "passivePerception", false]]) {
        root.append(styled("div", "dsc-reference-row", el("span", t(name)), savedRule(view.projection, sign ? signed(derived[key]) : human(derived[key]), "derived." + key)));
    }
    rows(object(sheet["spellcasting"])["perClass"]).forEach((caster, index) => root.append(castingDetails(view, caster, index)));
    return root;
}
function exploration(view) {
    const t = translator(view.locale), root = panel(t("Exploration")), contents = explorationDetails(view);
    root.classList.add("dsc-exploration");
    if (Object.hasOwn(object(view.projection?.sheet["derived"]), "size"))
        root.append(styled("p", "dsc-size", styled("span", "dse-stat-label", t("Size")), " ", sizeDetails(view)));
    for (const [index, section] of [...contents.children].entries()) {
        const title = section.querySelector("h3")?.textContent ?? t("Details");
        const details = el("details", el("summary", title), section);
        details.dataset["detailsKey"] = "exploration/" + index;
        root.append(details);
    }
    return root;
}
export function compactSheet(view, combat, rest, openBackpack) {
    const t = translator(view.locale), root = styled("div", combat ? "dsc-combat" : "dsc-sheet"), pins = quickUse(view);
    pins.querySelector("h3")?.append(button(t("Arrange"), openBackpack, false, "quick-use/arrange"));
    const ready = styled("div", "dsc-ready", pins, resourceDetails(view));
    if (combat) {
        const attacks = el("details", el("summary", t("All attacks")), attackDetails(view));
        attacks.dataset["detailsKey"] = "combat/attacks";
        const recovery = el("details", el("summary", t("Rest and recovery")), rest);
        recovery.dataset["detailsKey"] = "combat/recovery";
        root.append(styled("div", "dsc-top", compactVitals(view), combatReference(view)), combatAbilities(view), handControls(view, true), ready, attacks, hpActions(view), recovery, exploration(view));
    }
    else {
        root.append(styled("div", "dsc-sheet-main", compactVitals(view), handControls(view, false), ready, hpActions(view), exploration(view)), abilityRail(view));
    }
    return root;
}
function hpActions(view) {
    const t = translator(view.locale), root = styled("details", "dsc-adjustments", el("summary", t("Adjust hit points")));
    root.dataset["detailsKey"] = "hp/actions";
    const commands = styled("div", "dnd-workflow-controls");
    for (const [operation, title] of [["damage", "Damage"], ["heal", "Heal"], ["set-temporary-hp", "Temporary HP"]])
        commands.append(button(t(title), () => {
            const amount = numberInput(1, () => { }, 0), area = styled("div", "dse-hp-adjust", field(t("Amount"), amount), button(t(title), () => { if (amount.reportValidity())
                return view.act({ operation, amount: amount.valueAsNumber }, t(title)); }));
            root.querySelector(".dse-hp-adjust")?.remove();
            root.append(area);
            amount.focus();
            amount.select();
        }, !view.canPlay));
    root.append(commands);
    return root;
}
const bodyPlaces = ["head", "face", "body", "neck", "wrists", "shoulders", "legs", "waist", "feet", "gloves"];
function mannequin() {
    const root = styled("div", "dsc-body");
    root.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 420");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M80 12c-24 0-24 49 0 49s24-49 0-49ZM67 62l-2 14-23 13-16 62L13 235q0 22 10 24l8-20 9-56 13-37 8 84-9 154-14 21q-4 8 9 8h25l3-160 10 0 3 160h25q13 0 9-8l-14-21-9-154 8-84 13 37 9 56 8 20q10-2 10-24l-13-84-16-62-23-13-2-14Z");
    svg.append(path);
    root.append(svg);
    return root;
}
export function compactEquipment(view, openBackpack, openPlacement) {
    const t = translator(view.locale), worn = panel(t("Worn equipment")), doll = styled("div", "dsc-mannequin", mannequin());
    for (const place of bodyPlaces) {
        const items = view.input.play.inventory.filter(item => item.quantity > 0 && item.location === "equipped" && item.bodyPlacement === place);
        const slot = button("", () => openPlacement(place), false, "placement/" + place);
        slot.className = "dsc-body-slot";
        slot.dataset["placement"] = place;
        slot.append(el("small", bodyPlacementLabel(place, view.locale)), el("span", items.length ? items.map(item => item.name).join(", ") : t("Add item")));
        slot.setAttribute("aria-label", t("Choose {0}", [bodyPlacementLabel(place, view.locale)]));
        doll.append(slot);
    }
    worn.append(doll);
    const other = panel(t("Other worn"));
    other.querySelector("h3")?.append(button(t("Add item"), () => openPlacement("other"), !view.canEditPlacement, "placement/other"));
    const unplaced = view.input.play.inventory.filter(item => item.quantity > 0 && item.location === "equipped" && (!item.bodyPlacement || !bodyPlaces.includes(item.bodyPlacement)) && ![view.input.play.hands?.main, view.input.play.hands?.off].includes(item.id));
    for (const item of unplaced) {
        const row = styled("div", "dsc-worn-item", savedRule(view.projection, item.name, undefined, item.reference));
        if (view.editing)
            row.append(button(t(item.attuned ? "Stow & unattune" : "Stow"), () => {
                if (item.attuned ? stowAndUnattune(item) : moveEquipment(view.input.play.inventory, item.id, "carried", view.equipment, view.projection)) {
                    view.change();
                    view.refresh();
                }
            }, false, "worn/" + item.id));
        other.append(row);
    }
    if (!unplaced.length)
        other.append(el("p", t("No other worn items.")));
    const storage = panel(t("Storage"));
    storage.querySelector("h3")?.append(button(t("Add item"), view.addItem, !view.editing, "equipment/add"));
    const pack = button("", () => openBackpack(), false, "storage/open");
    pack.className = "dsc-pack-open";
    pack.append(el("strong", t("Backpack")), el("span", t("Inventory entries: {0}", [view.input.play.inventory.length])), el("span", t("Open")));
    storage.append(pack);
    const containers = styled("div", "dsc-container-cards");
    for (const container of containerOptions(view.input.play.containers ?? []))
        containers.append(button(container.label, () => openBackpack(container.id), false, "storage/open/" + container.id));
    storage.append(containers);
    const attunement = panel(t("Attuned items")), allocations = wornEquipment(view, ["attuned"]);
    allocations.querySelector(":scope > .dse-stat-label")?.remove();
    attunement.append(allocations);
    const controls = el("details", el("summary", t("Equipment controls")), wornEquipment(view, ["armor", "shield", "worn"]));
    controls.dataset["detailsKey"] = "equipment/controls";
    const coins = panel(t("Currency"), currency(view));
    coins.classList.add("dsc-currency");
    return styled("div", "dsc-equipment", styled("div", "dsc-equipment-columns", styled("div", "dsc-equipment-column", worn, other), styled("div", "dsc-equipment-column", storage, attunement, controls)), coins);
}
export function placementPicker(view, place) {
    const t = translator(view.locale), root = styled("div", "dsc-placement-picker"), own = view.input.play.inventory.filter(item => item.location === "equipped" && item.bodyPlacement === place);
    for (const item of own) {
        const row = styled("div", "dsc-worn-item", savedRule(view.projection, item.name, undefined, item.reference));
        if (view.editing)
            row.append(button(t(item.attuned ? "Stow & unattune" : "Stow"), () => { if (item.attuned ? stowAndUnattune(item) : moveEquipment(view.input.play.inventory, item.id, "carried", view.equipment, view.projection)) {
                view.change();
                view.refresh();
            } }, false, "placement/stow/" + item.id));
        root.append(row);
    }
    if (!view.canEditPlacement) {
        if (!own.length)
            root.append(el("p", t("Empty")));
        return root;
    }
    const candidates = view.input.play.inventory.filter(item => item.quantity > 0 && item.bodyPlacement !== place && strings(object(view.equipment[item.id])["bodyPlacements"]).includes(place));
    for (const item of candidates)
        root.append(button(item.name, () => {
            if (!moveEquipment(view.input.play.inventory, item.id, "equipped", view.equipment, view.projection))
                return;
            assignBodyPlacement(item, place, view.equipment);
            view.change();
            view.refresh();
        }, object(view.equipment[item.id])["canEquip"] !== true, "placement/choose/" + item.id));
    if (!candidates.length)
        root.append(el("p", t("No compatible inventory items.")));
    root.append(button(t("Add item"), view.addItem));
    return root;
}
