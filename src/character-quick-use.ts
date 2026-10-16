import type { Inputs, Projection } from "./character-model.js";
import type { SheetView } from "./character-sheet.js";
import { object } from "./character-client.js";
import { pinQuickUse, quickUseReason } from "./character-inventory.js";
import { translator } from "./character-locale.js";
import { button, el, hint, label, panel, rule, styled } from "./character-ui.js";

function pinRow(
  input: Inputs,
  projection: Projection | undefined,
  id: string,
  locale: string,
): HTMLElement {
  const t = translator(locale),
    item = input.play.inventory.find((item) => item.id === id);
  const row = styled("div", "dse-quick-use-item");
  row.dataset["quickUseItem"] = id;
  row.dataset["focusScope"] = "";
  if (!item) {
    row.append(el("p", quickUseReason("missing", locale)));
    return row;
  }
  const quantity = styled("span", "dse-quick-use-quantity", "×" + item.quantity);
  quantity.title = t("Quantity: {0}", [item.quantity]);
  row.append(
    styled(
      "div",
      "dse-quick-use-name",
      rule(item.name, item.reference, undefined, undefined, projection),
      el("small", t(label(item.location))),
    ),
    quantity,
  );
  if (item.notes)
    row.append(
      styled("details", "dse-quick-use-notes", el("summary", t("Notes")), el("p", item.notes)),
    );
  return row;
}

export function quickUseRead(
  input: Inputs,
  projection: Projection | undefined,
  locale: string,
): HTMLElement {
  const t = translator(locale),
    root = panel(t("Quick use"));
  root.className = "dse-section dse-quick-use";
  const heading = root.querySelector<HTMLElement>("h2,h3")!;
  heading.tabIndex = -1;
  heading.dataset["focusKey"] = "quick-use/heading";
  for (const id of input.play.quickUse ?? []) root.append(pinRow(input, projection, id, locale));
  if (!input.play.quickUse?.length)
    root.append(el("p", t("Pin inventory entries from your backpack for quick access here.")));
  return root;
}

export function quickUse(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    root = quickUseRead(view.input, view.projection, view.locale);
  if (view.input.play.quickUse?.length)
    root
      .querySelector("h3")!
      .append(hint(t("Using one records the quantity spent. Apply its effects separately.")));
  for (const row of root.querySelectorAll<HTMLElement>("[data-quick-use-item]")) {
    const id = row.dataset["quickUseItem"]!,
      item = view.input.play.inventory.find((item) => item.id === id),
      eligibility = object(view.quickUse[id]);
    const reason = quickUseReason(eligibility["reason"], view.locale);
    if (reason) row.append(el("p", reason));
    const controls = styled("div", "dnd-workflow-controls");
    const use = button(
      t("Use one"),
      () => view.act({ operation: "consume-item", itemId: id }),
      !view.canPlay || eligibility["canUse"] !== true,
      "quick-use/" + id + "/use",
    );
    use.setAttribute("aria-label", t("Use one: {0}", [item?.name ?? id]));
    if (reason) use.setAttribute("aria-description", reason);
    controls.append(use);
    if (view.canEditQuickUse) {
      // The filled star unpins, matching the pin stars in the backpack.
      const unpin = button(
        "★",
        () => {
          const rows = [...root.querySelectorAll<HTMLElement>("[data-quick-use-item]")],
            index = rows.indexOf(row);
          const next = rows[index + 1] ?? rows[index - 1];
          (
            next?.querySelector<HTMLElement>("[data-quick-use-unpin]") ??
            root.querySelector<HTMLElement>("[data-focus-key='quick-use/heading']")
          )?.focus();
          if (pinQuickUse(view.input, id, false)) {
            view.change();
            view.refresh();
          }
        },
        false,
        "quick-use/" + id + "/unpin",
      );
      unpin.dataset["quickUseUnpin"] = "";
      unpin.className = "dse-unpin";
      unpin.setAttribute("aria-label", t("Unpin {0}", [item?.name ?? id]));
      unpin.title = unpin.getAttribute("aria-label")!;
      controls.append(unpin);
    }
    row.insertBefore(
      controls,
      row.querySelector(".dse-quick-use-notes") ?? row.querySelector(":scope > p"),
    );
  }
  return root;
}
