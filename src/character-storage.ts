import type { Inputs, Item } from "./character-model.js";
import type { SheetView } from "./character-sheet.js";
import { newId } from "./character-client.js";
import { assignContainer, containerOptions, removeContainer } from "./character-inventory.js";
import { translator } from "./character-locale.js";
import { button, el, field, panel, select, styled, textInput } from "./character-ui.js";

export function storageRead(input: Inputs, locale: string): HTMLElement {
  const t = translator(locale), root = panel(t("Storage containers"));
  root.className = "dse-section dse-storage";
  for (const container of containerOptions(input.play.containers ?? [])) {
    const group = styled("section", "dse-storage-group", el("h4", container.label));
    group.dataset["container"] = container.id;
    const items = input.play.inventory.filter(item => item.containerId === container.id);
    group.append(items.length ? el("ul", ...items.map(item => el("li", item.name + " × " + item.quantity))) : el("p", t("Empty")));
    root.append(group);
  }
  if (!input.play.containers?.length) root.append(el("p", t("No containers yet.")));
  return root;
}

export function storage(view: SheetView): HTMLElement {
  if (!view.canEditStorage) return storageRead(view.input, view.locale);
  const t = translator(view.locale), root = panel(t("Storage containers"));
  root.className = "dse-section dse-storage";
  const heading = root.querySelector<HTMLElement>("h3")!; heading.tabIndex = -1; heading.dataset["focusKey"] = "storage/heading";
  root.append(el("p", t("Organize carried and stored items in named containers. This does not add items or set a carrying capacity.")));
  const maximum = Number(view.storage["maximumContainers"]), maximumName = Number(view.storage["maximumNameLength"]);
  const add = button(t("Add container"), () => {
    const containers = view.input.play.containers ?? [];
    if (!(containers.length < maximum)) return;
    const container = { id: newId(), name: t("New container") }, owner = root.closest(".addon-dnd-character");
    view.input.play.containers = [...containers, container];
    view.change(); view.refresh();
    const name = owner?.querySelector<HTMLInputElement>('[data-focus-key="storage/' + container.id + '/name"]');
    name?.focus(); name?.select();
  }, !(Number.isFinite(maximum) && (view.input.play.containers?.length ?? 0) < maximum), "storage/add");
  root.append(add);
  for (const container of view.input.play.containers ?? []) {
    const row = styled("div", "dse-storage-group"); row.dataset["container"] = container.id; row.dataset["focusScope"] = "";
    const name = textInput(container.name, value => { container.name = value; view.change(); });
    name.required = true; if (Number.isFinite(maximumName)) name.maxLength = maximumName;
    name.dataset["focusKey"] = "storage/" + container.id + "/name";
    const nameField = field(t("Container name"), name); nameField.dataset["uiKey"] = "storage/" + container.id + "/name";
    const count = view.input.play.inventory.filter(item => item.containerId === container.id).length;
    const remove = button(t("Remove container"), () => {
      const rows = [...root.querySelectorAll<HTMLElement>("[data-container]")], index = rows.indexOf(row);
      const next = rows[index + 1] ?? rows[index - 1];
      (next?.querySelector<HTMLElement>("input") ?? heading).focus();
      if (removeContainer(view.input, container.id)) { view.change(); view.refresh(); }
    }, false, "storage/" + container.id + "/remove");
    remove.setAttribute("aria-label", t("Remove container: {0}", [container.name]));
    row.append(nameField, el("span", t("Inventory entries: {0}", [count])), remove); root.append(row);
  }
  root.append(el("p", t("Removing a container leaves its items in inventory.")));
  return root;
}

export function itemContainer(view: SheetView, item: Item): HTMLElement | undefined {
  const t = translator(view.locale), options = containerOptions(view.input.play.containers ?? []);
  if (!options.length && !item.containerId) return undefined;
  const selected = options.find(option => option.id === item.containerId);
  if (!view.canEditStorage) return item.containerId ? styled("span", "dse-item-container", t("Container: {0}", [selected?.label ?? item.containerId])) : undefined;
  const control = select(item.containerId ?? "", options.map(option => ({ ...option, disabled: item.location === "equipped" })), value => {
    if (assignContainer(view.input, item.id, value)) { view.change(); view.refresh(); }
  }, t);
  control.options[0]!.textContent = t("No container");
  control.dataset["focusKey"] = "inventory/" + item.id + "/container";
  control.setAttribute("aria-label", t("Container for {0}", [item.name]));
  const wrapper = field(t("Container"), control, item.location === "equipped" ? t("Unequip this item before assigning it to a container.") : undefined);
  wrapper.classList.add("dse-item-container"); wrapper.dataset["uiKey"] = "inventory/" + item.id + "/container";
  return wrapper;
}
