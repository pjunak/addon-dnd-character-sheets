import type { SheetView } from "./character-sheet.js";
import {
  abilityRail,
  attackDetails,
  castingDetails,
  classValueRows,
  currency,
  explorationDetails,
  savedRule,
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
import { rulesTarget } from "./character-rule-notes.js";
import { spellSourceLabel } from "./character-spells.js";
import {
  button,
  el,
  human,
  numberInput,
  panel,
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
  const hint = styled("span", "dsc-hp-hint", t("−7 · +5 · =30"));
  hint.id = "dsc-hp-hint-" + crypto.randomUUID();
  hint.title = t("Type −7 for damage, +5 to heal or a number to set hit points, then press Enter.");
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
      void view.act(
        { operation: entry.kind, amount: entry.amount },
        t(entry.kind === "damage" ? "Damage" : "Heal"),
      );
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
  values.append(
    hitPoints(view),
    derivedCell(view, "Armor class", "armorClass"),
    derivedCell(view, "Speed", "speed"),
    ...(combat ? [derivedCell(view, "Initiative", "initiative", true)] : []),
    derivedCell(view, "Proficiency", "proficiencyBonus", true),
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
  for (const [name, value] of classValueRows(view.projection))
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
          view.act(
            { operation: "toggle-feature", key, enabled: !view.input.play.activeFeatures[key] },
            name,
          ),
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
        ),
      ),
    );
  }
  return root;
}

function exploration(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    root = panel(t("Exploration")),
    contents = explorationDetails(view);
  root.classList.add("dsc-exploration");
  if (Object.hasOwn(object(view.projection?.sheet["derived"]), "size"))
    root.append(
      styled("p", "dsc-size", styled("span", "dse-stat-label", t("Size")), " ", sizeDetails(view)),
    );
  for (const [index, section] of [...contents.children].entries()) {
    const title = section.querySelector("h3")?.textContent ?? t("Details");
    const details = el("details", el("summary", title), section);
    details.dataset["detailsKey"] = "exploration/" + index;
    root.append(details);
  }
  return root;
}

function ready(view: SheetView, actions: CompactActions, combat: boolean): HTMLElement {
  const t = translator(view.locale),
    pins = quickUse(view);
  pins
    .querySelector("h3")
    ?.append(button(t("Arrange"), () => actions.backpack(), false, "quick-use/arrange"));
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
    const attacks = attackDetails(view),
      casters = rows(object(view.projection?.sheet["spellcasting"])["perClass"]);
    if (casters.length)
      attacks.append(
        styled(
          "div",
          "dsc-casting",
          ...casters.map((caster, index) => castingDetails(view, caster, index)),
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
      exploration(view),
    ),
    abilityRail(view),
  );
}

export function compactSpellBar(view: SheetView, prepare?: () => void): HTMLElement {
  const t = translator(view.locale),
    sheet = view.projection?.sheet ?? {},
    root = styled("section", "dsc-bar"),
    values = styled("div", "dsc-vitals dsc-spell-values");
  root.setAttribute("aria-label", t("Spellcasting"));
  rows(object(sheet["spellcasting"])["perClass"]).forEach((caster, index) =>
    values.append(styled("div", "dsc-cell", castingDetails(view, caster, index))),
  );
  for (const resource of rows(sheet["resources"]).filter((row) => row["kind"] === "slot")) {
    const key = String(resource["key"]),
      maximum = Math.max(0, Number(resource["max"] ?? 0)),
      spent = Math.min(maximum, Math.max(0, view.input.play.resourceUses[key] ?? 0)),
      name = text(resource["name"], key);
    const slots = styled(
      "div",
      "dsc-cell",
      styled(
        "span",
        "dsc-stat-label",
        t("Level {0} · {1} / {2}", [resource["level"], maximum - spent, maximum]),
      ),
      usesControl(view, resource, name),
    );
    slots.dataset["resource"] = key;
    values.append(slots);
  }
  if (prepare) {
    values.append(styled("span", "dsc-spacer"));
    values.append(
      styled(
        "div",
        "dsc-cell",
        button(t("Change prepared spells"), prepare, false, "spells/prepare"),
      ),
    );
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
    ?.append(button(t("Open figure"), () => figure(), false, "placement/open"));
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
      button(t("Open"), () => open(), false, "storage/open"),
    ),
  );
  const pinned = new Set(view.input.play.quickUse ?? []);
  const group = (title: string, members: Item[], container?: string): void => {
    if (!members.length && !container) return;
    const head = styled("h4", "dsc-pack-group", title, el("small", String(members.length)));
    if (container) {
      const openGroup = button(
        t("Open"),
        () => open(container),
        false,
        "storage/open/" + container,
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

export function compactEquipment(view: SheetView, actions: CompactActions): HTMLElement {
  const t = translator(view.locale);
  const controls = el(
    "details",
    el("summary", t("Equipment controls")),
    wornEquipment(view, ["armor", "shield", "worn", "attuned"]),
  );
  controls.dataset["detailsKey"] = "equipment/controls";
  const coins = panel(t("Currency"), currency(view));
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
