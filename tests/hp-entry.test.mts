import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHpEntry } from "#web/character-hp";

void test("the HP field reads plain values and damage, heal and set instructions", () => {
  assert.deepEqual(parseHpEntry("31"), { kind: "set", amount: 31, instruction: false });
  assert.deepEqual(parseHpEntry("-7"), { kind: "damage", amount: 7, instruction: true });
  assert.deepEqual(parseHpEntry(" − 7 "), { kind: "damage", amount: 7, instruction: true });
  assert.deepEqual(parseHpEntry("+5"), { kind: "heal", amount: 5, instruction: true });
  assert.deepEqual(parseHpEntry("=30"), { kind: "set", amount: 30, instruction: true });
});

void test("the HP field ignores text that is not a whole amount", () => {
  for (const value of ["", "-", "+", "abc", "1.5", "--3", "3-", "=", "12345678"])
    assert.equal(parseHpEntry(value), undefined, value);
});
