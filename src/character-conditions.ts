import type { Inputs, Projection, Reference } from "./character-model.js";
import type { SheetView } from "./character-sheet.js";
import { object, rows, text } from "./character-client.js";
import { translator } from "./character-locale.js";
import { spellSourceLabel } from "./character-spells.js";
import {
  button,
  combo,
  el,
  field,
  numberInput,
  panel,
  rule,
  signed,
  styled,
} from "./character-ui.js";
import { rulesTarget } from "./character-rule-notes.js";

export function conditionName(
  row: Record<string, unknown>,
  locale: string,
  fallback: string,
): string {
  return typeof row["labelKey"] === "string" && row["labelKey"]
    ? translator(locale)(row["labelKey"])
    : text(row["name"], fallback);
}

/** A condition active items give, such as Fate-Touched from each Cursed Card. */
export interface GrantedCondition {
  id: string;
  name: string;
  /** How many active items give it. */
  level: number;
  summary: string;
  /** The names of the items that give it. */
  sources: string[];
  immune: boolean;
}
// Granted conditions are not authored play state: they last while their items
// are active, so the sheet shows them without a remove or level control.
export function grantedConditions(
  projection: Projection | undefined,
  locale: string,
): GrantedCondition[] {
  return rows(projection?.sheet["conditions"])
    .filter((row) => row["granted"] === true)
    .map((row) => {
      const id = text(row["id"]),
        level = Number(row["level"]);
      return {
        id,
        name: conditionName(row, locale, id),
        level: Number.isInteger(level) && level > 0 ? level : 1,
        summary: text(row["summary"]),
        sources: [
          ...new Set(
            rows(row["sources"]).map((source) =>
              spellSourceLabel(source, locale, projection?.evidence),
            ),
          ),
        ],
        immune: row["status"] === "immune",
      };
    });
}

export function conditionsRead(
  input: Inputs,
  projection: Projection | undefined,
  locale: string,
): HTMLElement {
  const t = translator(locale),
    root = rulesTarget(panel(t("Conditions")), "conditions");
  root.className = "dse-section dse-conditions";
  root.setAttribute("aria-label", t("Conditions"));
  const heading = root.querySelector<HTMLElement>("h3")!;
  heading.tabIndex = -1;
  heading.dataset["focusKey"] = "conditions/heading";
  const saved = rows(projection?.sheet["conditions"]),
    granted = grantedConditions(projection, locale);
  if (!input.play.conditions?.length && !granted.length)
    root.append(el("p", t("No active conditions.")));
  for (const condition of input.play.conditions ?? []) {
    const data = saved.find((row) => row["id"] === condition.id && row["granted"] !== true) ?? {},
      name = conditionName(data, locale, condition.id);
    const reference = object(data["reference"]),
      source: Reference | undefined =
        typeof reference["id"] === "string" && reference["id"]
          ? { kind: "rule", id: reference["id"] }
          : undefined;
    const row = styled("div", "dse-condition"),
      details = el("details", el("summary", rule(name, source, undefined, undefined, projection)));
    row.dataset["conditionId"] = condition.id;
    details.dataset["detailsKey"] = "condition/" + condition.id;
    if (data["summary"]) details.append(el("p", text(data["summary"])));
    row.append(details, el("span", t("Level {0}", [condition.level])));
    if (data["status"] === "immune")
      row.append(el("p", t("Immune: retained for tracking; its effects are inactive.")));
    if (data["status"] === "unavailable")
      row.append(
        el(
          "p",
          t("This condition is unavailable in the current rules. Remove it or restore its source."),
        ),
      );
    if (data["terminal"] === true)
      row.append(
        styled(
          "p",
          "character-warning",
          t("This condition has reached its terminal level. Resolve the outcome at the table."),
        ),
      );
    root.append(row);
  }
  for (const condition of granted) {
    const row = styled("div", "dse-condition"),
      details = el(
        "details",
        el("summary", rule(condition.name, undefined, undefined, undefined, projection)),
      );
    row.dataset["conditionId"] = condition.id;
    row.dataset["granted"] = "";
    details.dataset["detailsKey"] = "condition/granted/" + condition.id;
    if (condition.summary) details.append(el("p", condition.summary));
    row.append(details, el("span", t("Level {0}", [condition.level])));
    if (condition.sources.length)
      row.append(el("p", t("Granted by {0}", [condition.sources.join(", ")])));
    if (condition.immune)
      row.append(el("p", t("Immune: retained for tracking; its effects are inactive.")));
    root.append(row);
  }
  if (input.play.conditions?.length) {
    const adjustment = object(projection?.sheet["conditionEffects"])["d20Adjustment"];
    if (typeof adjustment === "number" && adjustment !== 0)
      root.append(
        el(
          "p",
          rule(
            t("D20 roll adjustment: {0}", [signed(adjustment)]),
            undefined,
            projection?.explanations["conditionEffects.d20Adjustment"],
            undefined,
            projection,
          ),
        ),
      );
    root.append(
      el(
        "small",
        t(
          "Speed includes condition restrictions. Apply the D20 adjustment once to rolls; displayed bonuses and spell save DCs are unchanged.",
        ),
      ),
    );
    root.append(
      el(
        "small",
        t(
          "Adjust conditions when they end, including after a rest. Resolve other effects at the table.",
        ),
      ),
    );
  }
  return root;
}

export function conditions(view: SheetView): HTMLElement {
  const t = translator(view.locale),
    root = conditionsRead(view.input, view.projection, view.locale),
    options = rows(view.conditions["options"]);
  if (!view.canEditConditions) return root;
  for (const row of root.querySelectorAll<HTMLElement>("[data-condition-id]:not([data-granted])")) {
    const id = row.dataset["conditionId"]!,
      condition = view.input.play.conditions!.find((value) => value.id === id)!;
    const option = options.find((value) => value["id"] === id),
      name = conditionName(option ?? {}, view.locale, id);
    if (Number(option?.["maximumLevel"]) > 1) {
      const level = numberInput(
        condition.level,
        (value) => {
          condition.level = value ?? 0;
          view.change();
        },
        1,
        Number(option!["maximumLevel"]),
      );
      level.dataset["focusKey"] = "conditions/" + id + "/level";
      row.querySelector(":scope > span")?.replaceWith(field(t("{0} level", [name]), level));
    }
    const remove = button(
      t("Remove {0}", [name]),
      () => {
        root.querySelector<HTMLElement>("[data-focus-key='conditions/heading']")?.focus();
        view.input.play.conditions = view.input.play.conditions!.filter((value) => value.id !== id);
        view.change();
        view.refresh();
      },
      false,
      "conditions/" + id + "/remove",
    );
    row.append(remove);
  }
  if (view.conditions["available"] !== true) {
    root.append(el("p", t("Condition choices are unavailable in the selected rules.")));
    return root;
  }
  const available = options.filter(
    (option) =>
      option["canAdd"] === true &&
      !view.input.play.conditions?.some((value) => value.id === option["id"]),
  );
  if (available.length) {
    const picker = combo(
      "",
      [
        { id: "", label: t("Choose a condition") },
        ...available.map((option) => ({
          id: String(option["id"]),
          label: conditionName(option, view.locale, String(option["id"])),
        })),
      ],
      (id) => {
        if (!id || view.input.play.conditions?.some((value) => value.id === id)) return;
        view.input.play.conditions = [...(view.input.play.conditions ?? []), { id, level: 1 }];
        view.change();
        view.refresh();
      },
      t,
    );
    picker.querySelector("select")!.dataset["focusKey"] = "conditions/add";
    root.append(field(t("Add condition"), picker));
  }
  return root;
}
