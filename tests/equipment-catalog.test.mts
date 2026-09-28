import assert from "node:assert/strict";
import { test } from "node:test";
import { equipmentCategory } from "#web/character-equipment";
import type { CatalogRecord } from "#web/character-client";

void test("equipment folders use the source field owned by each record kind", () => {
  const examples: [string, Record<string, unknown>, string][] = [
    ["armor", { armorType: "light", category: "Ignore generic category" }, "light"],
    ["armor", { armorType: "shield" }, "shield"],
    ["magic-item", { itemType: "Ring", type: "Ignore generic type" }, "Ring"],
    ["magic-item", { itemType: "Armor (Shield)" }, "Armor (Shield)"],
    ["weapon", { category: "martial" }, "martial"],
    ["gear", { type: "Tools" }, "Tools"],
    ["gear", { category: "Travel", type: "Ignore fallback" }, "Travel"],
    ["armor", { category: "Provider category" }, "Provider category"],
    ["magic-item", { type: "Provider type" }, "Provider type"],
    ["gear", { name: "Boots", tags: ["armor", "feet"] }, "Other"],
  ];
  for (const [kind, value, expected] of examples) {
    const record: CatalogRecord = { kind, id: "source-item", value };
    const before = structuredClone(record);
    assert.equal(equipmentCategory(record), expected);
    assert.deepEqual(record, before, "Browsing cannot rewrite source facts");
  }
});
