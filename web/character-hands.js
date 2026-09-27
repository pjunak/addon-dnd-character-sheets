import { savedRule } from "./character-sheet.js";
import { object, rows, strings } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, field, human, panel, select, signed, styled } from "./character-ui.js";
function restoreMessage(reason, locale) {
    const t = translator(locale);
    switch (reason) {
        case "missing": return t("The off-hand item was removed. The hand stays free.");
        case "empty": return t("The off-hand item was consumed. The hand stays free.");
        case "changed": return t("The off-hand item was moved or edited. It will not be restored automatically.");
        case "ineligible": return t("The off-hand item is no longer eligible. The hand stays free.");
        case "occupied": return t("Other equipment prevents restoring the off-hand item. The hand stays free.");
        default: return "";
    }
}
export function handsRead(input, projection, locale) {
    const t = translator(locale), hands = input.play.hands, root = panel(t("Hands and grip"));
    const name = (id) => id ? input.play.inventory.find(item => item.id === id)?.name ?? id : t("Free hand");
    root.append(el("p", t("Main hand: {0}", [name(hands?.main)])), el("p", t("Off hand: {0}", [name(hands?.off)])), el("p", t(hands?.grip === "two" ? "Two-handed grip" : "One-handed grip")));
    if (hands?.suspendedOff)
        root.append(styled("p", "dse-hand-suspended", t("Suspended off hand: {0}", [name(hands.suspendedOff.itemId)])), el("p", t("This item is carried and inactive; its attunement is retained.")));
    const reason = restoreMessage(object(projection?.sheet["hands"])["restoreReason"], locale);
    if (reason)
        root.append(el("p", reason));
    return root;
}
export function handControls(view, combat) {
    if (!view.canEditHands)
        return view.input.play.hands ? handsRead(view.input, view.projection, view.locale) : el("div");
    const t = translator(view.locale), hands = view.input.play.hands, two = hands?.grip === "two";
    const root = panel(t("Hands and grip")), joined = styled("div", "dse-hands"), options = rows(view.hands["options"]);
    root.dataset["hands"] = "";
    const draw = (hand) => {
        const chosen = hands?.[hand] ?? "", opposite = hands?.[hand === "main" ? "off" : "main"] ?? "";
        const choices = options.filter(option => option[hand === "main" ? "canMain" : "canOff"] === true || option["itemId"] === chosen).map(option => ({ id: String(option["itemId"]), label: String(option["name"]), disabled: option["itemId"] === opposite || option[hand === "main" ? "canMain" : "canOff"] !== true }));
        if (chosen && !choices.some(option => option.id === chosen))
            choices.push({ id: chosen, label: (view.input.play.inventory.find(item => item.id === chosen)?.name ?? chosen) + " — " + t("Unavailable"), disabled: true });
        const control = select(chosen, choices, itemId => view.act({ operation: "set-hand", hand, itemId }, t("Change hand item")), t);
        control.options[0].textContent = t("Free hand");
        control.disabled = hand === "off" && two;
        control.dataset["focusKey"] = "hands/" + hand;
        const wrapper = field(t(hand === "main" ? "Main hand" : "Off hand"), control);
        wrapper.dataset["uiKey"] = "hands/" + hand;
        if (hand === "off" && hands?.suspendedOff) {
            const item = view.input.play.inventory.find(item => item.id === hands.suspendedOff.itemId);
            wrapper.append(styled("p", "dse-hand-suspended", t("Suspended off hand: {0}", [item?.name ?? hands.suspendedOff.itemId])), el("small", t("This item is carried and inactive; its attunement is retained.")));
        }
        if (combat && chosen) {
            const weapons = rows(view.projection?.sheet["weapons"]), index = weapons.findIndex(weapon => weapon["itemId"] === chosen);
            if (index >= 0)
                wrapper.append(styled("p", "dse-hand-attack", savedRule(view.projection, t("Attack {0}", [signed(weapons[index]["attackBonus"])]), `weapons.${index}.attackBonus`), el("span", " · "), savedRule(view.projection, human(weapons[index]["damage"]), `weapons.${index}.damage`)));
        }
        return wrapper;
    };
    const grip = button(t("Two-handed grip"), () => view.act({ operation: "set-grip", grip: two ? "one" : "two" }, t("Change grip")), view.hands[two ? "canRelease" : "canTwo"] !== true);
    grip.dataset["focusKey"] = "hands/grip";
    grip.setAttribute("aria-pressed", String(two));
    if (two)
        grip.dataset["uiVariant"] = "primary";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(icon.namespaceURI, "path");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    path.setAttribute("d", "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2");
    icon.append(path);
    grip.prepend(icon);
    joined.append(draw("main"), grip, draw("off"));
    root.append(joined);
    if (two && !strings(view.hands["grips"]).includes("one"))
        root.append(el("p", t("This weapon requires two hands.")));
    const reason = restoreMessage(view.hands["restoreReason"] || object(view.projection?.sheet["hands"])["restoreReason"], view.locale);
    if (reason)
        root.append(el("p", reason));
    root.append(el("small", t("Equipment changes do not track turn or action costs.")));
    return root;
}
