import {
  markSpellRow,
  slotLabel,
  spellFacts,
  spellFilters,
  spellSourceLabel,
  type PlayFilterState,
} from "./character-spells.js";
import type { Inputs, Result } from "./character-model.js";
import { translator } from "./character-locale.js";
import {
  newId,
  object,
  rows,
  strings,
  text,
  type CatalogRecord,
  catalogRecord,
} from "./character-client.js";
import {
  button,
  field,
  human,
  label,
  numberInput,
  panel,
  rule,
  select,
  styled,
} from "./character-ui.js";
import { rulesTarget } from "./character-rule-notes.js";

// Options and costs are engine results. This view only gathers command inputs.
export function playActions(
  input: Inputs,
  evaluation: Result,
  catalog: CatalogRecord[],
  act: (change: Record<string, unknown>) => Promise<void>,
  locale = "en",
  section: "spells" | "recovery" = "spells",
  filterState: PlayFilterState = { query: "", level: "", kind: "" },
): HTMLElement {
  const t = translator(locale);
  const root = rulesTarget(
      panel(t(section === "recovery" ? "Hit dice" : "Spellcasting")),
      section === "recovery" ? "resources" : "spells",
    ),
    names = new Map(catalog.map((record) => [record.id, text(record.value["name"], record.id)]));
  const spellName = (id: string): string => names.get(id) ?? id;
  const resources = rows(evaluation.sheet["resources"]);
  const slotName = (key: string): string => {
    const resource = resources.find((row) => row["key"] === key);
    if (!resource) return key;
    return resource["kind"] === "slot"
      ? slotLabel(resource, resource["remaining"], resource["max"], locale)
      : t("{0} · {1}/{2}", [resource["name"], resource["remaining"], resource["max"]]);
  };
  // Spells sort by level under a heading that shows the level's remaining slots.
  const byLevel = (group: HTMLElement, spellRows: HTMLElement[]): void => {
    let current: string | undefined;
    for (const row of spellRows.sort(
      (left, right) =>
        Number(left.dataset["spellLevel"] || 0) - Number(right.dataset["spellLevel"] || 0) ||
        left.dataset["spellName"]!.localeCompare(right.dataset["spellName"]!),
    )) {
      const level = row.dataset["spellLevel"] || "0";
      if (level !== current) {
        current = level;
        const slot = resources.find(
          (resource) => resource["kind"] === "slot" && String(resource["level"]) === level,
        );
        const heading = styled(
          "h4",
          "dnd-spell-level",
          level === "0"
            ? t("Cantrips")
            : slot
              ? t("Level {0} · {1} / {2}", [level, slot["remaining"], slot["max"]])
              : t("Level {0}", [level]),
        );
        heading.dataset["spellLevelHeading"] = level;
        group.append(heading);
      }
      group.append(row);
    }
  };
  // An empty slot key means the spell costs nothing (a cantrip, or an at-will
  // grant beside the slots that upcast it). Alone there is nothing to pick;
  // otherwise the first entry is preselected.
  const slotPicker = (
    name: string,
    slots: readonly string[],
    change: (value: string) => void,
  ): HTMLElement[] => {
    const resources = slots.filter(Boolean);
    return resources.length
      ? [
          field(
            name,
            select(
              slots[0] ?? "",
              [
                ...(slots.includes("") ? [{ id: "", label: t("At will") }] : []),
                ...resources.map((id) => ({ id, label: slotName(id) })),
              ],
              change,
              t,
              { required: true },
            ),
          ),
        ]
      : [];
  };
  if (section === "recovery")
    for (const resource of rows(evaluation.sheet["resources"]).filter(
      (row) => row["kind"] === "hitdice",
    )) {
      const key = String(resource["key"]);
      let result: number | undefined;
      root.append(
        field(
          t("{0} — recorded die result", [human(resource["name"])]),
          numberInput(
            undefined,
            (value) => {
              result = value;
            },
            1,
          ),
        ),
        button(t("Spend recorded hit die"), async () => {
          if (result !== undefined)
            await act({ operation: "spend-hit-die", key, result, rollId: newId() });
        }),
      );
    }
  if (section === "recovery") return root;
  const filters = spellFilters("play-spells", locale, () => filter(), filterState);
  // Casting-time and concentration chips narrow the list beside the name and level filters.
  const chips = styled("div", "dnd-filter-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", t("Filter spells"));
  for (const [kind, name] of [
    ["", "All"],
    ["A", "Action"],
    ["BA", "Bonus action"],
    ["concentration", "Concentration"],
  ] as const) {
    const chip = button(
      t(name),
      () => {
        filterState.kind = kind;
        for (const other of chips.children)
          other.setAttribute("aria-pressed", String(other === chip));
        filter();
      },
      false,
      "play-spells/kind/" + (kind || "all"),
    );
    chip.setAttribute("aria-pressed", String(filterState.kind === kind));
    chips.append(chip);
  }
  const kindMatches = (row: HTMLElement): boolean =>
    !filterState.kind ||
    (filterState.kind === "concentration"
      ? row.dataset["spellConcentration"] !== undefined
      : row.dataset["spellTime"] === filterState.kind);
  const filter = (): void => {
    let shown = 0;
    for (const row of root.querySelectorAll<HTMLElement>("[data-spell-name]")) {
      row.hidden =
        !filters.matches(row.dataset["spellName"]!, row.dataset["spellLevel"]) || !kindMatches(row);
      if (!row.hidden) shown++;
    }
    for (const heading of root.querySelectorAll<HTMLElement>("[data-spell-level-heading]"))
      heading.hidden = ![...(heading.parentElement?.children ?? [])].some(
        (row) =>
          row instanceof HTMLElement &&
          !row.hidden &&
          row.dataset["spellName"] !== undefined &&
          (row.dataset["spellLevel"] || "0") === heading.dataset["spellLevelHeading"],
      );
    filters.report(shown);
  };
  root.append(chips, filters.controls);
  // The spell being concentrated on carries an "active" pill after its name.
  const concentrating = text(object(evaluation.sheet["concentration"])["ref"]);
  const spellRow = (ref: string): HTMLElement => {
    const name = rule(spellName(ref), { kind: "spell", id: ref });
    return markSpellRow(
      styled(
        "div",
        "dnd-spell-row",
        ref === concentrating
          ? styled("span", "dnd-spell-name", name, styled("span", "dnd-spell-active", t("active")))
          : name,
        spellFacts(catalog, ref, locale),
      ),
      ref,
      catalog,
    );
  };
  for (const caster of rows(evaluation.spellOptions["classes"])) {
    const classId = String(caster["classId"]),
      group = panel(t("{0} spells", [label(classId)])),
      spellRows: HTMLElement[] = [];
    for (const [ref, rawSlots] of Object.entries(object(caster["castSlots"]))) {
      const slots = strings(rawSlots);
      let slot = slots[0] ?? "";
      const row = spellRow(ref);
      row.append(
        ...slotPicker(t("Spend slot"), slots, (value) => {
          slot = value;
        }),
      );
      row.append(button(t("Cast"), () => act({ operation: "cast-spell", classId, ref, slot })));
      spellRows.push(row);
    }
    for (const ref of strings(caster["ritualIds"])) {
      const row = spellRow(ref);
      row.append(
        button(t("Cast as ritual"), () => act({ operation: "cast-ritual", classId, ref })),
      );
      spellRows.push(row);
    }
    byLevel(group, spellRows);
    const costs = object(caster["copyCosts"]),
      copyOptions = Object.keys(costs).filter(
        (id) => !input.build.spells.spellbook[classId]?.includes(id),
      );
    if (copyOptions.length) {
      let ref = "",
        scrollId = "";
      group.append(
        field(
          t("Spell to copy"),
          select(
            "",
            copyOptions.map((id) => ({
              id,
              label: t("{0} · {1} GP", [spellName(id), human(costs[id])]),
            })),
            (value) => {
              ref = value;
            },
            t,
          ),
        ),
        field(
          t("Owned scroll (optional)"),
          select(
            "",
            input.play.inventory
              .filter((item) => item.spellId && item.quantity > 0)
              .map((item) => ({ id: item.id, label: item.name })),
            (value) => {
              scrollId = value;
            },
            t,
          ),
        ),
        button(t("Copy spell"), async () => {
          if (ref)
            await act({ operation: "copy-spell", classId, ref, scrollId, acquisitionId: newId() });
        }),
      );
    }
    if (caster["canSwap"] === true && input.play.preparedSpells[classId]?.length) {
      let out = "",
        ref = "";
      group.append(
        field(
          t("Replace known spell"),
          select(
            "",
            input.play.preparedSpells[classId]!.map((id) => ({ id, label: spellName(id) })),
            (value) => {
              out = value;
            },
            t,
          ),
        ),
        field(
          t("Replacement spell"),
          select(
            "",
            strings(caster["spellIds"])
              .filter((id) => Number(catalogRecord(catalog, id)?.value["level"]) > 0)
              .map((id) => ({ id, label: spellName(id) })),
            (value) => {
              ref = value;
            },
            t,
          ),
        ),
        button(t("Replace spell"), async () => {
          if (out && ref) await act({ operation: "swap-spell", classId, out, ref });
        }),
      );
    }
    root.append(group);
  }
  const granted = panel(t("Granted spells")),
    grantedRows: HTMLElement[] = [];
  for (const grant of rows(evaluation.spellOptions["granted"])) {
    const ref = String(grant["ref"]),
      key = String(grant["key"]),
      slots = strings(grant["slots"]);
    let slot = slots[0] ?? "";
    const row = spellRow(ref);
    row.dataset["spellGrant"] = key;
    row.append(
      styled(
        "span",
        "dnd-spell-source",
        [
          spellSourceLabel(grant["source"], locale, evaluation.evidence),
          grant["castingAbility"] ? human(grant["castingAbility"]) : "",
          grant["atWill"] === true ? t("At will") : "",
          grant["ritualOnly"] === true ? t("Ritual only") : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    row.append(
      ...slotPicker(t("Granted cast resource"), slots, (value) => {
        slot = value;
      }),
    );
    row.append(
      button(t(grant["ritualOnly"] === true ? "Cast as ritual" : "Cast"), () =>
        act({ operation: "cast-granted-spell", key, slot }),
      ),
    );
    grantedRows.push(row);
  }
  if (grantedRows.length) {
    byLevel(granted, grantedRows);
    root.append(granted);
  }
  filter();
  return root;
}
