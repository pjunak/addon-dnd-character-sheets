import type { Item } from "./character-model.js";
import type { CatalogRecord } from "./character-client.js";
import { newId } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, field, label, numberInput, rule, styled, textInput } from "./character-ui.js";

export function equipmentPicker(catalogs: Map<string, CatalogRecord[]>, locale: string, submit: (items: Item[]) => void): HTMLElement {
  const t = translator(locale), root = styled("div", "dnd-equipment-picker"), catalog = ["armor", "weapon", "magic-item", "gear"].flatMap(kind => catalogs.get(kind) ?? []);
  const tray = new Map<string, { record: CatalogRecord; quantity: number }>();
  let category = "", folder = "", query = "";
  const path = styled("nav", "dnd-equipment-path"); path.setAttribute("aria-label", t("Equipment folders"));
  const results = styled("div", "dnd-picker-results"), selected = styled("div", "dnd-picker-tray");
  const categoryOf = (record: CatalogRecord): string => String(record.value["category"] ?? record.value["type"] ?? t("Other"));
  const render = (): void => {
    path.replaceChildren(button(t("All equipment"), () => { category = ""; folder = ""; render(); }));
    if (category) path.append(el("span", "›"), button(t(label(category)), () => { folder = ""; render(); }));
    if (folder) path.append(el("span", "›"), el("span", t(label(folder))));
    results.replaceChildren(); selected.replaceChildren(el("h3", t("Selected items")));
    if (!query && (!category || !folder)) {
      const folders = !category ? ["armor", "weapon", "magic-item", "gear"] : [...new Set(catalog.filter(row => row.kind === category).map(categoryOf))].sort();
      for (const id of folders) { const next = button("▸ " + t(label(id)), () => { if (!category) category = id; else folder = id; render(); }); next.className = "dnd-equipment-folder"; results.append(next); }
    }
    const filtered = catalog.filter(row => (!category || row.kind === category) && (!folder || categoryOf(row) === folder) && String(row.value["name"] ?? row.id).toLocaleLowerCase().includes(query));
    const visible = query || folder ? filtered : [];
    for (const record of visible.slice(0, 200)) {
      const key = record.kind + ":" + record.id;
      const add = button(t("Add"), () => { const prior = tray.get(key); tray.set(key, { record, quantity: (prior?.quantity ?? 0) + 1 }); render(); });
      add.setAttribute("aria-label", t("Add {0}", [String(record.value["name"] ?? record.id)]));
      results.append(styled("div", "dnd-picker-row", rule(String(record.value["name"] ?? record.id), { kind: record.kind, id: record.id }), add));
    }
    if ((query || folder) && !visible.length) results.append(el("p", t("No matching items.")));
    if (visible.length > 200) results.append(el("p", t("Refine your search to see more items.")));
    for (const [key, entry] of tray) {
      const name = String(entry.record.value["name"] ?? entry.record.id), quantity = numberInput(entry.quantity, value => { entry.quantity = value ?? 1; }, 1);
      quantity.setAttribute("aria-label", t("{0} quantity", [name]));
      const remove = button("×", () => { tray.delete(key); render(); }); remove.setAttribute("aria-label", t("Remove {0}", [name]));
      selected.append(styled("div", "dnd-picker-row", el("span", name), quantity, remove));
    }
    if (!tray.size) selected.append(styled("p", "dse-empty", t("Choose items to add to your backpack.")));
    selected.append(button(t("Add selected items"), () => {
      if (![...root.querySelectorAll<HTMLInputElement>("input")].every(input => input.reportValidity())) return;
      submit([...tray.values()].map(({ record, quantity }) => ({ id: newId(), reference: { kind: record.kind, id: record.id }, name: String(record.value["name"] ?? record.id), quantity, location: "carried", attuned: false, acquisition: "", notes: "" })));
    }, !tray.size));
  };
  const search = textInput("", value => { query = value.toLocaleLowerCase().trim(); render(); }); search.setAttribute("type", "search");
  root.append(field(t("Find catalog item"), search), path, styled("div", "dnd-picker-split", results, selected));
  const custom = el("details", el("summary", t("Add narrative item"))); let name = "", quantity = 1;
  custom.append(field(t("Name"), textInput("", value => { name = value; })), field(t("Quantity"), numberInput(1, value => { quantity = value ?? 1; }, 1)), button(t("Add narrative item"), () => {
    if (name.trim() && quantity > 0) submit([{ id: newId(), name: name.trim(), quantity, location: "carried", attuned: false, acquisition: "", notes: "" }]);
  }));
  root.append(custom); render(); return root;
}
