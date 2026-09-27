import { containerOptions } from "./character-inventory.js";
import type { Container, Item } from "./character-model.js";
import type { CatalogRecord } from "./character-client.js";
import { newId } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, field, label, numberInput, rule, select, styled, textInput } from "./character-ui.js";

export function equipmentPicker(catalogs: Map<string, CatalogRecord[]>, locale: string, submit: (items: Item[], stacks: readonly string[]) => void, containers: readonly Container[] = [], initialDestination = "", inventory: readonly Item[] = []): HTMLElement {
  const t = translator(locale), root = styled("div", "dnd-equipment-picker"), catalog = ["armor", "weapon", "magic-item", "gear"].flatMap(kind => catalogs.get(kind) ?? []);
  const tray = new Map<string, { record: CatalogRecord; quantity: number; stack?: string }>();
  let category = "", folder = "", query = "", magic = "", destination = containers.some(container => container.id === initialDestination) ? initialDestination : "";
  const addItems = (items: Item[], stacks: readonly string[] = []): void => submit(items.map(item => destination ? { ...item, containerId: destination } : item), stacks);
  if (containers.length) {
    const control = select(destination, containerOptions(containers), value => { destination = value; for (const entry of tray.values()) delete entry.stack; render(); }, t);
    control.options[0]!.textContent = t("No container");
    root.append(field(t("Destination container"), control));
  }
  const path = styled("nav", "dnd-equipment-path"); path.setAttribute("aria-label", t("Equipment folders"));
  const results = styled("div", "dnd-picker-results"), selected = styled("div", "dnd-picker-tray");
  const categoryOf = (record: CatalogRecord): string => String(record.value["category"] ?? record.value["type"] ?? t("Other"));
  const render = (): void => {
    type.value = category;
    path.replaceChildren(button(t("All equipment"), () => { category = ""; folder = ""; render(); }));
    if (category) path.append(el("span", "›"), button(t(label(category)), () => { folder = ""; render(); }));
    if (folder) path.append(el("span", "›"), el("span", t(label(folder))));
    results.replaceChildren(); selected.replaceChildren(el("h3", t("Selected items")));
    if (!query && (!category || !folder)) {
      const folders = !category ? ["armor", "weapon", "magic-item", "gear"] : [...new Set(catalog.filter(row => row.kind === category).map(categoryOf))].sort();
      for (const id of folders) { const next = button("▸ " + t(label(id)), () => { if (!category) category = id; else folder = id; render(); }); next.className = "dnd-equipment-folder"; results.append(next); }
    }
    const filtered = catalog.filter(row => (!category || row.kind === category) && (!folder || categoryOf(row) === folder) && (!magic || (row.kind === "magic-item") === (magic === "magic")) && String(row.value["name"] ?? row.id).toLocaleLowerCase().includes(query));
    const visible = query || folder || magic ? filtered : [];
    for (const record of visible.slice(0, 200)) {
      const key = record.kind + ":" + record.id;
      const add = button(t("Add"), () => { const prior = tray.get(key); tray.set(key, { ...prior, record, quantity: (prior?.quantity ?? 0) + 1 }); render(); });
      add.setAttribute("aria-label", t("Add {0}", [String(record.value["name"] ?? record.id)]));
      results.append(styled("div", "dnd-picker-row", rule(String(record.value["name"] ?? record.id), { kind: record.kind, id: record.id }), add));
    }
    if ((query || folder) && !visible.length) results.append(el("p", t("No matching items.")));
    if (visible.length > 200) results.append(el("p", t("Refine your search to see more items.")));
    for (const [key, entry] of tray) {
      const name = String(entry.record.value["name"] ?? entry.record.id), quantity = numberInput(entry.quantity, value => { entry.quantity = value ?? 1; }, 1);
      quantity.setAttribute("aria-label", t("{0} quantity", [name]));
      const remove = button("×", () => { tray.delete(key); render(); }); remove.setAttribute("aria-label", t("Remove {0}", [name]));
      const row = styled("div", "dnd-picker-row", el("span", name), quantity, remove);
      const stacks = inventory.filter(item => item.reference?.kind === entry.record.kind && item.reference.id === entry.record.id && item.location === "carried" && !item.attuned && (item.containerId ?? "") === destination);
      if (stacks.length) {
        const stack = select(entry.stack ?? "", stacks.map((item, index) => ({ id: item.id, label: t("{0} · quantity {1} · stack {2}", [item.name, item.quantity, index + 1]) })), value => { if (value) entry.stack = value; else delete entry.stack; }, t);
        stack.options[0]!.textContent = t("New inventory entry"); row.append(field(t("Add to"), stack));
      }
      selected.append(row);
    }
    if (!tray.size) selected.append(styled("p", "dse-empty", t("Choose items to add to your backpack.")));
    selected.append(button(t("Add selected items"), () => {
      if (![...root.querySelectorAll<HTMLInputElement>("input")].every(input => input.reportValidity())) return;
      addItems([...tray.values()].map(({ record, quantity, stack }) => ({ id: stack ?? newId(), reference: { kind: record.kind, id: record.id }, name: String(record.value["name"] ?? record.id), quantity, location: "carried", attuned: false, acquisition: "", notes: "" })), [...tray.values()].flatMap(entry => entry.stack ? [entry.stack] : []));
    }, !tray.size));
  };
  const search = textInput("", value => { query = value.toLocaleLowerCase().trim(); render(); }); search.setAttribute("type", "search");
  search.dataset["ui"] = "search";
  const type = select("", ["armor", "weapon", "magic-item", "gear"].map(id => ({ id, label: t(label(id)) })), value => { category = value; folder = ""; render(); }, t); type.options[0]!.textContent = t("All equipment");
  const magicFilter = select("", [{id:"magic",label:t("Magic items")},{id:"ordinary",label:t("Other equipment")}], value => { magic = value; render(); }, t); magicFilter.options[0]!.textContent = t("All equipment");
  root.append(styled("div", "dsc-pack-toolbar", field(t("Item type"), type), field(t("Magic"), magicFilter)));
  root.append(field(t("Find catalog item"), search), path, styled("div", "dnd-picker-split", results, selected));
  const custom = el("details", el("summary", t("Add narrative item"))); let name = "", quantity = 1;
  custom.append(field(t("Name"), textInput("", value => { name = value; })), field(t("Quantity"), numberInput(1, value => { quantity = value ?? 1; }, 1)), button(t("Add narrative item"), () => {
    if (name.trim() && quantity > 0) addItems([{ id: newId(), name: name.trim(), quantity, location: "carried", attuned: false, acquisition: "", notes: "" }]);
  }));
  root.append(custom); render(); return root;
}
