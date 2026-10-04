import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendEquipment,
  attuneEquipment,
  attunementChoice,
  equipmentReason,
  equipmentSlot,
  moveEquipment,
  pinQuickUse,
  removeInventoryItem,
  quickUseReason,
  stowAndUnattune,
} from "#web/character-inventory";

import { blank } from "#web/character-client";
import type { Item, Projection } from "#web/character-model";
import { required } from "./support/helpers.mts";

const item = (id: string, location = "carried"): Item => ({
  id,
  name: id,
  location,
  quantity: 1,
  attuned: false,
  acquisition: "Keep provenance",
  notes: "Keep notes",
});

void test("explicit stack addition preserves authored identity and never merges another copy by name", () => {
  const input = blank(),
    original = { ...item("stack"), grantId: "reward", containerId: "pouch", quantity: 2 };
  input.play.inventory = [
    structuredClone(original),
    { ...item("equipped", "equipped"), name: original.name },
  ];
  assert.equal(
    appendEquipment(
      input,
      [
        { ...item("stack"), containerId: "pouch", quantity: 3, notes: "Catalog defaults" },
        { ...item("copy"), name: original.name },
      ],
      ["stack"],
    ),
    true,
  );
  assert.deepEqual(input.play.inventory[0], { ...original, quantity: 5 });
  assert.equal(required(input.play.inventory[1]).quantity, 1);
  assert.equal(required(input.play.inventory[1]).location, "equipped");
  assert.equal(required(input.play.inventory[2]).id, "copy");
});

void test("a removed or moved selected stack cannot be resurrected or partly applied", () => {
  const input = blank(),
    additions = [item("new"), item("stack")];
  for (const inventory of [
    [],
    [item("stack", "equipped")],
    [{ ...item("stack"), containerId: "elsewhere" }],
  ]) {
    input.play.inventory = structuredClone(inventory);
    assert.equal(appendEquipment(input, additions, ["stack"]), false);
    assert.deepEqual(input.play.inventory, inventory);
  }
});

void test("quick use pins exact instances without copying or resetting inventory", () => {
  const input = blank();
  input.play.inventory = [
    item("one"),
    { ...item("two"), name: "one", quantity: 0, location: "stored", grantId: "reward" },
  ];
  const before = structuredClone(input.play.inventory);
  assert.equal(pinQuickUse(input, "missing", true), false);
  assert.equal(pinQuickUse(input, "two", true), true);
  assert.equal(pinQuickUse(input, "one", true), true);
  assert.equal(pinQuickUse(input, "two", true), false);
  assert.deepEqual(input.play.quickUse, ["two", "one"]);
  assert.deepEqual(input.play.inventory, before);
  removeInventoryItem(input, "one");
  assert.deepEqual(input.play.quickUse, ["two"]);
  assert.deepEqual(input.play.inventory, [before[1]]);
  assert.equal(pinQuickUse(input, "two", false), true);
  assert.equal(Object.hasOwn(input.play, "quickUse"), false);
  assert.deepEqual(input.play.inventory, [before[1]], "Unpinning never removes an item");
  for (const reason of ["empty", "stored", "missing", "build"]) {
    assert.ok(quickUseReason(reason, "en"));
    assert.notEqual(quickUseReason(reason, "cs"), quickUseReason(reason, "en"));
  }
});

void test("both inventory entry points can replace only the occupied exclusive slot", () => {
  for (const slot of ["armor", "shield"]) {
    const inventory = [
      item("old", "equipped"),
      item("new", "stored"),
      item("spare", "stored"),
      item("carried"),
      item("other", "equipped"),
    ];
    required(inventory[0]).attuned = true;
    const guidance = Object.fromEntries(
      inventory.map((row) => [
        row.id,
        { slot: row.id === "other" ? "worn" : slot, canEquip: true },
      ]),
    );
    const before = structuredClone(inventory);
    assert.equal(moveEquipment(inventory, "new", "equipped", guidance), true);
    assert.deepEqual(
      inventory,
      before.map((row) => ({
        ...row,
        location: row.id === "old" ? "carried" : row.id === "new" ? "equipped" : row.location,
      })),
    );
    assert.equal(moveEquipment(inventory, "new", "stored", guidance), true);
    assert.equal(
      required(inventory[0]).attuned,
      true,
      "Unequipping does not silently end attunement",
    );
    assert.equal(required(inventory[2]).location, "stored");
  }
});

void test("worn items coexist and denied actions preserve every authored field", () => {
  const inventory = [item("one", "equipped"), item("two")],
    before = structuredClone(inventory);
  assert.equal(moveEquipment(inventory, "two", "equipped", {}), false);
  assert.equal(moveEquipment(inventory, "two", "missing", {}), false);
  assert.equal(attuneEquipment(required(inventory[1]), true, {}), false);
  assert.deepEqual(inventory, before);
  assert.equal(
    moveEquipment(inventory, "two", "equipped", { two: { slot: "worn", canEquip: true } }),
    true,
  );
  assert.equal(required(inventory[0]).location, "equipped");
  required(inventory[0]).attuned = true;
  assert.equal(
    attuneEquipment(required(inventory[0]), false, {}),
    true,
    "Repair remains possible after eligibility disappears",
  );
});

void test("saved slots and source evidence render without a provider or catalog ID heuristics", () => {
  const shield = { ...item("guard", "equipped"), reference: { kind: "armor", id: "round-guard" } };
  const projection: Projection = {
    sheet: { equipment: { guard: { slot: "shield" } } },
    explanations: {},
    evidence: [],
    issues: [],
  };
  assert.equal(equipmentSlot(shield, {}, projection), "shield");
  assert.equal(equipmentSlot(shield, { guard: { slot: "armor" } }, projection), "armor");
  const withoutSlots: Projection = {
    sheet: {},
    explanations: {},
    evidence: [
      {
        reference: shield.reference,
        name: "Round guard",
        hash: "guard-hash",
        summary: "Saved armor evidence",
        facts: { armorType: "shield" },
      },
    ],
    issues: [],
  };
  assert.equal(equipmentSlot(shield, {}, withoutSlots), "shield");
  required(withoutSlots.evidence[0]).facts["armorType"] = "heavy";
  assert.equal(equipmentSlot(shield, {}, withoutSlots), "armor");
  assert.equal(
    equipmentSlot({ ...shield, reference: { kind: "armor", id: "shield" } }, {}),
    "worn",
    "IDs are not mechanics",
  );
});

void test("new attunements require equipped positive quantities and engine eligibility", () => {
  for (const location of ["carried", "stored", "equipped"]) {
    const candidate = item("candidate", location),
      before = structuredClone(candidate);
    const guidance = { candidate: { canAttune: true } };
    assert.equal(attunementChoice(candidate, guidance).allowed, location === "equipped");
    assert.equal(attuneEquipment(candidate, true, guidance), location === "equipped");
    assert.deepEqual(candidate, { ...before, attuned: location === "equipped" });
    candidate.attuned = true;
    assert.equal(
      attuneEquipment(candidate, false, {}),
      true,
      "Old allocations are always repairable",
    );
    candidate.quantity = 0;
    assert.equal(attuneEquipment(candidate, true, guidance), false);
    assert.equal(attunementChoice(candidate, guidance).reason, "empty");
  }
  const candidate = item("candidate", "equipped"),
    before = structuredClone(candidate);
  assert.equal(
    attuneEquipment(candidate, true, {
      candidate: { canAttune: false, attuneReason: "prerequisite" },
    }),
    false,
  );
  assert.deepEqual(candidate, before);
});

void test("stowing explicitly releases only the selected allocation and preserves its instance", () => {
  for (const location of ["carried", "stored", "equipped"]) {
    const inventory = [item("selected", location), item("other", "equipped")];
    Object.assign(required(inventory[0]), {
      attuned: true,
      quantity: 2,
      grantId: "grant",
      spellId: "spell",
      reference: { kind: "magic-item", id: "source" },
    });
    required(inventory[1]).attuned = true;
    const before = structuredClone(inventory);
    assert.equal(stowAndUnattune(required(inventory[0])), true);
    assert.deepEqual(inventory, [{ ...before[0], location: "stored", attuned: false }, before[1]]);
    assert.equal(
      stowAndUnattune(required(inventory[0])),
      false,
      "A stale action cannot stow a subsequently unattuned item",
    );
  }
});

void test("all equipment rejection codes have translated explanations", () => {
  for (const reason of [
    "empty",
    "not-equipped",
    "source",
    "mechanics",
    "not-required",
    "build",
    "capacity",
    "duplicate",
    "prerequisite",
  ]) {
    assert.ok(equipmentReason(reason, "en"));
    assert.notEqual(equipmentReason(reason, "cs"), equipmentReason(reason, "en"), reason);
  }
  assert.equal(equipmentReason(undefined, "en"), "");
});
