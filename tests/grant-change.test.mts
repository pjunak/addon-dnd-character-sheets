import assert from "node:assert/strict";
import { test } from "node:test";
import { blank } from "#web/character-client";
import { changeGrant } from "#web/character-grant";
import type { Grant, Item } from "#web/character-model";
import { required } from "./support/helpers.mts";

const grant = (id: string, itemId?: string): Grant => ({
  id,
  name: id,
  reason: "Quest",
  actorId: "dm",
  grantedAt: "2026-10-01T00:00:00Z",
  active: true,
  effectiveLevel: 1,
  condition: "always",
  effects: [],
  waivers: [],
  ...(itemId ? { itemId } : {}),
});
const item = (id: string, grantId?: string): Item => ({
  id,
  name: id,
  quantity: 1,
  location: "carried",
  attuned: false,
  acquisition: "Reward",
  notes: "Keep notes",
  ...(grantId ? { grantId } : {}),
});

void test("a pending revocation removes only that grant and its item link", () => {
  const input = blank();
  input.grants = [grant("first", "charm"), grant("second", "ring")];
  input.play.inventory = [item("charm", "first"), item("ring", "second")];
  assert.equal(changeGrant(input, "first"), true);
  assert.deepEqual(
    input.grants.map((value) => value.id),
    ["second"],
  );
  assert.deepEqual(input.play.inventory, [item("charm"), item("ring", "second")]);
  assert.equal(changeGrant(input, "missing"), false);
});

void test("a pending amendment keeps the grant's place and moves its item link", () => {
  const input = blank();
  input.grants = [grant("first", "charm"), grant("second")];
  input.play.inventory = [item("charm", "first"), item("ring")];
  const amended = { ...grant("form-copy", "ring"), reason: "Moved to the ring" };
  assert.equal(changeGrant(input, "first", amended), true);
  assert.deepEqual(
    input.grants.map((value) => [value.id, value.reason]),
    [
      ["first", "Moved to the ring"],
      ["second", "Quest"],
    ],
  );
  assert.deepEqual(input.play.inventory, [item("charm"), item("ring", "first")]);
  // The amendment is copied, so the form's own object stays separate.
  amended.reason = "Edited later";
  assert.equal(required(input.grants[0]).reason, "Moved to the ring");
});
