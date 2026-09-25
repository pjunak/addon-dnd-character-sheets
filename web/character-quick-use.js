import { object } from "./character-client.js";
import { pinQuickUse, quickUseReason } from "./character-inventory.js";
import { translator } from "./character-locale.js";
import { button, el, label, panel, rule, styled } from "./character-ui.js";
function pinRow(input, projection, id, locale) {
    const t = translator(locale), item = input.play.inventory.find(item => item.id === id);
    const row = styled("div", "dse-quick-use-item");
    row.dataset["quickUseItem"] = id;
    row.dataset["focusScope"] = "";
    if (!item) {
        row.append(el("p", quickUseReason("missing", locale)));
        return row;
    }
    row.append(styled("div", "dse-quick-use-name", rule(item.name, item.reference, undefined, undefined, projection), el("span", t("Quantity: {0}", [item.quantity]) + " · " + t(label(item.location)))));
    if (item.notes)
        row.append(styled("details", "dse-quick-use-notes", el("summary", t("Notes")), el("p", item.notes)));
    return row;
}
export function quickUseRead(input, projection, locale) {
    const t = translator(locale), root = panel(t("Quick use"));
    root.className = "dse-section dse-quick-use";
    const heading = root.querySelector("h2,h3");
    heading.tabIndex = -1;
    heading.dataset["focusKey"] = "quick-use/heading";
    for (const id of input.play.quickUse ?? [])
        root.append(pinRow(input, projection, id, locale));
    if (!(input.play.quickUse?.length))
        root.append(el("p", t("Pin inventory entries from your backpack for quick access here.")));
    return root;
}
export function quickUse(view) {
    const t = translator(view.locale), root = quickUseRead(view.input, view.projection, view.locale);
    if (view.input.play.quickUse?.length)
        root.insertBefore(el("p", t("Using one records the quantity spent. Apply its effects separately.")), root.children[1] ?? null);
    for (const row of root.querySelectorAll("[data-quick-use-item]")) {
        const id = row.dataset["quickUseItem"], item = view.input.play.inventory.find(item => item.id === id), eligibility = object(view.quickUse[id]);
        const reason = quickUseReason(eligibility["reason"], view.locale);
        if (reason)
            row.append(el("p", reason));
        const controls = styled("div", "dnd-workflow-controls");
        const use = button(t("Use one"), () => view.act({ operation: "consume-item", itemId: id }, t("Use one: {0}", [item?.name ?? id])), !view.canPlay || eligibility["canUse"] !== true, "quick-use/" + id + "/use");
        use.setAttribute("aria-label", t("Use one: {0}", [item?.name ?? id]));
        if (reason)
            use.setAttribute("aria-description", reason);
        controls.append(use);
        if (view.canEditQuickUse) {
            const unpin = button(t("Unpin"), () => {
                const rows = [...root.querySelectorAll("[data-quick-use-item]")], index = rows.indexOf(row);
                const next = rows[index + 1] ?? rows[index - 1];
                (next?.querySelector("[data-quick-use-unpin]") ?? root.querySelector("[data-focus-key='quick-use/heading']"))?.focus();
                if (pinQuickUse(view.input, id, false)) {
                    view.change();
                    view.refresh();
                }
            }, false, "quick-use/" + id + "/unpin");
            unpin.dataset["quickUseUnpin"] = "";
            unpin.setAttribute("aria-label", t("Unpin {0}", [item?.name ?? id]));
            controls.append(unpin);
        }
        row.insertBefore(controls, row.querySelector(".dse-quick-use-notes") ?? row.querySelector(":scope > p"));
    }
    return root;
}
