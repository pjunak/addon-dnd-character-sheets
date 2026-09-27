import assert from "node:assert/strict";
import { test } from "node:test";
import { blank, mergeCharacter } from "#web/character-client";
import { assignBodyPlacement, moveEquipment, stowAndUnattune } from "#web/character-inventory";
import type { Item } from "#web/character-model";
import { required } from "./support/helpers.mts";

const item = (id: string, bodyPlacement?: string): Item => ({
  id,
  name: "Owned item",
  quantity: 1,
  location: "equipped",
  ...(bodyPlacement === undefined ? {} : { bodyPlacement }),
  attuned: true,
  acquisition: "Quest",
  notes: "Retain notes",
  grantId: "ruling",
});
const guidance = {
  one: { canEquip: true, slot: "armor", bodyPlacements: ["body"] },
  two: { canEquip: true, slot: "armor", bodyPlacements: ["body"] },
};
void test("placement uses current guidance and explicit moves preserve owned state", () => {
  const owned = item("one", "body"),
    original = structuredClone(owned);
  assert.equal(assignBodyPlacement(owned, "face", guidance), false);
  assert.deepEqual(owned, original);
  assert.equal(assignBodyPlacement(owned, "", {}), true);
  assert.equal(Object.hasOwn(owned, "bodyPlacement"), false);
  assert.equal(assignBodyPlacement(owned, "body", {}), false);
  assert.equal(assignBodyPlacement(owned, "body", guidance), true);
  const inventory = [owned, { ...item("two"), location: "carried", attuned: false }];
  const before = structuredClone(inventory);
  assert.equal(moveEquipment(inventory, "two", "equipped", guidance), true);
  const { bodyPlacement: _, ...unplaced } = original;
  assert.deepEqual(owned, { ...unplaced, location: "carried" });
  assert.equal(owned.attuned, true);
  assert.equal(assignBodyPlacement(required(inventory[1]), "body", guidance), true);
  assert.equal(assignBodyPlacement(owned, "body", guidance), false);
  required(inventory[1]).attuned = true;
  assert.equal(stowAndUnattune(required(inventory[1])), true);
  assert.equal(Object.hasOwn(required(inventory[1]), "bodyPlacement"), false);
  assert.equal(required(inventory[1]).id, required(before[1]).id);
  assert.equal(required(inventory[1]).notes, required(before[1]).notes);
});

void test("placement preserves whole-inventory conflict semantics and disjoint edits", () => {
  const base = blank();
  base.play.inventory = [item("one", "body")];
  const local = structuredClone(base),
    remote = structuredClone(base);
  required(local.play.inventory[0]).bodyPlacement = "other";
  remote.play.currency.gp = 12;
  const result = mergeCharacter(base, local, remote);
  assert.equal(required(required(result).play.inventory[0]).bodyPlacement, "other");
  assert.equal(required(result).play.currency.gp, 12);
  required(remote.play.inventory[0]).bodyPlacement = "neck";
  assert.equal(mergeCharacter(base, local, remote), undefined);
});
