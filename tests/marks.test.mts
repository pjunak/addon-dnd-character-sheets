import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attackKey,
  causeText,
  displayedMark,
  explainedMark,
  markSentence,
  markTarget,
  valueMark,
  withMarks,
} from "#web/character-marks";
import type { EffectCause, Projection, Sheet, TemporaryEffect } from "#web/character-model";

const poisoned: EffectCause = {
  kind: "condition",
  id: "poisoned",
  name: "Poisoned",
  tone: "penalty",
  changes: [{ kind: "disadvantage" }],
};
const exhaustion: EffectCause = {
  kind: "condition",
  id: "exhaustion",
  name: "Exhaustion",
  level: 2,
  tone: "penalty",
  changes: [{ kind: "add", value: -4, included: false }],
};
const sacredWeapon: EffectCause = {
  kind: "active-feature",
  id: "paladin:sacred-weapon",
  name: "Sacred Weapon",
  tone: "bonus",
  changes: [{ kind: "add", value: 3, included: true }],
};
const marks: TemporaryEffect[] = [
  { path: "skills.athletics.total", tone: "penalty", causes: [poisoned, exhaustion] },
  {
    path: "weapons.attackBonus",
    row: "item:sword",
    tone: "mixed",
    causes: [poisoned, sacredWeapon],
  },
  { path: "weapons.attackBonus", row: "unarmed", tone: "penalty", causes: [poisoned] },
  { path: "spellcasting.perClass.saveDC", row: "paladin", tone: "bonus", causes: [sacredWeapon] },
  { path: "concentration.saveBonus", tone: "penalty", causes: [exhaustion] },
];
const projection = (temporaryEffects?: TemporaryEffect[]): Projection => ({
  sheet: {
    status: "calculated",
    weapons: [
      { unarmed: true, name: "Unarmed Strike" },
      { itemId: "sword", name: "Longsword" },
    ],
    spellcasting: { perClass: [{ classId: "paladin" }] },
    ...(temporaryEffects ? { temporaryEffects } : {}),
  } as unknown as Sheet,
  explanations: {},
  evidence: [],
  issues: [],
});

test("a value's mark is found by the Engine's path and row", () => {
  const sheet = projection(marks);
  assert.equal(valueMark(sheet, "skills.athletics.total")?.tone, "penalty");
  assert.deepEqual(valueMark(sheet, "weapons.attackBonus", "item:sword")?.causes, [
    poisoned,
    sacredWeapon,
  ]);
  assert.equal(valueMark(sheet, "weapons.attackBonus", "unarmed")?.tone, "penalty");
  assert.equal(valueMark(sheet, "weapons.attackBonus"), undefined, "a row value needs its row");
  assert.equal(valueMark(sheet, "skills.stealth.total"), undefined);
  assert.equal(valueMark(sheet, "no.such.path"), undefined, "an unknown path is ignored");
  assert.equal(valueMark(projection(), "skills.athletics.total"), undefined, "no marks, no tone");
  assert.equal(valueMark(undefined, "skills.athletics.total"), undefined);
});

test("displayed rows are named by key, never by position", () => {
  const sheet = projection(marks);
  assert.deepEqual(markTarget(sheet, "weapons.1.attackBonus"), {
    path: "weapons.attackBonus",
    row: "item:sword",
  });
  assert.equal(displayedMark(sheet, "weapons.0.attackBonus")?.tone, "penalty");
  assert.equal(displayedMark(sheet, "weapons.1.attackBonus")?.tone, "mixed");
  assert.equal(displayedMark(sheet, "weapons.7.attackBonus"), undefined);
  assert.equal(displayedMark(sheet, "spellcasting.perClass.0.saveDC")?.tone, "bonus");
  assert.equal(displayedMark(sheet, "concentrationSaveBonus")?.tone, "penalty");
  assert.equal(attackKey({ featureAttack: "psychic-blade" }), "feature:psychic-blade");
});

test("marks come from the evaluation, never from the saved projection", () => {
  const saved = projection();
  assert.equal(withMarks(saved, undefined), saved);
  assert.equal(withMarks(saved, { sheet: { status: "calculated" } as Sheet }), saved);
  const live = withMarks(saved, {
    sheet: { status: "calculated", temporaryEffects: marks } as Sheet,
  });
  assert.equal(valueMark(live, "skills.athletics.total")?.tone, "penalty");
  assert.equal(saved.sheet.temporaryEffects, undefined, "the saved projection is not changed");
});

test("causes say what they do", () => {
  assert.equal(causeText(poisoned, "en"), "Poisoned: Disadvantage");
  assert.equal(causeText(exhaustion, "en"), "Exhaustion 2: -4 on the roll, not in the number");
  assert.equal(causeText(sacredWeapon, "en"), "Sacred Weapon: +3");
  assert.equal(
    causeText({ ...poisoned, changes: [{ kind: "set", value: 0, included: true }] }, "en"),
    "Poisoned: Set to 0",
  );
  assert.equal(
    markSentence({ tone: "mixed", causes: [poisoned, sacredWeapon] }, "en"),
    "Changed for now by Poisoned: Disadvantage; Sacred Weapon: +3",
  );
  const explanation = explainedMark(
    {
      label: "Athletics",
      formula: "",
      value: 5,
      terms: [{ label: "Proficiency", value: 2 }],
      sources: [],
    },
    { tone: "penalty", causes: [poisoned, exhaustion] },
    "en",
  );
  assert.deepEqual(explanation?.terms.slice(1), [
    { label: "For now: Poisoned", value: "Disadvantage" },
    { label: "For now: Exhaustion 2", value: "-4 on the roll, not in the number" },
  ]);
});
