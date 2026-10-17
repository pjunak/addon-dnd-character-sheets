import type { SheetView } from "./character-sheet.js";
import {
  abilityRail,
  advantageMark,
  advantageNames,
  casterSource,
  castingDetails,
  characterName,
  classValueRows,
  currency,
  featureDCRows,
  movementDetails,
  recordName,
  savedRule,
  selectionEntries,
  sizeDetails,
  wornEquipment,
} from "./character-sheet.js";
import { abilities, object, rows, strings, text } from "./character-client.js";
import type { Item } from "./character-model.js";
import {
  assignBodyPlacement,
  moveEquipment,
  pinQuickUse,
  stowAndUnattune,
} from "./character-inventory.js";
import { bodyPlacementLabel } from "./character-placement.js";
import { handControls } from "./character-hands.js";
import { quickUse } from "./character-quick-use.js";
import { conditionName } from "./character-conditions.js";
import { parseHpEntry } from "./character-hp.js";
import { abilityNames, translator } from "./character-locale.js";
import type { Reference } from "./character-model.js";
import { proficiencyGroups } from "./character-proficiencies.js";
import { rulesTarget } from "./character-rule-notes.js";
import { slotLabel, spellSourceLabel } from "./character-spells.js";
import {
  button,
  el,
  human,
  label,
  numberInput,
  panel,
  plainDescription,
  rule,
  select,
  signed,
  styled,
} from "./character-ui.js";

// Editors that open as floating windows from the Compact tabs.
export interface CompactActions {
  backpack: (container?: string) => void;
  figure: (place?: string) => void;
  rest: (kind: "short" | "long") => void;
  prepare: () => void;
}

export function compactNavigation(nav: HTMLElement): void {
  const paths: Record<string, string> = {
    sheet: "M4 3h16v18H4ZM9 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM7 18v-2a5 5 0 0 1 10 0v2",
    combat: "m4 3 7 7-2 2-7-7V3ZM20 3v2L5 20l-2-2L18 3ZM3 14l7 7M14 3l7 7M15 14l5 6-2 2-5-6",
    equipment: "M8 6V4a4 4 0 0 1 8 0v2M5 6h14v15H5ZM5 11h14M9 11v4h6v-4",
    spells: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
    builder: "m3 19 9-9 3 3-9 9ZM9 5l4-3 8 8-3 4Z",
    tools: "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6",
  };
  for (const control of nav.querySelectorAll("button")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", paths[control.id.replace("dnd-tab-", "")] ?? "");
    svg.append(path);
    control.prepend(svg);
  }
}

// Buttons that open a floating window carry the window mark.
function opens(control: HTMLButtonElement): HTMLButtonElement {
  const mark = styled("span", "dsc-opens", "⤢");
  mark.setAttribute("aria-hidden", "true");
  control.append(mark);
  return control;
}

function cell(label: string, value: Node, stat: string, unit?: string): HTMLElement {
  const node = styled(
    "div",
    "dsc-cell",
    styled("span", "dsc-stat-label", label),
    styled("strong", "dsc-cell-value", value, ...(unit ? [el("small", unit)] : [])),
  );
  node.dataset["stat"] = stat;
  return node;
}

function derivedCell(view: SheetView, name: string, key: string, sign = false): HTMLElement {
  const derived = object(view.projection?.sheet["derived"]);
  return cell(
    translator(view.locale)(name),
    savedRule(view.projection, sign ? signed(derived[key]) : human(derived[key]), "derived." + key),
    key,
    view.projection?.explanations["derived." + key]?.unit,
  );
}

function hitPoints(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    derived = object(view.projection?.sheet["derived"]),
    maximum = Number(derived["maxHp"] ?? 0);
  const hp = styled("div", "dsc-health");
  const current = el("input");
  current.type = "text";
  current.autocomplete = "off";
  current.enterKeyHint = "done";
  current.className = "dsc-hp-input";
  current.value = String(view.input.play.hp);
  current.disabled = !view.canEditHP;
  current.setAttribute("aria-label", t("Current HP"));
  current.dataset["focusKey"] = "vitals/current-hp";
  const hint = styled(
    "span",
    "dsc-hp-hint",
    t("Type −7 for damage, +5 to heal or a number to set hit points, then press Enter."),
  );
  hint.id = "dsc-hp-hint-" + crypto.randomUUID();
  current.setAttribute("aria-describedby", hint.id);
  const bar = styled("div", "dsc-health-track", el("span"));
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", t("Current health"));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(maximum));
  const paint = (): void => {
    const value = view.input.play.hp,
      ratio = maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;
    bar.style.setProperty("--health", ratio * 100 + "%");
    bar.dataset["health"] = ratio > 0.5 ? "high" : ratio > 0.25 ? "medium" : "low";
    bar.setAttribute("aria-valuenow", String(value));
  };
  paint();
  const setHp = (amount: number): boolean => {
    if (maximum > 0 && amount > maximum) {
      current.setCustomValidity(t("Hit points cannot exceed {0}.", [maximum]));
      current.reportValidity();
      return false;
    }
    current.setCustomValidity("");
    if (amount !== view.input.play.hp) {
      view.input.play.hp = amount;
      view.change();
      paint();
    }
    return true;
  };
  // A plain number edits HP directly as before; damage and healing go through
  // the rules so temporary HP and bounds are applied there.
  let committed = false;
  current.addEventListener("input", () => {
    committed = false;
    current.setCustomValidity("");
    const entry = parseHpEntry(current.value);
    if (entry && !entry.instruction) setHp(entry.amount);
  });
  const commit = (): void => {
    if (committed) return;
    committed = true;
    const entry = parseHpEntry(current.value);
    if (entry?.kind === "set") {
      if (!setHp(entry.amount)) return;
    } else if (entry && entry.amount > 0 && view.canPlay)
      void view.act({ operation: entry.kind, amount: entry.amount });
    current.setCustomValidity("");
    current.value = String(view.input.play.hp);
  };
  current.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    committed = false;
    commit();
  });
  current.addEventListener("change", commit);
  const temporary = numberInput(
    view.input.play.temporaryHp,
    (value) => {
      view.input.play.temporaryHp = value ?? 0;
      view.change();
    },
    0,
  );
  temporary.disabled = !view.canPlay;
  temporary.setAttribute("aria-label", t("Temporary HP"));
  temporary.dataset["focusKey"] = "vitals/temporary-hp";
  hp.append(
    styled("span", "dsc-stat-label", t("Hit points"), hint),
    styled(
      "div",
      "dsc-hp-values",
      current,
      el("span", "/"),
      savedRule(view.projection, human(derived["maxHp"]), "derived.maxHp"),
      styled("label", "dsc-temp", "+", temporary, t("temp")),
    ),
    bar,
  );
  return hp;
}

function inspiration(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    root = styled("label", "dsc-cell dsc-inspiration"),
    toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = view.input.play.inspiration === true;
  toggle.disabled = !view.canEditInspiration;
  toggle.setAttribute("aria-label", t("Inspiration"));
  toggle.dataset["focusKey"] = "vitals/inspiration";
  toggle.addEventListener("change", () => {
    view.input.play.inspiration = toggle.checked;
    view.change();
    view.refresh();
  });
  const star = styled("span", "dsc-star", view.input.play.inspiration ? "★" : "☆");
  star.setAttribute("aria-hidden", "true");
  root.append(toggle, styled("span", "dsc-stat-label", t("Inspiration")), star);
  return root;
}

// Conditions appear once, here, with the separate d20 adjustment and rests.
export function statusRow(
  view: SheetView,
  rest?: (kind: "short" | "long") => void,
): HTMLElement | undefined {
  const t = translator(view.locale),
    root = rulesTarget(styled("div", "dsc-status"), "conditions"),
    saved = rows(view.projection?.sheet["conditions"]),
    options = rows(view.conditions["options"]);
  root.setAttribute("aria-label", t("Conditions"));
  for (const condition of view.input.play.conditions ?? []) {
    const data = saved.find((row) => row["id"] === condition.id) ?? {},
      option = options.find((row) => row["id"] === condition.id),
      name = conditionName(
        Object.keys(data).length ? data : (option ?? {}),
        view.locale,
        condition.id,
      ),
      reference = object(data["reference"]);
    const chip = styled(
      "span",
      "dsc-chip dsc-condition",
      rule(
        name,
        typeof reference["id"] === "string" && reference["id"]
          ? { kind: "rule", id: reference["id"] }
          : undefined,
        undefined,
        text(data["summary"]) || undefined,
        view.projection,
      ),
    );
    chip.dataset["conditionId"] = condition.id;
    if (data["status"] === "immune") {
      chip.dataset["state"] = "inactive";
      chip.title = t("Immune: retained for tracking; its effects are inactive.");
    } else if (data["status"] === "unavailable") {
      chip.dataset["state"] = "inactive";
      chip.title = t(
        "This condition is unavailable in the current rules. Remove it or restore its source.",
      );
    } else if (data["terminal"] === true) {
      chip.dataset["state"] = "terminal";
      chip.title = t(
        "This condition has reached its terminal level. Resolve the outcome at the table.",
      );
    }
    const maximumLevel = Number(option?.["maximumLevel"] ?? 1);
    if (view.canEditConditions && maximumLevel > 1) {
      const step = (delta: number): void => {
        condition.level = Math.max(1, Math.min(maximumLevel, condition.level + delta));
        view.change();
        view.refresh();
      };
      const lower = button(
          "−",
          () => step(-1),
          condition.level <= 1,
          "conditions/" + condition.id + "/lower",
        ),
        raise = button(
          "+",
          () => step(1),
          condition.level >= maximumLevel,
          "conditions/" + condition.id + "/raise",
        );
      lower.setAttribute("aria-label", t("Lower {0}", [name]));
      raise.setAttribute("aria-label", t("Raise {0}", [name]));
      const level = el("b", String(condition.level));
      level.setAttribute("aria-label", t("Level {0}", [condition.level]));
      chip.append(styled("span", "dsc-chip-stepper", lower, level, raise));
    } else if (condition.level > 1) chip.append(el("b", String(condition.level)));
    if (view.canEditConditions) {
      const remove = button(
        "×",
        () => {
          view.input.play.conditions = view.input.play.conditions!.filter(
            (value) => value.id !== condition.id,
          );
          view.change();
          view.refresh();
          root.ownerDocument
            .querySelector<HTMLElement>('[data-focus-key="conditions/add"]')
            ?.focus();
        },
        false,
        "conditions/" + condition.id + "/remove",
      );
      remove.setAttribute("aria-label", t("Remove {0}", [name]));
      chip.append(remove);
    }
    root.append(chip);
  }
  const adjustment = object(view.projection?.sheet["conditionEffects"])["d20Adjustment"];
  if (view.input.play.conditions?.length && typeof adjustment === "number" && adjustment !== 0) {
    const chip = styled(
      "span",
      "dsc-chip dsc-adjustment",
      rule(
        t("D20 roll adjustment: {0}", [signed(adjustment)]),
        undefined,
        view.projection?.explanations["conditionEffects.d20Adjustment"],
        undefined,
        view.projection,
      ),
    );
    chip.title = t(
      "Speed includes condition restrictions. Apply the D20 adjustment once to rolls; displayed bonuses and spell save DCs are unchanged.",
    );
    root.append(chip);
  }
  if (view.canEditConditions && view.conditions["available"] === true) {
    const available = options.filter(
      (option) =>
        option["canAdd"] === true &&
        !view.input.play.conditions?.some((value) => value.id === option["id"]),
    );
    if (available.length) {
      const add = select(
        "",
        available.map((option) => ({
          id: String(option["id"]),
          label: conditionName(option, view.locale, String(option["id"])),
        })),
        (id) => {
          if (!id || view.input.play.conditions?.some((value) => value.id === id)) return;
          view.input.play.conditions = [...(view.input.play.conditions ?? []), { id, level: 1 }];
          view.change();
          view.refresh();
        },
        t,
      );
      add.options[0]!.textContent = t("+ Condition");
      add.className = "dsc-add-condition";
      add.setAttribute("aria-label", t("Add condition"));
      add.dataset["focusKey"] = "conditions/add";
      root.append(add);
    }
  }
  if (rest) {
    root.append(styled("span", "dsc-spacer"));
    for (const kind of ["short", "long"] as const) {
      const action = button(
        t(kind === "short" ? "Short rest" : "Long rest"),
        () => rest(kind),
        !view.canPlay,
        "rest/" + kind,
      );
      action.className = "dsc-rest";
      root.append(action);
    }
  }
  return root.children.length ? root : undefined;
}

export function compactVitals(
  view: SheetView,
  combat: boolean,
  rest?: (kind: "short" | "long") => void,
): HTMLElement {
  const t = translator(view.locale),
    root = rulesTarget(styled("section", "dsc-bar"), "hp", "temporaryHp"),
    values = styled("div", "dsc-vitals");
  root.setAttribute("aria-label", t("Core character values"));
  const speed = derivedCell(view, "Speed", "speed"),
    movement = movementDetails(view.projection, view.locale);
  if (movement) speed.append(movement);
  values.append(
    characterName(view),
    hitPoints(view),
    derivedCell(view, "AC", "armorClass"),
    speed,
    ...(combat ? [derivedCell(view, "Init", "initiative", true)] : []),
    derivedCell(view, "Prof", "proficiencyBonus", true),
    inspiration(view),
  );
  root.append(values);
  const status = statusRow(view, rest);
  if (status) root.append(status);
  return root;
}

function rechargeTag(resource: Record<string, unknown>, locale: string): HTMLElement | undefined {
  const t = translator(locale),
    short: string[] = [],
    long: string[] = [];
  for (const row of rows(resource["recharge"])) {
    const amount = row["amount"],
      value =
        amount === undefined || amount === "full"
          ? ""
          : amount === "halfLevel"
            ? " ½"
            : typeof amount === "number"
              ? " +" + amount
              : object(amount)["abilityMod"]
                ? " +" + text(object(amount)["abilityMod"])
                : "";
    (text(row["on"]) === "long" ? long : short).push(value);
  }
  if (!short.length && !long.length) return undefined;
  const parts = [...short.map((value) => t("SR") + value), ...long.map((value) => t("LR") + value)];
  const tag = styled("span", "dsc-recharge", parts.join(" · "));
  tag.title = [
    ...short.map((value) => t("Short rest") + (value ? ":" + value : "")),
    ...long.map((value) => t("Long rest") + (value ? ":" + value : "")),
  ].join(" · ");
  return tag;
}

// Spent uses are authored play state; pips show what remains.
function usesControl(
  view: SheetView,
  resource: Record<string, unknown>,
  name: string,
): HTMLElement {
  const t = translator(view.locale),
    key = String(resource["key"]),
    maximum = Math.max(0, Number(resource["max"] ?? 0)),
    spent = Math.min(maximum, Math.max(0, view.input.play.resourceUses[key] ?? 0)),
    remaining = maximum - spent;
  const set = (next: number): void => {
    view.input.play.resourceUses[key] = maximum - Math.max(0, Math.min(maximum, next));
    view.change();
    view.refresh();
  };
  if (maximum <= 12) {
    const group = styled("span", "dsc-pips");
    // Spell slots and hit dice are round; feature uses such as Channel Divinity are diamonds.
    group.dataset["shape"] = ["slot", "hitdice"].includes(text(resource["kind"]))
      ? "round"
      : "diamond";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", t("{0}: {1} of {2} left", [name, remaining, maximum]));
    for (let index = 0; index < maximum; index++) {
      const pip = button(
        "",
        () => set(index < remaining ? index : index + 1),
        !view.editing,
        "uses/" + key + "/" + index,
      );
      pip.className = "dsc-pip";
      pip.setAttribute("aria-label", t("{0} use {1}", [name, index + 1]));
      pip.setAttribute("aria-pressed", String(index < remaining));
      group.append(pip);
    }
    return group;
  }
  const pool = styled("span", "dsc-pool"),
    track = styled("span", "dsc-pool-track", el("span"));
  track.style.setProperty("--fill", (maximum ? (remaining / maximum) * 100 : 0) + "%");
  pool.append(track);
  for (const delta of maximum >= 10 ? [-1, -5, 1] : [-1, 1]) {
    const step = button(
      delta > 0 ? "+" + delta : "−" + -delta,
      () => set(remaining + delta),
      !view.editing || (delta < 0 ? remaining + delta < 0 : remaining >= maximum),
      "uses/" + key + "/" + delta,
    );
    step.setAttribute(
      "aria-label",
      delta < 0 ? t("Spend {0} from {1}", [-delta, name]) : t("Restore {0} to {1}", [delta, name]),
    );
    pool.append(step);
  }
  return pool;
}

export function limitedUses(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = rulesTarget(panel(t("Limited uses")), "resources"),
    list = styled("div", "dsc-uses");
  root.classList.add("dsc-uses-panel");
  for (const [name, value] of [
    ...classValueRows(view.projection),
    ...featureDCRows(view.projection, view.locale),
  ])
    list.append(
      styled(
        "div",
        "dsc-use",
        styled("span", "dsc-use-name", name),
        styled("span", "dsc-use-value", value),
      ),
    );
  for (const resource of rows(sheet["resources"])) {
    const key = String(resource["key"]),
      name = text(resource["name"], key),
      maximum = Math.max(0, Number(resource["max"] ?? 0)),
      spent = Math.min(maximum, Math.max(0, view.input.play.resourceUses[key] ?? 0));
    const label = styled(
      "span",
      "dsc-use-name",
      savedRule(view.projection, name, "resources." + key + ".remaining"),
    );
    const recharge = rechargeTag(resource, view.locale);
    if (recharge) label.append(recharge);
    if (object(resource["source"])["acquisition"])
      label.append(el("small", spellSourceLabel(resource["source"], view.locale)));
    const row = styled(
      "div",
      "dsc-use",
      label,
      usesControl(view, resource, name),
      styled("span", "dsc-use-count", maximum - spent + " / " + maximum),
    );
    row.dataset["resource"] = key;
    list.append(row);
  }
  root.append(list);
  for (const activation of rows(sheet["activations"])) {
    const key = String(activation["key"]),
      name = String(activation["name"]);
    root.append(
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
  if (!list.children.length && root.children.length === 2)
    root.append(el("p", t("No resources yet.")));
  return root;
}

function combatAbilities(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = styled("div", "dsc-combat-abilities");
  root.setAttribute("aria-label", t("Ability modifiers and saving throws"));
  for (const ability of abilities) {
    const score = object(object(sheet["abilities"])[ability]),
      save = object(object(sheet["saves"])[ability]);
    const shield = styled("span", "dse-dot dse-shield");
    shield.dataset["proficient"] = String(save["proficient"] === true);
    shield.setAttribute("role", "img");
    shield.setAttribute(
      "aria-label",
      t("{0} — saving throw: {1}", [
        t(abilityNames[ability]!),
        t(save["proficient"] ? "Proficient" : "Untrained"),
      ]),
    );
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute(
      "d",
      "M12 2.4 19.3 5.3V11c0 4.8-3.3 8.6-7.3 10.5C8 19.6 4.7 15.8 4.7 11V5.3Z",
    );
    svg.append(path);
    shield.append(svg);
    root.append(
      styled(
        "section",
        "dsc-combat-ability",
        el("small", ability),
        el(
          "strong",
          savedRule(view.projection, signed(score["mod"]), "abilities." + ability + ".mod"),
        ),
        styled(
          "span",
          "dsc-save",
          shield,
          savedRule(view.projection, signed(save["total"]), "saves." + ability + ".total"),
          ...(save["advantage"] === true ? [advantageMark(view.locale)] : []),
        ),
      ),
    );
  }
  return root;
}

// Reach for melee attacks and normal / long range for ranged and thrown ones,
// in the ruleset's distance unit; a thrown melee weapon shows both.
function attackRange(view: SheetView, weapon: Record<string, unknown>, path: string): HTMLElement {
  const t = translator(view.locale),
    distance = object(weapon["range"]),
    cell = el("td");
  const value = (shown: string, key: string): HTMLElement => {
    const unit = view.projection?.explanations[path + "." + key]?.unit;
    return savedRule(view.projection, unit ? shown + " " + unit : shown, path + "." + key);
  };
  if (typeof weapon["reach"] === "number") cell.append(value(String(weapon["reach"]), "reach"));
  if (typeof distance["normal"] === "number") {
    const range = value(`${human(distance["normal"])} / ${human(distance["long"])}`, "range"),
      thrown = distance["thrown"] === true;
    if (cell.childElementCount) cell.append(el("small", thrown ? t("Thrown") + " " : "", range));
    else cell.append(range, ...(thrown ? [el("small", t("Thrown"))] : []));
  }
  return cell;
}

// Combat lists weapons as a table: name, to hit, damage (versatile beneath),
// range and mastery. Without reach or range from the Engine the column is left out.
function attackTable(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    root = panel(t("Attacks")),
    weapons = rows(view.projection?.sheet["weapons"]),
    ranged = weapons.some(
      (weapon) =>
        typeof weapon["reach"] === "number" || object(weapon["range"])["normal"] !== undefined,
    );
  root.classList.add("dsc-attacks");
  if (!weapons.length) {
    root.append(styled("p", "dse-empty", t("No attacks yet.")));
    return root;
  }
  const body = el("tbody");
  weapons.forEach((weapon, index) => {
    // An unarmed strike comes from the ruleset and has no weapon record.
    const path = "weapons." + index,
      ref = text(weapon["ref"]),
      reference = ref ? { kind: "weapon", id: ref } : undefined,
      item = view.input.play.inventory.find((entry) => entry.id === weapon["itemId"]);
    const damage = el(
      "td",
      savedRule(view.projection, human(weapon["damage"]), path + ".damage"),
      " ",
      styled("span", "dsc-muted", t(label(text(weapon["damageType"])))),
    );
    if (weapon["versatileDamage"])
      damage.append(
        el(
          "small",
          t("Versatile damage") + ": ",
          savedRule(view.projection, human(weapon["versatileDamage"]), path + ".versatileDamage"),
        ),
      );
    const mastery = el("td");
    if (weapon["mastery"]) {
      const tag = styled(
        "span",
        "dsc-tag",
        savedRule(view.projection, t(label(text(weapon["mastery"]))), undefined, reference),
      );
      tag.dataset["active"] = String(weapon["masteryActive"] === true);
      tag.title = t(weapon["masteryActive"] === true ? "Active" : "Inactive");
      mastery.append(tag);
    }
    body.append(
      el(
        "tr",
        el(
          "th",
          savedRule(
            view.projection,
            text(weapon["name"], ref),
            undefined,
            reference ?? featureReference(weapon),
          ),
          ...(item && item.quantity > 1 ? [el("small", " ×" + item.quantity)] : []),
          ...(typeof weapon["criticalRange"] === "number"
            ? [styled("small", "dsc-crit", t("Crit {0}–20", [weapon["criticalRange"]]))]
            : []),
        ),
        styled(
          "td",
          "dsc-hit",
          savedRule(view.projection, signed(weapon["attackBonus"]), path + ".attackBonus"),
        ),
        damage,
        ...(ranged ? [attackRange(view, weapon, path)] : []),
        mastery,
      ),
    );
  });
  const head = el(
    "tr",
    ...["Weapon", "To hit", "Damage", ...(ranged ? ["Range"] : []), "Mastery"].map((name) => {
      const cell = el("th", t(name));
      cell.scope = "col";
      return cell;
    }),
  );
  root.append(styled("table", "dsc-attack-table", el("thead", head), body));
  return root;
}

// A feature attack (Psychic Blade) links to the feature that creates it.
function featureReference(weapon: Record<string, unknown>): Reference | undefined {
  const source = object(weapon["source"]);
  return weapon["featureAttack"] && text(source["id"])
    ? { kind: text(source["type"]), id: text(source["id"]) }
    : undefined;
}

// "Paladin 2", "Oath of Devotion", "Human": where a feature comes from.
function featureSource(view: SheetView, value: unknown): string {
  const source = object(value),
    id = text(source["id"]),
    name = id ? recordName(view, text(source["type"]), id) : "";
  return [name === id ? label(id) : name, human(source["level"] ?? "")]
    .filter((part) => part && part !== "—")
    .join(" ");
}

// Features and feats read as a grid of short entries; each name opens its full text.
function features(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = panel(t("Features and traits")),
    grid = styled("div", "dsc-feats");
  root.classList.add("dsc-features");
  const entry = (name: string, reference: Reference, source: string): HTMLElement => {
    const summary = view.projection?.evidence.find(
      (row) => row.reference.kind === reference.kind && row.reference.id === reference.id,
    )?.summary;
    return styled(
      "div",
      "dsc-feat",
      styled(
        "div",
        "dsc-feat-head",
        savedRule(view.projection, name, undefined, reference),
        ...(source ? [el("small", source)] : []),
      ),
      ...(summary ? [el("p", plainDescription(summary))] : []),
    );
  };
  for (const feature of rows(sheet["features"])) {
    const id = String(feature["id"]),
      count = Number(feature["count"] ?? 1);
    grid.append(
      entry(
        text(feature["name"], id) + (count > 1 ? " × " + count : ""),
        { kind: "feature", id },
        featureSource(view, feature["source"]),
      ),
    );
  }
  for (const selection of selectionEntries(view.projection, view.locale))
    grid.append(
      styled(
        "div",
        "dsc-feat",
        styled("div", "dsc-feat-head", el("strong", selection.name)),
        el(
          "p",
          ...selection.values.flatMap((value, index) => [
            ...(index ? [", "] : []),
            value.reference
              ? savedRule(view.projection, value.name, undefined, value.reference)
              : value.name,
          ]),
        ),
      ),
    );
  for (const feat of rows(sheet["feats"])) {
    const id = String(feat["id"]),
      count = Number(feat["count"] ?? 1);
    grid.append(
      entry(
        text(feat["name"], id) + (count > 1 ? " × " + count : ""),
        { kind: "feat", id },
        t("Feat"),
      ),
    );
  }
  root.append(grid.children.length ? grid : el("p", t("None recorded")));
  return root;
}

// Armor, weapon, tool and language training with senses and size as one list;
// saves and skills are already on the ability cards.
function training(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = rulesTarget(panel(t("Training and senses")), "senses"),
    list = styled("dl", "dsc-training");
  const row = (name: string, ...value: (Node | string)[]): HTMLElement => {
    const entry = el("dd", ...value);
    list.append(el("dt", name), entry);
    return entry;
  };
  const none = (key: string): HTMLElement => styled("span", "dsc-none", t(key));
  for (const group of proficiencyGroups(view.projection, view.locale))
    if (["armor", "weapons", "tools", "languages"].includes(group.id) && group.available)
      row(
        group.name,
        ...(group.entries.length
          ? group.entries.flatMap((entry, index) => [
              ...(index ? [", "] : []),
              entry.reference
                ? rule(entry.name, entry.reference, undefined, undefined, view.projection)
                : entry.name,
            ])
          : [none("None recorded")]),
      );
  const senses = Object.entries(object(sheet["senses"]));
  row(
    t("Senses"),
    ...(senses.length
      ? senses.flatMap(([key, value], index) => [
          ...(index ? [", "] : []),
          savedRule(
            view.projection,
            t(label(key)) +
              " " +
              human(value) +
              " " +
              (view.projection?.explanations["senses." + key]?.unit ?? ""),
            "senses." + key,
          ),
        ])
      : [none("No additional senses.")]),
  );
  if (Object.hasOwn(object(sheet["derived"]), "size"))
    row(t("Size"), sizeDetails(view)).classList.add("dsc-size");
  for (const key of ["resistances", "damageImmunities", "conditionImmunities"]) {
    const value = human(sheet[key]);
    if (sheet[key] !== undefined && value && value !== "—") row(t(label(key)), value);
  }
  const advantages = advantageNames(view.projection, view.locale);
  if (advantages.length) row(t("Advantage"), advantages.join("; "));
  if (Number(sheet["concentrationSaveBonus"] ?? 0) !== 0)
    row(
      t("Concentration"),
      savedRule(view.projection, signed(sheet["concentrationSaveBonus"]), "concentrationSaveBonus"),
    );
  root.append(list);
  return root;
}

function ready(view: SheetView, actions: CompactActions, combat: boolean): HTMLElement {
  const t = translator(view.locale),
    pins = quickUse(view);
  pins
    .querySelector("h3")
    ?.append(opens(button(t("Arrange"), () => actions.backpack(), false, "quick-use/arrange")));
  // Sheet gives the hand selectors the full width; Combat keeps them beside
  // the limited uses, where its attack line fits.
  return combat
    ? styled(
        "div",
        "dsc-ready",
        limitedUses(view),
        styled("div", "dsc-column", handControls(view, combat), pins),
      )
    : styled(
        "div",
        "dsc-column",
        handControls(view, combat),
        styled("div", "dsc-ready", limitedUses(view), pins),
      );
}

export function compactSheet(
  view: SheetView,
  combat: boolean,
  actions: CompactActions,
): HTMLElement {
  if (combat) {
    const attacks = attackTable(view),
      casters = rows(object(view.projection?.sheet["spellcasting"])["perClass"]);
    if (casters.length)
      attacks.append(
        styled(
          "div",
          "dsc-casting",
          ...casters.map((caster, index) => {
            const { source, numbers } = castingDetails(view, caster, index);
            return styled("div", "dse-casting", el("small", source), numbers);
          }),
        ),
      );
    return styled(
      "div",
      "dsc-combat",
      compactVitals(view, true, actions.rest),
      combatAbilities(view),
      attacks,
      ready(view, actions, true),
    );
  }
  return styled(
    "div",
    "dsc-sheet",
    styled(
      "div",
      "dsc-sheet-main",
      compactVitals(view, false, actions.rest),
      ready(view, actions, false),
      features(view),
      training(view),
    ),
    abilityRail(view),
  );
}

// When the Engine says a caster may change its prepared list.
function preparationTiming(preparation: unknown, locale: string): string {
  const t = translator(locale),
    { on, count } = object(preparation);
  if (on === "longRest" && count === "all") return t("Prepares after a long rest");
  if (typeof count !== "number") return "";
  if (on === "longRest")
    return count === 1
      ? t("Replaces one spell after a long rest")
      : t("Replaces {0} spells after a long rest", [count]);
  if (on === "classLevel")
    return count === 1
      ? t("Replaces one spell on gaining a level")
      : t("Replaces {0} spells on gaining a level", [count]);
  return "";
}

export function compactSpellBar(view: SheetView, prepare?: () => void): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = styled("section", "dsc-bar"),
    values = styled("div", "dsc-vitals dsc-spell-values");
  root.setAttribute("aria-label", t("Spellcasting"));
  values.append(characterName(view));
  // Each caster leads with its class, ability and when it may change its
  // prepared spells; save DC and spell attack read like AC: big numbers.
  // Several casters name their class on every value.
  const casters = rows(object(sheet["spellcasting"])["perClass"]),
    prepared: HTMLElement[] = [];
  casters.forEach((caster, index) => {
    const source = casterSource(view, caster),
      path = "spellcasting.perClass." + index,
      named = (name: string): string => (casters.length > 1 ? source + " · " + t(name) : t(name)),
      who = t("{0} · {1}", [source, t(abilityNames[text(caster["ability"])] ?? "")]),
      timing = preparationTiming(caster["preparation"], view.locale);
    values.append(
      styled(
        "div",
        "dsc-cell dsc-caster",
        styled("span", "dsc-stat-label", who),
        ...(timing ? [styled("span", "dsc-muted", timing)] : []),
      ),
    );
    if (typeof caster["preparedCount"] === "number" && typeof caster["preparedLimit"] === "number")
      prepared.push(
        cell(
          named("Prepared"),
          savedRule(
            view.projection,
            caster["preparedCount"] + " / " + caster["preparedLimit"],
            path + ".preparedLimit",
          ),
          "prepared",
        ),
      );
    const dc = cell(
        named("Save DC"),
        savedRule(view.projection, human(caster["saveDC"]), path + ".saveDC"),
        "saveDC",
      ),
      attack = cell(
        named("Attack"),
        savedRule(view.projection, signed(caster["spellAttack"]), path + ".spellAttack"),
        "spellAttack",
      );
    values.append(dc, attack);
  });
  for (const resource of rows(sheet["resources"]).filter((row) => row["kind"] === "slot")) {
    const key = String(resource["key"]),
      maximum = Math.max(0, Number(resource["max"] ?? 0)),
      spent = Math.min(maximum, Math.max(0, view.input.play.resourceUses[key] ?? 0)),
      name = text(resource["name"], key);
    const slots = styled(
      "div",
      "dsc-cell",
      styled("span", "dsc-stat-label", slotLabel(resource, maximum - spent, maximum, view.locale)),
      usesControl(view, resource, name),
    );
    slots.dataset["resource"] = key;
    values.append(slots);
  }
  // The prepared counts sit at the end, the last beside the button that changes them.
  if (prepare || prepared.length) values.append(styled("span", "dsc-spacer"), ...prepared);
  if (prepare) {
    const count = prepared.at(-1)?.querySelector(".dsc-cell-value"),
      change = opens(
        button(count ? t("Change") : t("Change prepared spells"), prepare, false, "spells/prepare"),
      );
    change.setAttribute("aria-label", t("Change prepared spells"));
    if (count) {
      const pair = styled("span", "dsc-prepared");
      count.replaceWith(pair);
      pair.append(count, change);
    } else values.append(styled("div", "dsc-cell", change));
  }
  root.append(values);
  const status = statusRow(view);
  if (status) root.append(status);
  return root;
}

function equipmentBar(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    attunement = object(view.projection?.sheet["attunement"]),
    root = styled("section", "dsc-bar"),
    values = styled("div", "dsc-vitals");
  root.setAttribute("aria-label", t("Equipment effects"));
  values.append(
    characterName(view),
    derivedCell(view, "Armor class", "armorClass"),
    derivedCell(view, "Speed", "speed"),
  );
  if (typeof attunement["limit"] === "number") {
    const count = Number(attunement["count"] ?? 0),
      limit = attunement["limit"];
    const pips = styled("span", "dsc-pips");
    pips.setAttribute("aria-hidden", "true");
    for (let index = 0; index < limit; index++) {
      const pip = styled("span", "dsc-pip");
      pip.dataset["on"] = String(index < count);
      pips.append(pip);
    }
    values.append(
      styled(
        "div",
        "dsc-cell",
        styled("span", "dsc-stat-label", t("Attunement · {0} / {1}", [count, limit])),
        pips,
      ),
    );
  }
  root.append(values);
  return root;
}

const bodyPlaces = [
  "head",
  "face",
  "body",
  "neck",
  "wrists",
  "shoulders",
  "legs",
  "waist",
  "feet",
  "gloves",
];

function stowButton(view: SheetView, item: Item, focusKey: string): HTMLButtonElement {
  const t = translator(view.locale);
  return button(
    t(item.attuned ? "Stow & unattune" : "Stow"),
    () => {
      if (
        item.attuned
          ? stowAndUnattune(item)
          : moveEquipment(
              view.input.play.inventory,
              item.id,
              "carried",
              view.equipment,
              view.projection,
            )
      ) {
        view.change();
        view.refresh();
      }
    },
    false,
    focusKey,
  );
}

function wornList(view: SheetView, figure: (place?: string) => void): HTMLElement {
  const t = translator(view.locale),
    root = rulesTarget(panel(t("Worn and held")), "inventory", "hands"),
    list = styled("div", "dsc-worn"),
    hands = view.input.play.hands,
    equipped = view.input.play.inventory.filter(
      (item) => item.quantity > 0 && item.location === "equipped",
    );
  root.classList.add("dsc-worn-panel");
  root
    .querySelector("h3")
    ?.append(opens(button(t("Open figure"), () => figure(), false, "placement/open")));
  const named = (id: string | undefined): string | undefined =>
    id ? (view.input.play.inventory.find((item) => item.id === id)?.name ?? id) : undefined;
  const held = [named(hands?.main), named(hands?.off)].filter(Boolean);
  if (held.length)
    list.append(
      styled(
        "div",
        "dsc-worn-row",
        styled("span", "dsc-worn-place", t("Hands")),
        styled(
          "span",
          "dsc-worn-name",
          held.join(" · "),
          ...(hands?.grip === "two" ? [el("small", t("Two-handed grip"))] : []),
        ),
      ),
    );
  const row = (place: string, item: Item, first: boolean): HTMLElement => {
    const label = first
      ? button(
          bodyPlacementLabel(place, view.locale),
          () => figure(place),
          false,
          "placement/" + place,
        )
      : el("span");
    label.className = "dsc-worn-place";
    const name = styled(
      "span",
      "dsc-worn-name",
      savedRule(view.projection, item.name, undefined, item.reference),
    );
    if (item.attuned) name.append(styled("span", "dsc-tag", t("Attuned")));
    const node = styled("div", "dsc-worn-row", label, name);
    if (view.editing) node.append(stowButton(view, item, "worn/" + item.id));
    return node;
  };
  for (const place of bodyPlaces)
    equipped
      .filter((item) => item.bodyPlacement === place)
      .forEach((item, index) => list.append(row(place, item, index === 0)));
  equipped
    .filter(
      (item) =>
        (!item.bodyPlacement || !bodyPlaces.includes(item.bodyPlacement)) &&
        ![hands?.main, hands?.off].includes(item.id),
    )
    .forEach((item, index) => list.append(row("other", item, index === 0)));
  if (!list.children.length) list.append(el("p", t("Nothing worn or held.")));
  root.append(list);
  const empty = bodyPlaces.filter(
    (place) => !equipped.some((item) => item.bodyPlacement === place),
  );
  if (empty.length) {
    const places = styled("div", "dsc-empty-places", styled("span", "dsc-stat-label", t("Empty")));
    for (const place of empty) {
      const choose = button(
        bodyPlacementLabel(place, view.locale),
        () => figure(place),
        false,
        "placement/" + place,
      );
      choose.setAttribute("aria-label", t("Choose {0}", [bodyPlacementLabel(place, view.locale)]));
      places.append(choose);
    }
    root.append(places);
  }
  return root;
}

function backpackSummary(view: SheetView, open: (container?: string) => void): HTMLElement {
  const t = translator(view.locale),
    root = rulesTarget(panel(t("Backpack")), "inventory"),
    heading = root.querySelector("h3")!,
    items = view.input.play.inventory.filter((item) => item.location !== "equipped"),
    containers = view.input.play.containers ?? [];
  root.classList.add("dsc-pack");
  heading.append(
    styled(
      "span",
      "dsc-actions",
      button(t("Add item"), () => view.addItem(), !view.editing, "equipment/add"),
      opens(button(t("Open"), () => open(), false, "storage/open")),
    ),
  );
  const pinned = new Set(view.input.play.quickUse ?? []);
  const group = (title: string, members: Item[], container?: string): void => {
    if (!members.length && !container) return;
    const head = styled("h4", "dsc-pack-group", title, el("small", String(members.length)));
    if (container) {
      const openGroup = opens(
        button(t("Open"), () => open(container), false, "storage/open/" + container),
      );
      openGroup.setAttribute("aria-label", t("Open {0}", [title]));
      head.append(openGroup);
    }
    root.append(head);
    for (const item of members) {
      const line = styled(
        "div",
        "dsc-pack-row",
        styled(
          "span",
          "dsc-pack-name",
          savedRule(view.projection, item.name, undefined, item.reference),
        ),
        styled("span", "dsc-pack-quantity", "×" + item.quantity),
      );
      if (item.location === "stored" && container)
        line.append(styled("span", "dsc-tag", t("Stored")));
      const pin = button(
        pinned.has(item.id) ? "★" : "☆",
        () => {
          if (pinQuickUse(view.input, item.id, !pinned.has(item.id))) {
            view.change();
            view.refresh();
          }
        },
        !view.canEditQuickUse,
        "pack/" + item.id + "/pin",
      );
      pin.className = "dsc-pin";
      pin.setAttribute("aria-label", t("Quick use: {0}", [item.name]));
      pin.setAttribute("aria-pressed", String(pinned.has(item.id)));
      line.append(pin);
      root.append(line);
    }
  };
  group(
    t("Carried"),
    items.filter((item) => !item.containerId && item.location === "carried"),
  );
  for (const container of containers)
    group(
      container.name,
      items.filter((item) => item.containerId === container.id),
      container.id,
    );
  group(
    t("Stored"),
    items.filter((item) => !item.containerId && item.location === "stored"),
  );
  if (!items.length) root.append(el("p", t("Add an item to your backpack first.")));
  return root;
}

// The coins' total worth, converted by the Engine from the ruleset's coin values.
function currencyWorth(view: SheetView): HTMLElement[] {
  const t = translator(view.locale),
    worth = object(view.projection?.sheet["currencyWorth"]),
    value = worth["value"],
    coin = text(worth["coin"]);
  if (typeof value !== "number" || !coin) return [];
  const amount = new Intl.NumberFormat(view.locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return [
    styled(
      "div",
      "dsc-worth",
      styled(
        "span",
        "dsc-stat-label",
        coin === "gp" ? t("Worth in gold") : t("Worth in {0}", [coin.toUpperCase()]),
      ),
      styled(
        "strong",
        "dsc-cell-value",
        savedRule(view.projection, amount + " " + coin, "currencyWorth.value"),
      ),
    ),
  ];
}

export function compactEquipment(view: SheetView, actions: CompactActions): HTMLElement {
  const t = translator(view.locale);
  const controls = el(
    "details",
    el("summary", t("Equipment controls")),
    wornEquipment(view, ["armor", "shield", "worn", "attuned"]),
  );
  controls.dataset["detailsKey"] = "equipment/controls";
  const coins = panel(
    t("Currency"),
    styled("div", "dsc-coin-row", currency(view), ...currencyWorth(view)),
  );
  coins.classList.add("dsc-currency");
  return styled(
    "div",
    "dsc-equipment",
    styled(
      "div",
      "dsc-column",
      equipmentBar(view),
      wornList(view, actions.figure),
      controls,
      coins,
    ),
    backpackSummary(view, actions.backpack),
  );
}

function mannequin(): HTMLElement {
  const root = styled("div", "dsc-body");
  root.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 160 420");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    "M80 12c-24 0-24 49 0 49s24-49 0-49ZM67 62l-2 14-23 13-16 62L13 235q0 22 10 24l8-20 9-56 13-37 8 84-9 154-14 21q-4 8 9 8h25l3-160 10 0 3 160h25q13 0 9-8l-14-21-9-154 8-84 13 37 9 56 8 20q10-2 10-24l-13-84-16-62-23-13-2-14Z",
  );
  svg.append(path);
  root.append(svg);
  return root;
}

// The body figure lives only in its window: select a place, then wear, swap
// or stow items there. Placement organizes gear; rules effects stay separate.
export function figureWindow(
  view: SheetView,
  selected: string | undefined,
  choose: (place: string) => void,
): HTMLElement {
  const t = translator(view.locale),
    doll = styled("div", "dsc-mannequin", mannequin());
  const slot = (place: string): HTMLButtonElement => {
    const items = view.input.play.inventory.filter(
      (item) =>
        item.quantity > 0 &&
        item.location === "equipped" &&
        (place === "other"
          ? !item.bodyPlacement || item.bodyPlacement === "other"
          : item.bodyPlacement === place) &&
        (place !== "other" ||
          ![view.input.play.hands?.main, view.input.play.hands?.off].includes(item.id)),
    );
    const node = button("", () => choose(place), false, "figure/" + place);
    node.className = "dsc-body-slot";
    node.dataset["placement"] = place;
    node.setAttribute("aria-pressed", String(place === selected));
    node.append(
      el("small", bodyPlacementLabel(place, view.locale)),
      el("span", items.length ? items.map((item) => item.name).join(", ") : t("Empty")),
    );
    return node;
  };
  for (const place of bodyPlaces) doll.append(slot(place));
  const root = styled("div", "dsc-figure", doll, styled("div", "dsc-figure-other", slot("other")));
  if (selected) {
    const picker = panel(
      bodyPlacementLabel(selected, view.locale),
      placementPicker(view, selected),
    );
    picker.classList.add("dsc-figure-picker");
    root.append(picker);
  } else root.append(el("p", t("Select a place to wear, swap or stow items.")));
  return root;
}

export function placementPicker(view: SheetView, place: string): HTMLElement {
  const t = translator(view.locale),
    root = styled("div", "dsc-placement-picker"),
    own = view.input.play.inventory.filter(
      (item) =>
        item.location === "equipped" &&
        (place === "other"
          ? (item.bodyPlacement === "other" || !item.bodyPlacement) &&
            ![view.input.play.hands?.main, view.input.play.hands?.off].includes(item.id)
          : item.bodyPlacement === place),
    );
  for (const item of own) {
    const row = styled(
      "div",
      "dsc-worn-item",
      savedRule(view.projection, item.name, undefined, item.reference),
    );
    if (view.editing) row.append(stowButton(view, item, "placement/stow/" + item.id));
    root.append(row);
  }
  if (!view.canEditPlacement) {
    if (!own.length) root.append(el("p", t("Empty")));
    return root;
  }
  const candidates = view.input.play.inventory.filter(
    (item) =>
      item.quantity > 0 &&
      item.bodyPlacement !== place &&
      strings(object(view.equipment[item.id])["bodyPlacements"]).includes(place),
  );
  for (const item of candidates)
    root.append(
      button(
        item.name,
        () => {
          if (
            !moveEquipment(
              view.input.play.inventory,
              item.id,
              "equipped",
              view.equipment,
              view.projection,
            )
          )
            return;
          assignBodyPlacement(item, place, view.equipment);
          view.change();
          view.refresh();
        },
        object(view.equipment[item.id])["canEquip"] !== true,
        "placement/choose/" + item.id,
      ),
    );
  if (!candidates.length) root.append(el("p", t("No compatible inventory items.")));
  root.append(button(t("Add item"), () => view.addItem()));
  return root;
}

// Rest windows list what each resource's own recharge declares; the rules
// apply the rest itself.
export function restWindow(
  view: SheetView,
  kind: "short" | "long",
  recovery: HTMLElement | undefined,
  finish: () => void | Promise<void>,
): HTMLElement {
  const t = translator(view.locale),
    root = styled("div", "dsc-rest-window"),
    returning = rows(view.projection?.sheet["resources"]).filter((resource) =>
      rows(resource["recharge"]).some(
        (row) => kind === "long" || row["on"] === "short" || row["on"] === "shortOrLong",
      ),
    );
  const list = styled("ul", "dsc-rest-list");
  for (const resource of returning) {
    const key = String(resource["key"]),
      maximum = Math.max(0, Number(resource["max"] ?? 0)),
      spent = Math.min(maximum, Math.max(0, view.input.play.resourceUses[key] ?? 0)),
      tag = rechargeTag(resource, view.locale);
    list.append(
      el(
        "li",
        styled("span", "", text(resource["name"], key), ...(tag ? [tag] : [])),
        el("b", maximum - spent + " / " + maximum),
      ),
    );
  }
  root.append(
    el("h3", t(kind === "short" ? "Returns on a short rest" : "Returns on a long rest")),
    list.children.length ? list : el("p", t("No resources return on this rest.")),
  );
  if (recovery) root.append(recovery);
  root.append(
    el("p", t("Conditions stay until you end them.")),
    button(
      t(kind === "short" ? "Finish short rest" : "Finish long rest"),
      finish,
      !view.canPlay,
      "rest/finish",
    ),
  );
  root.lastElementChild!.setAttribute("data-ui-variant", "primary");
  return root;
}
