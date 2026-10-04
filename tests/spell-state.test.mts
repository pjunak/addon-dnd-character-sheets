import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileCharacterMap } from "#web/character-client";
import { spellSourceLabel } from "#web/character-spells";
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
