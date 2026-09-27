import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { blank, parseCharacter, exportCharacter, mergeCharacter } from "#web/character-client";
import type { Choice, Item } from "#web/character-model";
import { array, record, required, storage as storageFixture } from "./support/helpers.mts";

void test("provider option labels translate only explicit UI keys", async () => {
  const { guidanceOptions } = await import("#web/character-build");
  assert.deepEqual(
    guidanceOptions(
      [
        { id: "Small", label: "Small", labelKey: "Small" },
        { id: "record", label: "Small" },
      ],
      "cs",
    ).map((option) => option.label),
    ["Malá", "Small"],
  );
});

void test("current transfer accepts only the explicit current envelope and preserves authored inputs", () => {
  const inputs = blank();
  inputs.notes = "Mira — a new beginning";
  inputs.play.inspiration = false;
  inputs.play.rolls = [
    { id: "roll-one", resource: "hit-dice-d10", die: 10, result: 6, at: "2026-09-11T00:00:00Z" },
  ];
  inputs.play.inventory = [
    {
      id: "spent",
      name: "Supplies",
      quantity: 0,
      location: "carried",
      attuned: false,
      acquisition: "Reward",
      notes: "Keep me",
    },
  ];
  inputs.play.quickUse = ["spent"];
  inputs.play.containers = [{ id: "pack", name: "Bag" }];
  required(inputs.play.inventory[0]).containerId = "pack";
  const state = {
    schemaVersion: "4.0.0",
    inputs,
    rules: {
      engineId: "rules",
      engineVersion: "4.0.0",
      engineGeneration: "generation",
      identity: {},
    },
    projection: { sheet: {}, explanations: {}, evidence: [], issues: [] },
    operationId: "first",
  };
  assert.deepEqual(parseCharacter(exportCharacter(state)), inputs);
  for (const value of [
    inputs,
    { v: 3 },
    { format: "dnd-character.v1", schemaVersion: "3.0.0", inputs },
    { format: "dnd-character.v1", schemaVersion: "4.0.0", inputs, admin: true },
  ])
    assert.throws(() => parseCharacter(JSON.stringify(value)));
  assert.throws(() => parseCharacter(" ".repeat(190001)));
});

void test("manifest declares worker authority without retained history", async () => {
  const manifest: unknown = JSON.parse(
    await readFile(new URL("../addon.json", import.meta.url), "utf8"),
  );
  const manifestObject = record(manifest);
  const extension = record(required(array(manifestObject["recordExtensions"])[0]));
  assert.equal(extension["id"], "dnd-sheets");
  assert.equal(extension["retained"], undefined);
  assert.equal(extension["workerOnly"], true);
  assert.equal(extension["schemaVersion"], "4.0.0");
  const services = record(manifestObject["services"]);
  const consumes = array(services["consumes"]).map(record);
  assert.equal(
    required(consumes.find((service) => service["contract"] === "dnd5e.rules-engine"))["range"],
    "^4.0.0",
  );
  const capabilities = record(manifestObject["capabilities"]);
  const requiredCapabilities = array(capabilities["required"]);
  assert.ok(!requiredCapabilities.includes("data.history"));
  assert.ok(requiredCapabilities.includes("ui.rule-details"));
  const service: unknown = JSON.parse(
    await readFile(new URL("../contracts/character.service.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(record(record(service)["methods"])).sort(), [
    "commit",
    "evaluate",
    "load",
    "preview",
    "save",
  ]);
});

void test("restored layouts read the former character preference without rewriting it", async () => {
  const { preferredLayout } = await import("#web/character-sheet");
  const entries = new Map([["dse-ui:renderer:hero", "builtin:classic"]]);
  const storage = storageFixture((key) => entries.get(key) ?? null);
  assert.equal(preferredLayout(storage, "dm", "hero"), "classic");
  assert.equal(preferredLayout(storage, "dm", "other"), "compact");
  entries.set("dnd-character-layout:dm:hero", "compact");
  assert.equal(preferredLayout(storage, "dm", "hero"), "compact");
  assert.equal(preferredLayout(storage, "player", "hero"), "classic");
  assert.equal(entries.get("dse-ui:renderer:hero"), "builtin:classic");
  assert.equal(
    preferredLayout(
      storageFixture(() => {
        throw new Error("Storage unavailable");
      }),
      "dm",
      "hero",
    ),
    "compact",
  );
});

void test("autosave rebases disjoint fields and rejects overlapping changes", () => {
  const base = blank(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.notes = "Local notes";
  remote.play.hp = 5;
  const merged = mergeCharacter(base, local, remote);
  assert.equal(required(merged).notes, "Local notes");
  assert.equal(required(merged).play.hp, 5);
  remote.notes = "Remote notes";
  assert.equal(mergeCharacter(base, local, remote), undefined);
  const same = mergeCharacter(base, local, local);
  assert.deepEqual(same, local);
  const inventoryItem = (id: string): Item => ({
    id,
    name: id,
    quantity: 1,
    location: "carried",
    attuned: false,
    acquisition: "Test",
    notes: "",
  });
  local.play.inventory = [inventoryItem("local")];
  remote.notes = base.notes;
  remote.play.inventory = [inventoryItem("remote")];
  assert.equal(mergeCharacter(base, local, remote), undefined);
});

void test("quick-use order merges only disjoint edits and never merges competing pin lists", () => {
  const base = blank(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.play.quickUse = ["one"];
  remote.play.currency.gp = 5;
  assert.deepEqual(required(mergeCharacter(base, local, remote)).play, {
    ...remote.play,
    quickUse: ["one"],
  });
  remote.play.quickUse = ["two"];
  assert.equal(mergeCharacter(base, local, remote), undefined);
  remote.play.quickUse = ["one"];
  assert.deepEqual(required(mergeCharacter(base, local, remote)).play.quickUse, ["one"]);
  const pinned = structuredClone(local),
    removed = structuredClone(pinned),
    other = structuredClone(pinned);
  delete removed.play.quickUse;
  other.notes = "Keep this";
  assert.equal(
    Object.hasOwn(required(mergeCharacter(pinned, removed, other)).play, "quickUse"),
    false,
  );
});

void test("Inspiration merges disjoint edits and preserves explicit false versus absent state", () => {
  const base = blank(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.play.inspiration = true;
  remote.play.hp = 5;
  assert.deepEqual(required(mergeCharacter(base, local, remote)).play, {
    ...remote.play,
    inspiration: true,
  });
  remote.play.inspiration = false;
  assert.equal(mergeCharacter(base, local, remote), undefined);
  remote.play.inspiration = true;
  assert.equal(required(mergeCharacter(base, local, remote)).play.inspiration, true);
  const authored = structuredClone(local),
    spent = structuredClone(authored),
    other = structuredClone(authored);
  spent.play.inspiration = false;
  other.notes = "Keep this";
  assert.equal(required(mergeCharacter(authored, spent, other)).play.inspiration, false);
});

void test("condition edits rebase independent notes and never merge competing condition lists", () => {
  const base = blank(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.play.conditions = [{ id: "fatigue", level: 2 }];
  remote.notes = "Other editor";
  const merged = mergeCharacter(base, local, remote);
  assert.deepEqual(required(merged).play.conditions, local.play.conditions);
  assert.equal(required(merged).notes, remote.notes);
  remote.play.conditions = [{ id: "held", level: 1 }];
  assert.equal(mergeCharacter(base, local, remote), undefined);
  remote.play.conditions = structuredClone(local.play.conditions);
  assert.deepEqual(
    required(mergeCharacter(base, local, remote)).play.conditions,
    local.play.conditions,
  );
  const removed = structuredClone(local),
    changed = structuredClone(local);
  removed.play.conditions = [];
  required(changed.play.conditions)[0]!.level = 3;
  assert.equal(mergeCharacter(local, removed, changed), undefined);
});

void test("accepted choice withdrawals preserve newer edits without restoring retired selections", async () => {
  const { reconcileCharacterChoices } = await import("#web/character-client");
  const old = { id: "old-origin", slot: 0, value: "former-choice" },
    newer = { id: "new-origin", slot: 0, value: "new-choice" };
  const sent: Choice[] = [old],
    current = [old, newer],
    saved: Choice[] = [];
  const before = structuredClone({ sent, current, saved });
  const result = reconcileCharacterChoices(sent, current, saved);
  assert.deepEqual(result, [newer]);
  required(result[0]).value = "Detached";
  assert.deepEqual({ sent, current, saved }, before);
  assert.deepEqual(
    reconcileCharacterChoices(sent, [{ ...old, value: "deliberate-replacement" }], saved),
    [{ ...old, value: "deliberate-replacement" }],
  );
  assert.deepEqual(
    reconcileCharacterChoices(sent, [], sent),
    [],
    "a later user removal must remain removed",
  );
});
