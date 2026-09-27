import { backpack } from "./character-sheet.js";
import { containerOptions } from "./character-inventory.js";
import { storage } from "./character-storage.js";
import { translator } from "./character-locale.js";
import { button, el, field, label, select, styled, textInput } from "./character-ui.js";
export function backpackDialog(view, state, add) {
    const t = translator(view.locale), root = styled("div", "dsc-backpack-dialog"), results = el("div"), count = el("p");
    count.setAttribute("role", "status");
    const filter = () => {
        const query = state.query.trim().toLocaleLowerCase(view.locale);
        const items = view.input.play.inventory.filter(item => (state.container === "" || (state.container === "none" ? !item.containerId : item.containerId === state.container)) &&
            [item.name, item.notes, item.reference?.kind ?? ""].join(" ").toLocaleLowerCase(view.locale).includes(query));
        items.sort((a, b) => (state.sort === "quantity" ? b.quantity - a.quantity : state.sort === "category" ? t(label(a.reference?.kind ?? "Other")).localeCompare(t(label(b.reference?.kind ?? "Other")), view.locale) : 0) || a.name.localeCompare(b.name, view.locale) || a.id.localeCompare(b.id));
        count.textContent = t("Inventory entries: {0}", [items.length]);
        results.replaceChildren(backpack(view, { items, heading: false, storage: false, coins: false, flat: true }));
    };
    const search = textInput(state.query, value => { state.query = value; filter(); });
    search.setAttribute("type", "search");
    search.dataset["ui"] = "search";
    search.dataset["focusKey"] = "pack/query";
    const compartment = select(state.container, [{ id: "none", label: t("No container") }, ...containerOptions(view.input.play.containers ?? [])], value => { state.container = value; filter(); }, t);
    compartment.options[0].textContent = t("All compartments");
    compartment.dataset["focusKey"] = "pack/container";
    const sort = select(state.sort, ["name", "category", "quantity"].map(id => ({ id, label: t(label(id)) })), value => { if (value) {
        state.sort = value;
        filter();
    } }, t);
    sort.options[0].remove();
    sort.dataset["focusKey"] = "pack/sort";
    root.append(styled("div", "dsc-pack-toolbar", field(t("Search inventory"), search), field(t("Compartment"), compartment), field(t("Sort by"), sort), button(t("Reset filters"), () => { state.query = ""; state.container = ""; state.sort = "name"; search.value = ""; compartment.value = ""; sort.value = "name"; filter(); }), button(t("Add item"), add, !view.editing, "pack/add")), count, results);
    const containers = el("details", el("summary", t("Storage containers")), storage(view));
    containers.dataset["detailsKey"] = "pack/containers";
    root.append(containers);
    filter();
    return root;
}
