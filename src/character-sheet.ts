import { itemBodyPlacement } from "./character-placement.js";
import { itemContainer, storage } from "./character-storage.js";
import {
  attuneControl,
  itemFields,
  itemReasons,
  locationSelect,
  quantityInput,
  quickUseButton,
  removeButton,
  stowButton,
} from "./character-item-editor.js";
import { spellSourceLabel } from "./character-spells.js";
import { proficiencyDetails } from "./character-proficiencies.js";
import type { Inputs, Item, Projection, Reference } from "./character-model.js";
import {
  attuneEquipment,
  equipmentSlot,
  moveEquipment,
  type EquipmentSlot,
} from "./character-inventory.js";
import type { CatalogRecord } from "./character-client.js";
import { abilities, object, rows, strings, text, catalogRecord } from "./character-client.js";
import { abilityNames, builderLabel, translator } from "./character-locale.js";
import {
  button,
  checkbox,
  el,
  field,
  human,
  label,
  numberInput,
  panel,
  plainDescription,
  rule,
  signed,
  styled,
} from "./character-ui.js";
import { rulesTarget } from "./character-rule-notes.js";

export type Layout = "compact" | "classic";
export interface SheetView {
  locale: string;
  layout: Layout;
  /** The host record's name, which the sheet shows instead of the host. */
  name: string;
  input: Inputs;
  projection: Projection | undefined;
  catalogs: Map<string, CatalogRecord[]>;
  editing: boolean;
  canPlay: boolean;
  canEditHP: boolean;
  canEditInspiration: boolean;
  canEditQuickUse: boolean;
  canEditStorage: boolean;
  canEditPlacement: boolean;
  canEditHands: boolean;
  hands: Record<string, unknown>;
  storage: Record<string, unknown>;
  quickUse: Record<string, unknown>;
  equipment: Record<string, unknown>;
  canEditConditions: boolean;
  conditions: Record<string, unknown>;
  change(): void;
  refresh(): void;
  addItem(): void;
  fillSlot(slot: EquipmentSlot): void;
  act(change: Record<string, unknown>): Promise<void>;
}
function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}
export function preferredLayout(storage: Storage | undefined, actor: string, key: string): Layout {
  try {
    const value = storage?.getItem("dnd-character-layout:" + actor + ":" + key);
    return value === "classic" ? "classic" : "compact";
  } catch {
    return "compact";
  }
}
// The host leaves the name to the sheet. It leads each tab's top row in at most
// two lines, sized by its longest line: its longest word or half the name.
export function characterName(view: Pick<SheetView, "name">): HTMLElement {
  const node = styled("div", "dnd-sheet-name", view.name),
    words = view.name.split(/\s+/).map((word) => word.length);
  node.style.setProperty(
    "--name-chars",
    String(Math.max(...words, Math.ceil(view.name.length / 2))),
  );
  node.title = view.name;
  return node;
}
export function savedRule(
  projection: Projection | undefined,
  name: string,
  path?: string,
  reference?: Reference,
): HTMLElement {
  const explanation = path ? projection?.explanations[path] : undefined;
  return rule(name, reference, explanation, undefined, projection);
}
export function sizeDetails(view: Pick<SheetView, "locale" | "projection">): HTMLElement {
  const t = translator(view.locale),
    size = object(view.projection?.sheet["derived"])["size"];
  return savedRule(
    view.projection,
    typeof size === "string" ? t(size) : t("Needs a choice"),
    "derived.size",
  );
}
export function featDetails(
  projection: Projection | undefined,
  locale: string,
): HTMLElement | undefined {
  const feats = rows(projection?.sheet["feats"]);
  if (!feats.length) return undefined;
  const t = translator(locale),
    root = panel(t("Feats"));
  root.className = "dse-section";
  for (const feat of feats) {
    const id = String(feat["id"]),
      reference = { kind: "feat", id };
    const evidence = projection?.evidence.find(
      (row) => row.reference.kind === reference.kind && row.reference.id === id,
    );
    const name = text(feat["name"], evidence?.name ?? id),
      count = Number(feat["count"] ?? 1);
    const heading = count > 1 ? name + " × " + count : name;
    root.append(
      el(
        "details",
        el("summary", savedRule(projection, heading, undefined, reference)),
        el("p", plainDescription(evidence?.summary)),
      ),
    );
  }
  return root;
}
export function recordName(
  view: Pick<SheetView, "catalogs" | "projection">,
  kind: string,
  id: string,
): string {
  return text(
    catalogRecord(view.catalogs.get(kind), id)?.value["name"],
    view.projection?.evidence.find(
      (source) => source.reference.kind === kind && source.reference.id === id,
    )?.name ?? id,
  );
}
export function abilityRail(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    rail = styled("div", "dse-cards");
  for (const ability of abilities) {
    const score = object(object(sheet["abilities"])[ability]),
      save = object(object(sheet["saves"])[ability]);
    const card = styled("section", "codex-surface dse-ability"),
      title = styled("div", "dse-ability-title");
    const dock = styled("span", "dse-dock-slot"),
      derived = object(sheet["derived"]);
    if (view.layout === "compact" && ability === "DEX")
      dock.append(
        styled(
          "span",
          "dse-dock",
          savedRule(
            view.projection,
            t("Init {0}", [signed(derived["initiative"])]),
            "derived.initiative",
          ),
          ...present(initiativeTag(view)),
        ),
      );
    if (view.layout === "compact" && ability === "WIS")
      dock.append(
        styled(
          "span",
          "dse-dock",
          savedRule(
            view.projection,
            t("Passive {0}", [human(derived["passivePerception"])]),
            "derived.passivePerception",
          ),
        ),
      );
    const proficiency = styled("span", "dse-dot dse-shield");
    proficiency.append(
      icon("M12 2.4 19.3 5.3V11c0 4.8-3.3 8.6-7.3 10.5C8 19.6 4.7 15.8 4.7 11V5.3Z"),
    );
    proficiency.dataset["proficient"] = String(save["proficient"] === true);
    proficiency.title = t("{0} — saving throw: {1}", [
      t(abilityNames[ability]!),
      t(save["proficient"] === true ? "Proficient" : "Untrained"),
    ]);
    proficiency.setAttribute("role", "img");
    proficiency.setAttribute("aria-label", proficiency.title);
    title.append(
      ...(view.layout === "compact"
        ? [
            styled("span", "dse-ability-key", ability),
            styled("span", "dse-ability-name", t(abilityNames[ability]!)),
          ]
        : [el("span", t(abilityNames[ability]!))]),
      dock,
      proficiency,
      savedRule(view.projection, signed(save["total"]), "saves." + ability + ".total"),
      ...present(rollTag(view.projection, view.locale, save, "save", { ability }, true)),
    );
    const tile = styled(
      "div",
      "dse-score",
      el(
        "strong",
        savedRule(view.projection, signed(score["mod"]), "abilities." + ability + ".mod"),
      ),
      styled(
        "span",
        "dse-number",
        savedRule(view.projection, human(score["score"]), "abilities." + ability + ".score"),
      ),
    );
    const details = styled("div", "dse-ability-details");
    if (view.layout === "classic") details.append(title);
    for (const [index, caster] of rows(object(sheet["spellcasting"])["perClass"]).entries())
      if (view.layout === "compact" && caster["ability"] === ability) {
        card.classList.add("dse-caster");
        // Beside Init and Passive the chip reads "DC 13 · +5" so both fit one
        // line; the tooltip names the class and spells the numbers out.
        const { source, numbers } = castingDetails(view, caster, index, true),
          chip = styled("span", "dse-dock", numbers);
        chip.title =
          source +
          ": " +
          t("DC {0} · Attack {1}", [human(caster["saveDC"]), signed(caster["spellAttack"])]);
        dock.append(chip);
      }
    const skills = Object.entries(object(sheet["skills"])).filter(
      ([, raw]) => object(raw)["ability"] === ability,
    );
    for (const [id, raw] of skills) {
      const skill = object(raw),
        dot = styled("span", "dse-dot", skill["expertise"] ? "◆" : skill["proficient"] ? "●" : "○");
      dot.title = t(
        skill["expertise"] ? "Expertise" : skill["proficient"] ? "Proficient" : "Untrained",
      );
      dot.dataset["training"] = skill["expertise"]
        ? "expertise"
        : skill["proficient"]
          ? "proficient"
          : "none";
      const line = styled(
        "div",
        "dse-skill",
        dot,
        el(
          "span",
          savedRule(view.projection, t(label(id)), "skills." + id + ".total", {
            kind: "skill",
            id,
          }),
        ),
        styled(
          "strong",
          "dse-total",
          savedRule(view.projection, signed(skill["total"]), "skills." + id + ".total"),
          ...present(
            rollTag(
              view.projection,
              view.locale,
              skill,
              "check",
              {
                skill: id,
                ability: text(skill["ability"]),
              },
              true,
            ),
          ),
        ),
      );
      line.dataset["trained"] = String(skill["proficient"] === true || skill["expertise"] === true);
      details.append(line);
    }
    if (!skills.length) details.append(styled("span", "dse-empty", "—"));
    if (view.layout === "compact") card.append(title);
    card.append(styled("div", "dse-ability-body", tile, details));
    rail.append(card);
  }
  return rail;
}
/** The class or grant that casts: "Paladin", "Magic Initiate · Sage · Level 1". */
export function casterSource(
  view: Pick<SheetView, "catalogs" | "locale" | "projection">,
  caster: Record<string, unknown>,
): string {
  return caster["source"]
    ? spellSourceLabel(caster["source"], view.locale, view.projection?.evidence)
    : recordName(view, "class", text(caster["classId"]));
}
// One caster's numbers as a single "DC 13 · Attack +5" line ("DC 13 · +5" when
// short), with the class or source that grants them for the caller to label it.
export function castingDetails(
  view: SheetView,
  caster: Record<string, unknown>,
  index: number,
  short = false,
): { source: string; numbers: HTMLElement } {
  const t = translator(view.locale),
    path = "spellcasting.perClass." + index;
  const source = casterSource(view, caster);
  const dot = el("span", "·");
  dot.setAttribute("aria-hidden", "true");
  const numbers = styled(
    "span",
    "dse-casting-numbers",
    savedRule(view.projection, t("DC {0}", [human(caster["saveDC"])]), path + ".saveDC"),
    dot,
    savedRule(
      view.projection,
      short ? signed(caster["spellAttack"]) : t("Attack {0}", [signed(caster["spellAttack"])]),
      path + ".spellAttack",
    ),
  );
  return { source, numbers };
}
export function vitals(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    derived = object(sheet["derived"]),
    band = styled("div", "dse-vitals");
  const hp = rulesTarget(
    styled("div", "codex-tile dse-hp", styled("span", "dse-stat-label", t("Hit points"))),
    "hp",
    "temporaryHp",
  );
  const adjust = (operation: string, title: string, initial: number): void => {
    const area = styled("div", "dse-hp-adjust"),
      input = numberInput(
        initial,
        () => {},
        0,
        operation === "set-hp" ? Number(derived["maxHp"]) : 1000000,
      );
    area.append(
      field(t("Amount"), input),
      button(title, async () => {
        if (input.reportValidity()) await view.act({ operation, amount: input.valueAsNumber });
      }),
    );
    hp.querySelector(".dse-hp-adjust")?.remove();
    hp.append(area);
    input.focus();
    input.select();
  };
  const current = numberInput(
    view.input.play.hp,
    (value) => {
      view.input.play.hp = value ?? 0;
      view.change();
    },
    0,
    Number(derived["maxHp"] ?? 0),
  );
  current.disabled = !view.canEditHP;
  current.dataset["focusKey"] = "vitals/current-hp";
  current.className = "dse-hp-current dse-number";
  current.setAttribute("aria-label", t("Current HP"));
  const counter = styled(
    "div",
    "dse-counter",
    current,
    el("span", "/"),
    savedRule(view.projection, human(derived["maxHp"]), "derived.maxHp"),
  );
  counter.dataset["uiKey"] = "vitals/current-hp";
  hp.append(counter);
  hp.append(styled("span", "dse-temp", t("Temporary HP {0}", [view.input.play.temporaryHp])));
  const actions = styled("div", "dnd-workflow-controls");
  actions.append(
    button(t("Damage"), () => adjust("damage", t("Damage"), 1), !view.canPlay),
    button(t("Heal"), () => adjust("heal", t("Heal"), 1), !view.canPlay),
    button(
      t("Temporary HP"),
      () => adjust("set-temporary-hp", t("Set temporary hp"), view.input.play.temporaryHp),
      !view.canPlay,
    ),
  );
  hp.append(actions);
  band.append(hp);
  const tile = (name: string, key: string, sign = false): HTMLElement =>
    styled(
      "div",
      "codex-tile",
      styled("span", "dse-stat-label", t(name)),
      el(
        "strong",
        savedRule(
          view.projection,
          sign ? signed(derived[key]) : human(derived[key]),
          "derived." + key,
        ),
      ),
    );
  const ac = tile("Armor class", "armorClass");
  ac.classList.add("dse-ac");
  band.append(ac);
  const speed = tile("Speed", "speed"),
    movement = movementDetails(view.projection, view.locale);
  if (movement) speed.append(movement);
  const stats = styled(
    "div",
    "dse-vitals-grid",
    speed,
    tile("Proficiency", "proficiencyBonus", true),
  );
  if (Object.hasOwn(derived, "size"))
    stats.append(
      styled(
        "div",
        "codex-tile",
        styled("span", "dse-stat-label", t("Size")),
        el("strong", sizeDetails(view)),
      ),
    );
  if (view.layout === "classic") {
    const initiative = tile("Initiative", "initiative", true);
    initiative.append(...present(initiativeTag(view)));
    stats.append(initiative, tile("Passive perception", "passivePerception"));
  }
  const inspiration = checkbox(t("Inspiration"), view.input.play.inspiration === true, (value) => {
    view.input.play.inspiration = value;
    view.change();
  });
  const inspirationInput = inspiration.querySelector("input")!;
  inspirationInput.disabled = !view.canEditInspiration;
  inspirationInput.dataset["focusKey"] = "vitals/inspiration";
  stats.append(styled("div", "codex-tile dse-inspiration", inspiration));
  band.append(stats);
  band.append(wornEquipment(view));
  return band;
}
export function wornEquipment(
  view: SheetView,
  slots: readonly EquipmentSlot[] = ["armor", "shield", "worn", "attuned"],
): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {};
  const worn = styled("div", "dse-worn", styled("span", "dse-stat-label", t("Worn equipment")));
  for (const slot of slots) {
    const group = styled("div", "dse-worn-group", styled("span", "dse-stat-label", t(label(slot))));
    group.dataset["equipmentSlot"] = slot;
    const attunement = object(sheet["attunement"]);
    if (slot === "attuned" && typeof attunement["limit"] === "number")
      group.append(
        styled(
          "span",
          "dse-attunement-capacity",
          t("{0} / {1} slots used", [Number(attunement["count"]), attunement["limit"]]),
        ),
      );
    const items = view.input.play.inventory.filter(
      (item) =>
        item.quantity > 0 &&
        (slot === "attuned"
          ? item.attuned
          : item.location === "equipped" &&
            equipmentSlot(item, view.equipment, view.projection) === slot),
    );
    for (const item of items) {
      const token = styled(
        "span",
        "dse-equipment-slot",
        savedRule(view.projection, item.name, undefined, item.reference),
      );
      if (slot === "attuned" && item.location !== "equipped")
        token.append(styled("span", "dse-equipment-location", t(label(item.location))));
      if (view.editing) {
        const remove = button("×", () => {
          if (slot === "attuned") attuneEquipment(item, false, view.equipment);
          else
            moveEquipment(
              view.input.play.inventory,
              item.id,
              "carried",
              view.equipment,
              view.projection,
            );
          view.change();
          view.refresh();
        });
        remove.setAttribute(
          "aria-label",
          slot === "attuned" ? t("Unattune {0}", [item.name]) : t("Remove {0}", [item.name]),
        );
        token.append(remove);
      }
      group.append(token);
    }
    if (view.editing) {
      const add = button("+ " + t(label(slot)), () => view.fillSlot(slot));
      add.dataset["focusKey"] = "equipment-slot/" + slot;
      group.append(add);
    } else if (!items.length) group.append(styled("span", "dse-empty", "—"));
    worn.append(group);
  }
  return worn;
}
export function backpack(
  view: SheetView,
  options: {
    items?: readonly Item[];
    heading?: boolean;
    storage?: boolean;
    coins?: boolean;
    flat?: boolean;
  } = {},
): HTMLElement {
  const t = translator(view.locale),
    pack = rulesTarget(styled("section", "dse-backpack"), "inventory", "hands"),
    head = styled("div", "dse-bp-head", styled("h3", "dse-bp-title", t("Backpack")));
  head
    .querySelector("h3")!
    .prepend(icon("M8 6V4a4 4 0 0 1 8 0v2M5 6h14v15H5ZM5 10h14M9 10v3h6v-3"));
  if (view.editing) head.append(button(t("Add item"), () => view.addItem()));
  if (options.heading !== false) pack.append(head);
  if (options.storage !== false) pack.append(storage(view));
  const split = styled("div", "dse-bp-split"),
    carried = styled("div", "dse-bp-col"),
    stored = styled("div", "dse-bp-col dse-bp-right");
  for (const location of options.flat ? ["all"] : ["equipped", "carried", "stored"]) {
    const items = (options.items ?? view.input.play.inventory).filter(
        (item) => location === "all" || item.location === location,
      ),
      group = styled("div", "dse-bp-group");
    if (!options.flat)
      group.append(styled("h4", "dse-bp-label", t(label(location)) + " · " + items.length));
    for (const item of items) {
      const row = styled("div", "dse-item");
      row.dataset["item"] = item.id;
      row.dataset["focusScope"] = "";
      row.append(
        styled(
          "span",
          "dse-item-name",
          savedRule(view.projection, item.name, undefined, item.reference),
        ),
      );
      if (view.editing) {
        const quantity = quantityInput(view, item),
          attune = attuneControl(view, item),
          move = locationSelect(view, item);
        row.append(quantity, attune.control, move, removeButton(view, item));
        row.append(styled("div", "dse-item-actions", quickUseButton(view, item)));
        const stow = stowButton(view, item, move);
        if (stow) row.append(styled("div", "dse-attunement-actions", stow));
        const details = styled("details", "dse-item-notes", el("summary", t("Details")));
        details.dataset["detailsKey"] = "inventory/" + item.id + "/notes";
        details.append(...itemFields(view, item), ...itemReasons(view, item, attune.reason));
        row.append(details);
      } else {
        row.append(el("span", "× " + item.quantity + (item.attuned ? " ★" : "")));
        if (item.notes)
          row.append(
            styled("details", "dse-item-notes", el("summary", t("Notes")), el("p", item.notes)),
          );
      }
      const placement = itemBodyPlacement(view, item);
      if (placement) row.append(placement);
      const destination = itemContainer(view, item);
      if (destination) row.append(destination);
      group.append(row);
    }
    if (!items.length) group.append(styled("p", "dse-empty", t("Empty")));
    (location === "stored" ? stored : carried).append(group);
  }
  split.append(carried, stored);
  pack.append(split);
  if (options.coins !== false) pack.append(currency(view));
  return pack;
}
export function currency(view: SheetView): HTMLElement {
  const coins = rulesTarget(styled("div", "dse-coins"), "currency");
  for (const coin of ["cp", "sp", "ep", "gp", "pp"]) {
    const value = view.input.play.currency[coin] ?? 0;
    const control = view.editing
      ? numberInput(
          value,
          (value) => {
            view.input.play.currency[coin] = value ?? 0;
            view.change();
          },
          0,
        )
      : el("span", value);
    control.className = "dse-number";
    control.setAttribute("aria-label", coin.toUpperCase());
    const entry = el("label", el("span", coin.toUpperCase()), control);
    entry.dataset["coin"] = coin;
    coins.append(entry);
  }
  return coins;
}
export function combatDetails(view: SheetView): HTMLElement {
  return styled(
    "div",
    "dse-combat",
    attackDetails(view),
    resourceDetails(view),
    explorationDetails(view),
  );
}
export function attackDetails(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {};
  const attacks = panel(t("Attacks"));
  attacks.className = "dse-section";
  rows(sheet["weapons"]).forEach((weapon, index) => {
    // An unarmed strike comes from the ruleset and has no weapon record.
    const path = "weapons." + index,
      ref = text(weapon["ref"]),
      reference = ref ? { kind: "weapon", id: ref } : undefined;
    const row = styled(
      "div",
      "dse-attack",
      savedRule(view.projection, String(weapon["name"] ?? weapon["ref"]), undefined, reference),
      el(
        "strong",
        savedRule(view.projection, signed(weapon["attackBonus"]), path + ".attackBonus"),
      ),
      el(
        "span",
        savedRule(
          view.projection,
          human(weapon["damage"]) + " " + t(label(text(weapon["damageType"]))),
          path + ".damage",
        ),
      ),
    );
    if (weapon["versatileDamage"])
      row.append(
        el(
          "span",
          t("Versatile damage") + ": ",
          savedRule(view.projection, human(weapon["versatileDamage"]), path + ".versatileDamage"),
        ),
      );
    if (typeof weapon["criticalRange"] === "number")
      row.append(el("span", t("Critical hit {0}–20", [weapon["criticalRange"]])));
    if (weapon["mastery"])
      row.append(
        el(
          "span",
          t("Mastery") + ": ",
          savedRule(view.projection, t(label(text(weapon["mastery"]))), undefined, reference),
          " · ",
          t(weapon["masteryActive"] ? "Active" : "Inactive"),
        ),
      );
    attacks.append(row);
  });
  if (attacks.children.length === 1) attacks.append(styled("p", "dse-empty", t("No attacks yet.")));
  return attacks;
}
/** Reached class table values (Rage Damage, Martial Arts, …) as label/value pairs. */
export function classValueRows(projection: Projection | undefined): [string, string][] {
  return rows(projection?.sheet["classValues"]).map((row) => [
    text(row["name"], String(row["key"])),
    typeof row["value"] === "number" ? signed(row["value"]) : human(row["value"]),
  ]);
}
/** Save DCs features set for their own effects (a Monk's Focus) as label/value pairs. */
export function featureDCRows(
  projection: Projection | undefined,
  locale: string,
): [string, string][] {
  const t = translator(locale);
  return rows(projection?.sheet["saveDCs"]).map((row) => [
    text(row["name"]),
    t("DC {0}", [human(row["value"])]),
  ]);
}
const movementModes = [
  ["flySpeed", "Fly {0}"],
  ["swimSpeed", "Swim {0}"],
  ["climbSpeed", "Climb {0}"],
  ["burrowSpeed", "Burrow {0}"],
] as const;
/** Special movement beside Speed ("Fly 60 · Swim 30"), when the Engine reports any. */
export function movementDetails(
  projection: Projection | undefined,
  locale: string,
): HTMLElement | undefined {
  const t = translator(locale),
    sheet = projection?.sheet ?? {},
    root = styled("small", "dnd-movement");
  for (const [key, template] of movementModes)
    if (Number(sheet[key] ?? 0) > 0) {
      if (root.childElementCount) root.append(" · ");
      root.append(savedRule(projection, t(template, [human(sheet[key])]), key));
    }
  return root.childElementCount ? root : undefined;
}
/** A small mark on a roll the character has Advantage on. */
/** An optional node as a list, for spreading into element children. */
export const present = (node: HTMLElement | undefined): HTMLElement[] => (node ? [node] : []);
export function initiativeTag(
  view: Pick<SheetView, "locale" | "projection">,
): HTMLElement | undefined {
  const sheet = view.projection?.sheet ?? {};
  return rollTag(
    view.projection,
    view.locale,
    { advantage: sheet["initiativeAdvantage"], disadvantage: sheet["initiativeDisadvantage"] },
    "initiative",
  );
}
/** Damage types or conditions in the UI language: "Ohnivé, Jedové". */
export function defenseNames(value: unknown, locale: string): string {
  const t = translator(locale);
  return strings(value)
    .map((id) => t(label(id)))
    .join(", ");
}
/** The rolls features give Advantage on, situational ones with their condition. */
// Lasting roll effects from features and gear, by mode; conditions show their
// own effects in the status row, so they are left out here.
export function advantageNames(
  projection: Projection | undefined,
  locale: string,
  mode: "advantage" | "disadvantage" = "advantage",
): string[] {
  const t = translator(locale),
    names: string[] = [];
  for (const entry of rows(projection?.sheet["advantages"])) {
    if (
      text(entry["mode"], "advantage") !== mode ||
      object(entry["source"])["type"] === "condition"
    )
      continue;
    const scope = [
      ...strings(entry["abilities"]),
      ...strings(entry["skills"]).map((skill) => t(label(skill))),
    ].join(", ");
    const roll =
      entry["on"] === "save"
        ? scope
          ? t("{0} saves", [scope])
          : t("All saves")
        : entry["on"] === "check"
          ? scope
            ? t("{0} checks", [scope])
            : t("All checks")
          : entry["on"] === "attack"
            ? t("Attack rolls")
            : entry["on"] === "initiative"
              ? t("Initiative")
              : entry["on"] === "concentration"
                ? t("Concentration")
                : t("Death saves");
    const name = entry["when"] ? t("{0} ({1})", [roll, text(entry["when"])]) : roll;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
/**
 * The ADV or DIS tag for a roll the Engine marked, titled with the sources
 * behind it. The Engine already cancelled opposite marks; this only names them.
 */
export function rollTag(
  projection: Projection | undefined,
  locale: string,
  marks: Record<string, unknown>,
  on: string,
  target: { ability?: string; skill?: string } = {},
  quietConditions = false,
): HTMLElement | undefined {
  const mode =
    marks["advantage"] === true
      ? "advantage"
      : marks["disadvantage"] === true
        ? "disadvantage"
        : "";
  if (!mode) return undefined;
  const t = translator(locale),
    sources = rows(projection?.sheet["advantages"]).filter((entry) => {
      if (entry["when"] || text(entry["mode"], "advantage") !== mode || entry["on"] !== on)
        return false;
      const abilities = strings(entry["abilities"]),
        skills = strings(entry["skills"]);
      if (!target.ability && !target.skill) return true;
      if (target.skill)
        return (
          skills.includes(target.skill) ||
          abilities.includes(target.ability ?? "") ||
          skills.length + abilities.length === 0
        );
      return abilities.length === 0 || abilities.includes(target.ability!);
    });
  const tag = styled("span", "dse-roll-tag", t(mode === "advantage" ? "ADV" : "DIS"));
  tag.dataset["mode"] = mode;
  // A mark only conditions cause can wait until its condition is hovered.
  if (
    quietConditions &&
    sources.length &&
    sources.every((entry) => object(entry["source"])["type"] === "condition")
  )
    tag.classList.add("is-quiet");
  tag.dataset["rollSources"] = sources
    .map(
      (entry) => text(object(entry["source"])["type"]) + ":" + text(object(entry["source"])["id"]),
    )
    .join(" ");
  tag.title = t(mode === "advantage" ? "Advantage: {0}" : "Disadvantage: {0}", [
    [...new Set(sources.map((entry) => text(entry["name"])))].join(", "),
  ]);
  tag.setAttribute("aria-label", tag.title);
  return tag;
}
/** Class choices whose picks have no feature of their own (Divine Order, Wild Shape forms). */
export function selectionEntries(
  projection: Projection | undefined,
  locale: string,
): { name: string; values: { name: string; reference?: Reference }[] }[] {
  return rows(projection?.sheet["selections"]).map((row) => ({
    name: builderLabel(row, locale, text(row["id"])),
    values: rows(row["values"]).map((value) => ({
      name: text(value["label"], text(value["id"])),
      ...(value["kind"] ? { reference: { kind: text(value["kind"]), id: text(value["id"]) } } : {}),
    })),
  }));
}
export function resourceDetails(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {};
  const resources = rulesTarget(panel(t("Resources")), "resources");
  resources.className = "dse-section dse-resources";
  for (const [name, value] of [
    ...classValueRows(view.projection),
    ...featureDCRows(view.projection, view.locale),
  ])
    resources.append(styled("div", "dse-resource", el("span", name), el("strong", value)));
  for (const resource of rows(sheet["resources"])) {
    const key = String(resource["key"]),
      name = text(resource["name"], key);
    const row = styled(
      "div",
      "dse-resource",
      el("span", savedRule(view.projection, name, "resources." + key + ".remaining")),
      el("strong", human(resource["remaining"]) + " / " + human(resource["max"])),
    );
    if (object(resource["source"])["acquisition"])
      row.append(
        el("small", spellSourceLabel(resource["source"], view.locale, view.projection?.evidence)),
      );
    if (view.editing) {
      const spent = numberInput(
        view.input.play.resourceUses[key] ?? 0,
        (value) => {
          view.input.play.resourceUses[key] = value ?? 0;
          view.change();
        },
        0,
        Number(resource["max"]),
      );
      spent.setAttribute("aria-label", t("{0} — spent / {1}", [name, resource["max"]]));
      row.append(spent);
    }
    resources.append(row);
  }
  for (const activation of rows(sheet["activations"])) {
    const key = String(activation["key"]),
      name = String(activation["name"]);
    resources.append(
      button(
        t("{0} {1}", [t(view.input.play.activeFeatures[key] ? "End" : "Activate"), name]),
        () =>
          view.act({
            operation: "toggle-feature",
            key,
            enabled: !view.input.play.activeFeatures[key],
          }),
        !view.canPlay,
      ),
    );
  }
  if (resources.children.length === 1) resources.append(el("p", t("No resources yet.")));
  return resources;
}
export function explorationDetails(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = styled("div", "dse-exploration");
  const traits = panel(t("Features and traits"));
  traits.className = "dse-section";
  for (const feature of rows(sheet["features"])) {
    const id = String(feature["id"]),
      count = Number(feature["count"] ?? 1);
    traits.append(
      el(
        "details",
        el(
          "summary",
          savedRule(view.projection, text(feature["name"], id), undefined, {
            kind: "feature",
            id,
          }),
          ...(count > 1 ? [" × " + count] : []),
        ),
        el(
          "p",
          plainDescription(
            view.projection?.evidence.find((row) => row.reference.id === id)?.summary,
          ),
        ),
      ),
    );
  }
  for (const selection of selectionEntries(view.projection, view.locale))
    traits.append(
      el(
        "p",
        el("strong", selection.name + ": "),
        ...selection.values.flatMap((value, index) => [
          ...(index ? [", "] : []),
          value.reference
            ? savedRule(view.projection, value.name, undefined, value.reference)
            : value.name,
        ]),
      ),
    );
  for (const key of ["resistances", "damageImmunities", "conditionImmunities"]) {
    const value = defenseNames(sheet[key], view.locale);
    if (value) traits.append(el("p", el("strong", t(label(key)) + ": "), value));
  }
  for (const mode of ["advantage", "disadvantage"] as const) {
    const names = advantageNames(view.projection, view.locale, mode);
    if (names.length)
      traits.append(
        el(
          "p",
          el("strong", t(mode === "advantage" ? "Advantage" : "Disadvantage") + ": "),
          names.join("; "),
        ),
      );
  }
  root.append(
    proficiencyDetails(view.projection, view.locale),
    senseDetails(view.projection, view.locale),
    traits,
  );
  const feats = featDetails(view.projection, view.locale);
  if (feats) root.append(feats);
  return root;
}

export function senseDetails(projection: Projection | undefined, locale: string): HTMLElement {
  const t = translator(locale),
    senses = rulesTarget(panel(t("Senses")), "senses");
  for (const [key, value] of Object.entries(object(projection?.sheet["senses"]))) {
    const path = "senses." + key,
      explanation = projection?.explanations[path];
    senses.append(
      el(
        "p",
        savedRule(projection, t(label(key)), path),
        ": ",
        human(value),
        " ",
        explanation?.unit ?? "",
      ),
    );
    for (const term of explanation?.terms ?? [])
      if (term.status)
        senses.append(
          el("p", term.label, " · ", t(term.status === "applied" ? "Active" : "Inactive")),
        );
  }
  if (senses.children.length === 1) senses.append(el("p", t("No additional senses.")));
  return senses;
}
