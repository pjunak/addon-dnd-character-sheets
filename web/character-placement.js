import { object } from "./character-client.js";
import { assignBodyPlacement } from "./character-inventory.js";
import { translator } from "./character-locale.js";
import { field, label, select, styled } from "./character-ui.js";
export function bodyPlacementLabel(id, locale) {
    const t = translator(locale);
    return id === "other" ? t("Other worn") : t(label(id));
}
export function itemBodyPlacement(view, item) {
    const t = translator(view.locale), facts = object(view.equipment[item.id]);
    const places = Array.isArray(facts["bodyPlacements"]) ? facts["bodyPlacements"].filter((id) => typeof id === "string") : [];
    const name = (id) => bodyPlacementLabel(id, view.locale);
    if (!view.canEditPlacement)
        return item.bodyPlacement ? styled("span", "dse-item-placement", t("Body placement: {0}", [name(item.bodyPlacement)])) : undefined;
    if (!item.bodyPlacement && (item.location !== "equipped" || !places.length))
        return undefined;
    const options = places.map(id => ({ id, label: name(id), disabled: facts["canEquip"] !== true || item.location !== "equipped" }));
    if (item.bodyPlacement && !places.includes(item.bodyPlacement))
        options.push({ id: item.bodyPlacement, label: name(item.bodyPlacement) + " — " + t("Unavailable"), disabled: true });
    const control = select(item.bodyPlacement ?? "", options, value => {
        if (assignBodyPlacement(item, value, view.equipment)) {
            view.change();
            view.refresh();
        }
    }, t);
    control.options[0].textContent = t("Unassigned");
    control.dataset["focusKey"] = "inventory/" + item.id + "/body-placement";
    control.setAttribute("aria-label", t("Body placement for {0}", [item.name]));
    const wrapper = field(t("Body placement"), control);
    wrapper.classList.add("dse-item-placement");
    wrapper.dataset["uiKey"] = "inventory/" + item.id + "/body-placement";
    return wrapper;
}
