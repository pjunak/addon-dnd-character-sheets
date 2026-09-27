import assert from "node:assert/strict";
import { test } from "node:test";
import { proficiencyGroups } from "#web/character-proficiencies";
import type { Projection } from "#web/character-model";
import { required } from "./support/helpers.mts";

const projection = (training: unknown): Projection => ({
  sheet: { proficiencies: training },
  explanations: {},
  evidence: [],
  issues: [],
});
const group = (value: Projection, id: string, locale = "en") =>
  required(proficiencyGroups(value, locale).find((row) => row.id === id));
const firstEntry = (value: Projection, id: string, locale = "en") =>
  required(group(value, id, locale).entries[0]);

void test("saved training shows only confirmed saves and skills and separates Expertise", () => {
  const saved = projection({
    saves: { STR: true, DEX: false, INT: "false", WIS: 1 },
    skills: {
      athletics: "proficient",
      perception: "expertise",
      stealth: "none",
      arcana: false,
      history: "future-mode",
    },
    armor: ["light", "medium", "shield"],
    weapons: ["simple", "martial (finesse)"],
    tools: [],
    languages: ["common"],
  });
  assert.deepEqual(
    group(saved, "saves").entries.map((row) => row.name),
    ["Strength"],
  );
  assert.deepEqual(
    group(saved, "skills").entries.map((row) => row.name),
    ["Athletics"],
  );
  assert.deepEqual(
    group(saved, "expertise").entries.map((row) => row.name),
    ["Perception"],
  );
  assert.deepEqual(
    group(saved, "armor").entries.map((row) => row.name),
    ["Light armor", "Medium armor", "Shields"],
  );
  assert.deepEqual(
    group(saved, "weapons").entries.map((row) => row.name),
    ["Simple weapons", "Martial weapons (finesse)"],
  );
  assert.equal(firstEntry(saved, "saves").path, "saves.STR.total");
  assert.equal(firstEntry(saved, "expertise").path, "skills.perception.total");
});

void test("training labels use exact saved evidence and preserve authored names without a catalog", () => {
  const saved = projection({
    tools: ["shared", "missing-tool", "shared", 5, null, ""],
    weapons: ["shared"],
  });
  saved.evidence = [
    {
      reference: { kind: "feat", id: "shared" },
      name: "Wrong kind",
      hash: "feat-hash",
      summary: "Wrong evidence kind",
      facts: {},
    },
    {
      reference: { kind: "tool", id: "shared" },
      name: "Perception <b>literal</b>",
      hash: "tool-hash",
      summary: "Saved tool name",
      facts: {},
    },
    {
      reference: { kind: "weapon", id: "shared" },
      name: "Different weapon",
      hash: "weapon-hash",
      summary: "Saved weapon name",
      facts: {},
    },
  ];
  const before = structuredClone(saved),
    tools = group(saved, "tools", "cs");
  assert.deepEqual(
    tools.entries.map((row) => row.name),
    ["Perception <b>literal</b>", "Missing tool"],
  );
  assert.equal(firstEntry(saved, "weapons").name, "Different weapon");
  required(required(tools.entries[0]).reference).kind = "changed";
  assert.deepEqual(saved, before, "Presentation data cannot mutate saved evidence");
});

void test("missing training remains distinguishable from an explicitly empty group", () => {
  assert.ok(proficiencyGroups(undefined, "en").every((row) => !row.available));
  const saved = projection({ armor: [], saves: {}, skills: {}, tools: null });
  assert.equal(group(saved, "armor").available, true);
  assert.deepEqual(group(saved, "armor").entries, []);
  assert.equal(group(saved, "saves").available, true);
  assert.equal(group(saved, "tools").available, false);
  assert.equal(group(saved, "weapons").available, false);
  saved.sheet["languages"] = ["saved-language"];
  assert.deepEqual(
    group(saved, "languages").entries.map((row) => row.name),
    ["Saved language"],
  );
});

void test("both locales label training categories without translating saved source names", () => {
  const saved = projection({
    saves: { DEX: true },
    skills: { animalHandling: "proficient", sleightOfHand: "expertise" },
    armor: ["medium"],
    weapons: ["martial"],
  });
  assert.equal(group(saved, "saves", "cs").name, "Záchranné hody");
  assert.equal(firstEntry(saved, "saves", "cs").name, "Obratnost");
  assert.equal(firstEntry(saved, "skills", "cs").name, "Zacházení se zvířaty");
  assert.equal(firstEntry(saved, "expertise", "cs").name, "Čachry");
  assert.equal(firstEntry(saved, "armor", "cs").name, "Střední zbroje");
  assert.equal(firstEntry(saved, "weapons", "cs").name, "Válečné zbraně");
});
