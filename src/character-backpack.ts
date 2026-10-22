// The Backpack window: a searchable list of every inventory entry beside an
// editor for the selected one. Container chips filter the list; a selected
// container can be renamed, linked to its item or removed.
import type { SheetView } from "./character-sheet.js";
import type { Item } from "./character-model.js";
import { newId, object, strings } from "./character-client.js";
import { containerOptions, removeContainer, weightText } from "./character-inventory.js";
import {
  attuneControl,
  itemFields,
  itemReasons,
  locationSelect,
  pinStar,
  quantityInput,
  quantityStepper,
  quickUseButton,
  removeButton,
  stowButton,
} from "./character-item-editor.js";
import { itemBodyPlacement } from "./character-placement.js";
import { containerItem, itemContainer } from "./character-storage.js";
import { translator } from "./character-locale.js";
import { gearNote } from "./character-magic-gear.js";
import { button, el, field, label, select, styled, textInput } from "./character-ui.js";

export interface BackpackState {
  query: string;
  /** "" for everything, "equipped", "loose" or a container ID. */
  container: string;
  /** "container", "name", "quantity" or "weight". */
  sort: string;
  /** The item the editor shows. */
  selected: string;
}

export function newBackpackState(): BackpackState {
  return { query: "", container: "", sort: "container", selected: "" };
}

// A backpack group's weight: a container's load against its capacity, or what
// its contents weigh when they are stored or inside a weightless container.
export function packWeight(
  view: SheetView,
  members: Item[],
  container?: string,
): HTMLElement | undefined {
  const t = translator(view.locale),
    carrying = object(view.projection?.sheet["carrying"]);
  if (!Object.keys(carrying).length) return undefined;
  const weights = object(carrying["items"]),
    load = container
      ? object(object(carrying["containers"])[container])
      : {
          loadLb: members.reduce(
            (total, item) => total + Number(object(weights[item.id])["totalLb"] ?? 0),
            0,
          ),
        },
    pounds = Number(load["loadLb"] ?? 0),
    capacity = Number(load["capacityLb"] ?? 0),
    node = styled("span", "dsc-pack-weight");
  if (load["stored"] === true)
    node.textContent = t("{0} · not carried", [weightText(pounds, view.locale)]);
  else if (load["weightless"] === true) {
    node.dataset["state"] = "weightless";
    node.textContent = t("{0} inside · counts as 0", [weightText(pounds, view.locale)]);
  } else if (capacity > 0) {
    const meter = styled("span", "dsc-meter", el("span"));
    meter.style.setProperty("--fill", Math.min(100, (pounds / capacity) * 100) + "%");
    const amount = t("{0} / {1}", [
      new Intl.NumberFormat(view.locale, { maximumFractionDigits: 2 }).format(pounds),
      weightText(capacity, view.locale),
    ]);
    if (pounds > capacity) node.dataset["state"] = "over";
    node.append(
      meter,
      pounds > capacity
        ? t("{0} · over by {1}", [amount, weightText(pounds - capacity, view.locale)])
        : pounds === capacity
          ? t("{0} · full", [amount])
          : amount,
    );
  } else node.textContent = weightText(pounds, view.locale);
  return node;
}

export function backpackDialog(
  view: SheetView,
  state: BackpackState,
  add: () => void,
): HTMLElement {
  const t = translator(view.locale),
    root = styled("div", "dsc-backpack-dialog"),
    containers = view.input.play.containers ?? [],
    names = new Map(containerOptions(containers).map((option) => [option.id, option.label])),
    carrying = object(view.projection?.sheet["carrying"]),
    weights = object(carrying["items"]),
    unknown = new Set(strings(carrying["unknown"])),
    holders = new Map(
      containers.flatMap((container) =>
        container.itemId ? [[container.itemId, container] as const] : [],
      ),
    );
  if (!["", "equipped", "loose"].includes(state.container) && !names.has(state.container))
    state.container = "";
  const tools = styled("div", "dsc-bp-tools"),
    settings = styled("div", "dsc-bp-container"),
    list = styled("div", "dsc-bp-list"),
    side = styled("div", "dsc-bp-side"),
    count = styled("p", "dsc-bp-count");
  count.setAttribute("role", "status");
  list.setAttribute("aria-label", t("Inventory"));
  side.setAttribute("aria-label", t("Item details"));

  // Equipped, loose carried, each container, then loose stored: the order of the summary.
  const group = (item: Item): string =>
    item.location === "equipped"
      ? "equipped"
      : item.containerId
        ? item.containerId
        : item.location === "stored"
          ? "stored"
          : "carried";
  const groups = ["equipped", "carried", ...containers.map((container) => container.id), "stored"],
    fixedTitles: Record<string, string> = {
      equipped: t("Equipped"),
      carried: t("Carried, loose"),
      stored: t("Stored, loose"),
    },
    groupTitle = (id: string): string => names.get(id) ?? fixedTitles[id] ?? id,
    totalOf = (item: Item): number => Number(object(weights[item.id])["totalLb"] ?? -1);

  const row = (item: Item): HTMLElement => {
    const line = styled("div", "dsc-bp-row");
    line.dataset["item"] = item.id;
    const selected = state.selected === item.id;
    if (selected) line.classList.add("is-selected");
    const name = button(item.name, () => {
      state.selected = item.id;
      render();
      side.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    });
    name.className = "dsc-bp-name";
    name.dataset["focusKey"] = "pack/" + item.id + "/select";
    name.setAttribute("aria-pressed", String(selected));
    const tags = styled("span", "dsc-bp-tags", ...gearNote(view, item));
    if (item.attuned) tags.append(styled("span", "dsc-tag dsc-tag-magic", t("Attuned")));
    const holds = holders.get(item.id);
    if (holds)
      tags.append(styled("span", "dsc-tag", t("Holds {0}", [names.get(holds.id) ?? holds.name])));
    if (item.notes) {
      const note = styled("span", "dsc-bp-note", "✎");
      note.title = t("Has notes");
      tags.append(note);
    }
    const weight = styled(
      "span",
      "dsc-bp-weight",
      !Object.keys(carrying).length
        ? ""
        : unknown.has(item.id)
          ? "—"
          : weightText(object(weights[item.id])["totalLb"], view.locale),
    );
    if (unknown.has(item.id)) weight.title = t("Unknown weight");
    line.append(
      pinStar(view, item),
      styled("span", "dsc-bp-title", name, tags),
      quantityStepper(view, item),
      weight,
      styled("span", "dsc-bp-place", item.containerId ? (names.get(item.containerId) ?? "—") : "—"),
      styled("span", "dsc-tag", t(label(item.location))),
    );
    return line;
  };

  const editor = (): void => {
    const item = view.input.play.inventory.find((entry) => entry.id === state.selected);
    if (!item) {
      side.replaceChildren(
        el("p", t("Select an item to edit its name, quantity, container and notes, or add one.")),
      );
      return;
    }
    const kind = item.reference ? t(label(item.reference.kind)) : t("Custom");
    side.replaceChildren(
      styled(
        "h4",
        "dsc-bp-side-title",
        item.name,
        styled("span", "dsc-tag", kind),
        ...gearNote(view, item),
      ),
    );
    if (!view.editing) {
      side.append(
        el("p", "× " + item.quantity + " · " + t(label(item.location))),
        ...(item.notes ? [el("p", item.notes)] : []),
      );
      return;
    }
    // Attunement shows only for items that use it.
    const attune = attuneControl(view, item),
      attunable =
        item.attuned || object(view.equipment[item.id])["attuneReason"] !== "not-required",
      move = locationSelect(view, item);
    side.append(
      field("inventory/" + item.id + "/quantity", t("Quantity"), quantityInput(view, item)),
      ...itemFields(view, item),
      field("inventory/" + item.id + "/move", t("Location"), move),
      ...(attunable
        ? [field("inventory/" + item.id + "/attune", t("Attunement"), attune.control)]
        : []),
    );
    const placement = itemBodyPlacement(view, item),
      destination = itemContainer(view, item);
    if (placement) side.append(placement);
    if (destination) side.append(destination);
    const holds = holders.get(item.id);
    if (holds) {
      const load = packWeight(view, [], holds.id);
      side.append(
        styled(
          "p",
          "dsc-bp-holds",
          t("This item is the {0} container.", [names.get(holds.id) ?? holds.name]),
          ...(load ? [" ", load] : []),
        ),
      );
    }
    const actions = styled("div", "dsc-actions", quickUseButton(view, item));
    const stow = stowButton(view, item, move);
    if (stow) actions.append(stow);
    // Deleting keeps keyboard focus in the list, on the neighbouring entry.
    const remove = removeButton(view, item, t("Delete"));
    remove.addEventListener(
      "click",
      () => {
        const rows = [...list.querySelectorAll<HTMLElement>(".dsc-bp-row")],
          index = rows.findIndex((line) => line.dataset["item"] === item.id),
          next = rows[index + 1] ?? rows[index - 1];
        (next?.querySelector<HTMLElement>(".dsc-bp-name") ?? search).focus();
      },
      { capture: true },
    );
    actions.append(remove);
    side.append(actions, ...itemReasons(view, item, attunable ? attune.reason : ""));
  };

  // A selected container's own settings: its name, its item and removal.
  const containerSettings = (): void => {
    const container = containers.find((entry) => entry.id === state.container);
    settings.hidden = !container;
    if (!container) return settings.replaceChildren();
    const rename = textInput(container.name, (value) => {
      container.name = value;
      view.change();
    });
    rename.required = true;
    rename.disabled = !view.canEditStorage;
    const maximum = Number(view.storage["maximumNameLength"]);
    if (Number.isFinite(maximum)) rename.maxLength = maximum;
    rename.dataset["focusKey"] = "storage/" + container.id + "/name";
    const members = view.input.play.inventory.filter((item) => item.containerId === container.id),
      load = packWeight(view, members, container.id),
      link = view.canEditStorage ? containerItem(view, container) : undefined,
      remove = button(
        t("Remove container"),
        () => {
          if (removeContainer(view.input, container.id)) {
            state.container = "";
            view.change();
            view.refresh();
          }
        },
        !view.canEditStorage,
        "storage/" + container.id + "/remove",
      );
    remove.setAttribute("aria-label", t("Remove container: {0}", [container.name]));
    settings.replaceChildren(
      field("storage/" + container.id + "/name", t("Container name"), rename),
      ...(link ? [link] : []),
      ...(load ? [load] : []),
      remove,
    );
  };

  const render = (): void => {
    const query = state.query.trim().toLocaleLowerCase(view.locale);
    const items = view.input.play.inventory.filter(
      (item) =>
        (state.container === "" ||
          (state.container === "equipped"
            ? item.location === "equipped"
            : state.container === "loose"
              ? !item.containerId && item.location !== "equipped"
              : item.containerId === state.container)) &&
        [item.name, item.notes].join(" ").toLocaleLowerCase(view.locale).includes(query),
    );
    if (state.sort !== "container")
      items.sort(
        (a, b) =>
          (state.sort === "quantity"
            ? b.quantity - a.quantity
            : state.sort === "weight"
              ? totalOf(b) - totalOf(a)
              : 0) ||
          a.name.localeCompare(b.name, view.locale) ||
          a.id.localeCompare(b.id),
      );
    count.textContent = t("Inventory entries: {0}", [items.length]);
    list.replaceChildren();
    if (state.sort === "container")
      for (const id of groups) {
        const members = items.filter((item) => group(item) === id);
        if (!members.length) continue;
        const head = styled(
          "h4",
          "dsc-pack-group",
          groupTitle(id),
          el("small", String(members.length)),
        );
        const weight = packWeight(view, members, names.has(id) ? id : undefined);
        if (weight) head.append(weight);
        list.append(head, ...members.map(row));
      }
    else list.append(...items.map(row));
    if (!items.length) list.append(styled("p", "dse-empty", t("Nothing matches.")));
    for (const chip of tools.querySelectorAll<HTMLElement>("[data-filter]"))
      chip.setAttribute("aria-pressed", String(chip.dataset["filter"] === state.container));
    containerSettings();
    editor();
  };

  const search = textInput(state.query, (value) => {
    state.query = value;
    render();
  });
  search.setAttribute("type", "search");
  search.placeholder = t("Search name or notes");
  search.setAttribute("aria-label", t("Search inventory"));
  search.dataset["ui"] = "search";
  search.dataset["focusKey"] = "pack/query";
  const chips = styled("div", "dnd-filter-chips");
  chips.setAttribute("aria-label", t("Compartment"));
  const filters: [string, string][] = [
    ["", t("All")],
    ["equipped", t("Equipped")],
    ["loose", t("Loose")],
    ...names,
  ];
  for (const [id, title] of filters) {
    const chip = button(
      title,
      () => {
        state.container = id;
        render();
      },
      false,
      "pack/filter/" + (id || "all"),
    );
    chip.dataset["filter"] = id;
    chips.append(chip);
  }
  const maximum = Number(view.storage["maximumContainers"]);
  if (view.canEditStorage && Number.isFinite(maximum) && containers.length < maximum)
    chips.append(
      button(
        t("+ Container"),
        () => {
          const container = { id: newId(), name: t("New container") };
          view.input.play.containers = [...containers, container];
          state.container = container.id;
          view.change();
          view.refresh();
          const name = root.ownerDocument.querySelector<HTMLInputElement>(
            '[data-focus-key="storage/' + container.id + '/name"]',
          );
          name?.focus();
          name?.select();
        },
        false,
        "storage/add",
      ),
    );
  const sort = select(
    state.sort,
    [
      { id: "container", label: t("Container") },
      { id: "name", label: t("Name") },
      { id: "quantity", label: t("Quantity") },
      ...(Object.keys(carrying).length ? [{ id: "weight", label: t("Weight") }] : []),
    ],
    (value) => {
      if (value) {
        state.sort = value;
        render();
      }
    },
    t,
  );
  sort.options[0]!.remove();
  sort.dataset["focusKey"] = "pack/sort";
  sort.setAttribute("aria-label", t("Sort by"));
  tools.append(
    search,
    chips,
    styled("span", "dsc-spacer"),
    styled("label", "dsc-bp-sort", t("Sort by"), sort),
    button(t("Add item"), add, !view.editing, "pack/add"),
  );
  root.append(
    tools,
    settings,
    count,
    styled("div", "dsc-bp-main", styled("div", "dsc-bp-scroll", list), side),
  );
  render();
  return root;
}
