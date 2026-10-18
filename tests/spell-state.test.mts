import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileCharacterMap } from "#web/character-client";
import { spellbookHeading, spellSourceLabel } from "#web/character-spells";
void test("accepted spell withdrawals preserve later selections and edits", () => {
  const sent = { first: ["a", "b"], second: ["c"] },
    current = { first: ["a", "b"], second: ["later"] };
  reconcileCharacterMap(sent, current, { first: ["a"], second: ["c"] });
  assert.deepEqual(current, { first: ["a"], second: ["later"] });
  const withdrawn = { removed: 1, kept: 2 };
  reconcileCharacterMap({ removed: 1, kept: 1 }, withdrawn, { kept: 1 });
  assert.deepEqual(withdrawn, { kept: 2 });
  const edited = { removed: 0 };
  reconcileCharacterMap({ removed: 1 }, edited, {});
  assert.deepEqual(edited, { removed: 0 });
});
void test("grant labels identify acquisitions and translate only UI terms", () => {
  const source = {
    id: "test",
    name: "Recorded Spell",
    acquisition: { id: "asi:one", classId: "fighter", level: 6 },
  };
  assert.equal(spellSourceLabel(source, "en"), "Recorded Spell · Fighter · Level 6");
  assert.equal(spellSourceLabel(source, "cs"), "Recorded Spell · Fighter · Úroveň 6");
});
void test("grant labels name an unnamed source from its evidence record", () => {
  const source = { type: "feature", id: "invocation-armor-of-shadows" };
  const evidence = [
    {
      reference: { kind: "feature", id: "invocation-armor-of-shadows" },
      name: "Armor of Shadows",
      hash: "h",
      summary: "",
      facts: {},
    },
  ];
  assert.equal(spellSourceLabel(source, "en", evidence), "Armor of Shadows");
  assert.equal(spellSourceLabel(source, "en"), "Invocation armor of shadows");
});
void test("spellbook headings separate level-granted spells from each bonus source", () => {
  const savant = { type: "feature", id: "evoker-evocation-savant" };
  const evidence = [
    {
      reference: { kind: "feature", id: "evoker-evocation-savant" },
      name: "Evocation Savant",
      hash: "h",
      summary: "",
      facts: {},
    },
  ];
  const caster = {
    spellbookKnown: 12,
    spellbookBonus: 2,
    spellbookBonusSources: [{ source: savant, count: 2, school: "Evocation" }],
  };
  assert.equal(
    spellbookHeading("Wizard", caster, "en", evidence),
    "Wizard spellbook · 10 gained from levels · 2 Evocation spells gained from Evocation Savant",
  );
  assert.equal(
    spellbookHeading("Čaroděj", caster, "cs", evidence),
    "Čaroděj: kniha kouzel · 10 získáno za úrovně · 2 ze školy Evocation získáno za Evocation Savant",
  );
  assert.equal(
    spellbookHeading(
      "Wizard",
      { ...caster, spellbookBonusSources: [{ source: savant, count: 2 }] },
      "en",
      evidence,
    ),
    "Wizard spellbook · 10 gained from levels · 2 gained from Evocation Savant",
  );
  assert.equal(
    spellbookHeading("Wizard", { spellbookKnown: 12, spellbookBonus: 2 }),
    "Wizard spellbook · 10 gained from levels · 2 gained from class features",
  );
  assert.equal(
    spellbookHeading("Wizard", { spellbookKnown: 8 }),
    "Wizard spellbook · 8 gained from levels",
  );
});
