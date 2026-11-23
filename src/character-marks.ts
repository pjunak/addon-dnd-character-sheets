import type {
  EffectCause,
  EffectChange,
  EffectTone,
  Explanation,
  Projection,
  Result,
} from "./character-model.js";
import { object, rows, text } from "./character-client.js";
import { translator } from "./character-locale.js";
import { signed, styled } from "./character-ui.js";

/**
 * A value that temporary play state (a condition, a feature switched on, a
 * timed DM grant) changes now, as the Engine measured it: its tone and what
 * each cause does. Views never derive a tone from conditions or roll marks.
 */
export interface ValueMark {
  tone: EffectTone;
  causes: EffectCause[];
}

/** The Engine's stable key of an attack row (`character.AttackKey`). */
export function attackKey(attack: Record<string, unknown>): string {
  if (text(attack["itemId"])) return "item:" + text(attack["itemId"]);
  if (text(attack["featureAttack"])) return "feature:" + text(attack["featureAttack"]);
  if (attack["unarmed"] === true) return "unarmed";
  return "ref:" + text(attack["ref"]);
}

/**
 * The Engine's mark path and row for an explanation path the sheet shows:
 * attack rows by their key and casters by class, never by position, and the
 * Concentration bonus as the Concentration save.
 */
export function markTarget(
  projection: Projection | undefined,
  path: string,
): { path: string; row?: string } {
  const weapon = /^weapons\.(\d+)\.(attackBonus|damage)$/u.exec(path);
  if (weapon) {
    const attack = rows(projection?.sheet["weapons"])[Number(weapon[1])];
    return attack ? { path: "weapons." + weapon[2], row: attackKey(attack) } : { path };
  }
  const caster = /^spellcasting\.perClass\.(\d+)\.(spellAttack|saveDC)$/u.exec(path);
  if (caster) {
    const row = rows(object(projection?.sheet["spellcasting"])["perClass"])[Number(caster[1])];
    return row
      ? { path: "spellcasting.perClass." + caster[2], row: text(row["classId"]) }
      : { path };
  }
  if (path === "concentrationSaveBonus") return { path: "concentration.saveBonus" };
  return { path };
}

/** The mark of a value by the Engine's path and row; none when nothing temporary changes it. */
export function valueMark(
  projection: Projection | undefined,
  path: string,
  row?: string,
): ValueMark | undefined {
  for (const effect of projection?.sheet.temporaryEffects ?? [])
    if (effect.path === path && (effect.row ?? "") === (row ?? ""))
      return { tone: effect.tone, causes: effect.causes };
  return undefined;
}

/** The mark of a value by the explanation path the sheet shows it with. */
export function displayedMark(
  projection: Projection | undefined,
  path: string,
): ValueMark | undefined {
  const target = markTarget(projection, path);
  return valueMark(projection, target.path, target.row);
}

/**
 * The saved projection with the live evaluation's marks. Marks are derived
 * by every evaluation and never saved, so a sheet without a calculated
 * evaluation (no compatible rules, print) shows none.
 */
export function withMarks(
  projection: Projection | undefined,
  evaluation: Pick<Result, "sheet"> | undefined,
): Projection | undefined {
  const marks = evaluation?.sheet.temporaryEffects;
  if (!projection || !marks?.length) return projection;
  return { ...projection, sheet: { ...projection.sheet, temporaryEffects: marks } };
}

/** A cause's name: a condition by its rules label and level, anything else as named. */
export function causeName(cause: EffectCause, locale: string): string {
  const t = translator(locale),
    name = cause.labelKey ? t(cause.labelKey) : cause.name;
  return cause.level ? t("{0} {1}", [name, cause.level]) : name;
}

/** What one change does: "+3", "-4 on the roll, not in the number", "Disadvantage". */
export function changeText(change: EffectChange, locale: string): string {
  const t = translator(locale);
  switch (change.kind) {
    case "add":
      return change.included === false
        ? t("{0} on the roll, not in the number", [signed(change.value ?? 0)])
        : signed(change.value ?? 0);
    case "set":
      return t("Set to {0}", [change.value ?? 0]);
    case "advantage":
      return t("Advantage");
    case "disadvantage":
      return t("Disadvantage");
    case "other":
      return t("Changed");
  }
}

/** One cause with what it does: "Poisoned: Disadvantage". */
export function causeText(cause: EffectCause, locale: string): string {
  return translator(locale)("{0}: {1}", [
    causeName(cause, locale),
    cause.changes.map((change) => changeText(change, locale)).join(", "),
  ]);
}

/** The sentence that names every cause, for the marker and screen readers. */
export function markSentence(mark: ValueMark, locale: string): string {
  return translator(locale)("Changed for now by {0}", [
    mark.causes.map((cause) => causeText(cause, locale)).join("; "),
  ]);
}

/** The value's explanation with one line per cause, so its popover lists them too. */
export function explainedMark(
  explanation: Explanation | undefined,
  mark: ValueMark,
  locale: string,
): Explanation | undefined {
  if (!explanation) return undefined;
  const t = translator(locale);
  return {
    ...explanation,
    terms: [
      ...explanation.terms,
      ...mark.causes.map((cause) => ({
        label: t("For now: {0}", [causeName(cause, locale)]),
        value: cause.changes.map((change) => changeText(change, locale)).join(", "),
      })),
    ],
  };
}

const markerShapes: Record<EffectTone, string> = {
  bonus: "M5 1 9.5 9H.5Z",
  penalty: "M5 9 .5 1h9Z",
  mixed: "M5 .5 9.5 5 5 9.5 .5 5Z",
};

/**
 * Shows a value's tone three ways, so it never rests on colour alone: the
 * tone's colour, a soft glow in it and a marker (up, down or a diamond)
 * that names the causes for hover and screen readers.
 */
export function marked(
  node: HTMLElement,
  mark: ValueMark | undefined,
  locale: string,
): HTMLElement {
  if (!mark) return node;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("aria-hidden", "true");
  shape.setAttribute("d", markerShapes[mark.tone]);
  svg.append(shape);
  const marker = styled("span", "dse-mark-marker", svg),
    sentence = markSentence(mark, locale);
  marker.setAttribute("role", "img");
  marker.setAttribute("aria-label", sentence);
  marker.title = sentence;
  const wrap = styled("span", "dse-mark", node, marker);
  wrap.dataset["tone"] = mark.tone;
  return wrap;
}
