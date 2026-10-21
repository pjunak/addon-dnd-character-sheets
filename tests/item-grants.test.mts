import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advantageNames,
  itemProperties,
  playResources,
  resourceSource,
} from "#web/character-sheet";
import { grantedConditions } from "#web/character-conditions";
import type { CatalogRecord } from "#web/character-client";
import type { Evidence, Projection, Sheet } from "#web/character-model";
import { partial } from "./support/helpers.mts";

const projection = (sheet: Record<string, unknown>, evidence: Evidence[] = []): Projection => ({
  sheet: partial<Sheet>(sheet),
  explanations: {},
  evidence,
  issues: [],
});
const card = (id: string, name: string) => ({
  type: "item",
  id,
  name,
  ref: { kind: "magic-item", id: name.toLowerCase().replaceAll(" ", "-") },
});

void test("advantages name the features and items that give them", () => {
  const saved = projection({
    advantages: [
      { on: "deathSave", name: "Resilience", source: card("inv-1", "Resilience") },
      { on: "deathSave", name: "Iron Will", source: { type: "feature", id: "iron-will" } },
      { on: "deathSave", name: "Resilience", source: card("inv-2", "Resilience") },
      {
        on: "save",
        abilities: ["WIS"],
        when: "to resist the Charmed condition",
        name: "Balanced Emotions",
        source: card("inv-3", "Balanced Emotions"),
      },
      { on: "attack", name: "Poisoned", source: { type: "condition", id: "poisoned" } },
      { on: "check", skills: ["stealth"], mode: "disadvantage", name: "Chain Mail" },
      { on: "concentration" },
    ],
  });
  assert.deepEqual(advantageNames(saved, "en"), [
    "Death saves · Resilience, Iron Will",
    "WIS saves (to resist the Charmed condition) · Balanced Emotions",
    "Concentration",
  ]);
  assert.deepEqual(advantageNames(saved, "en", "disadvantage"), ["Stealth checks · Chain Mail"]);
  assert.deepEqual(advantageNames(saved, "cs", "disadvantage"), [
    "Ověření Nenápadnost · Chain Mail",
  ]);
});

void test("uses of an owned but inactive item stay hidden until it is active", () => {
  const saved = projection({
    resources: [
      { key: "channel-divinity", name: "Channel Divinity", max: 2 },
      { key: "item:inv-1:uses", name: "Uses", max: 1, active: true },
      { key: "item:inv-2:uses", name: "Uses", max: 1, active: false },
    ],
  });
  assert.deepEqual(
    playResources(saved).map((row) => row["key"]),
    ["channel-divinity", "item:inv-1:uses"],
  );
  assert.deepEqual(playResources(undefined), []);
});

void test("item uses name their item, unless the use already carries its name", () => {
  const evidence: Evidence[] = [
    {
      reference: { kind: "magic-item", id: "good-fortune" },
      name: "Good Fortune",
      hash: "h",
      summary: "",
      facts: {},
    },
  ];
  assert.equal(
    resourceSource({ name: "Uses", source: card("inv-1", "Good Fortune") }, "en", evidence),
    "Good Fortune",
  );
  assert.equal(
    resourceSource({ name: "Divine Guidance", source: card("inv-2", "Divine Guidance") }, "en"),
    "",
  );
  assert.equal(
    resourceSource(
      {
        name: "Misty Step",
        source: {
          type: "feat",
          id: "fey-touched",
          name: "Fey Touched",
          acquisition: { id: "asi:4", classId: "wizard", level: 4 },
        },
      },
      "cs",
    ),
    "Fey Touched · Wizard · Úroveň 4",
  );
  assert.equal(
    resourceSource({ name: "Rage", source: { type: "class", id: "barbarian" } }, "en"),
    "",
  );
  assert.equal(resourceSource({ name: "Rage" }, "en"), "");
});

void test("item conditions read their level and items and are kept apart from authored ones", () => {
  const saved = projection({
    conditions: [
      { id: "poisoned", name: "Poisoned", level: 1, status: "active" },
      {
        id: "fate-touched",
        name: "Fate-Touched",
        summary: "Fate bends around you.",
        level: 3,
        granted: true,
        status: "active",
        sources: [card("inv-1", "Luna"), card("inv-2", "Good Fortune"), card("inv-3", "Luna")],
      },
      { id: "warded", labelKey: "Charmed", granted: true, status: "immune", sources: [] },
    ],
  });
  assert.deepEqual(grantedConditions(saved, "en"), [
    {
      id: "fate-touched",
      name: "Fate-Touched",
      level: 3,
      summary: "Fate bends around you.",
      sources: ["Luna", "Good Fortune"],
      immune: false,
    },
    { id: "warded", name: "Charmed", level: 1, summary: "", sources: [], immune: true },
  ]);
  assert.equal(grantedConditions(saved, "cs")[1]?.name, "Zmámení");
  assert.deepEqual(grantedConditions(undefined, "en"), []);
});

void test("item properties show each active item's record text from the catalog or evidence", () => {
  const catalogs = new Map<string, CatalogRecord[]>([
    [
      "magic-item",
      [
        {
          kind: "magic-item",
          id: "luna",
          value: { name: "Luna", text: "**Under open sky** you see in the dark." },
        },
      ],
    ],
  ]);
  const saved = projection(
    {
      activeItems: [
        { itemId: "inv-1", name: "Luna", ref: { kind: "magic-item", id: "luna" } },
        { itemId: "inv-2", ref: { kind: "magic-item", id: "courage" } },
        { itemId: "inv-3", name: "Lost card", ref: { kind: "magic-item", id: "lost" } },
      ],
    },
    [
      {
        reference: { kind: "magic-item", id: "luna" },
        name: "Luna",
        hash: "h",
        summary: "Saved summary.",
        facts: {},
      },
      {
        reference: { kind: "magic-item", id: "courage" },
        name: "Courage",
        hash: "h",
        summary: "You do not flee.",
        facts: {},
      },
    ],
  );
  assert.deepEqual(itemProperties(saved, catalogs), [
    {
      itemId: "inv-1",
      name: "Luna",
      reference: { kind: "magic-item", id: "luna" },
      text: "Under open sky you see in the dark.",
    },
    {
      itemId: "inv-2",
      name: "Courage",
      reference: { kind: "magic-item", id: "courage" },
      text: "You do not flee.",
    },
    {
      itemId: "inv-3",
      name: "Lost card",
      reference: { kind: "magic-item", id: "lost" },
      text: "",
    },
  ]);
  assert.equal(itemProperties(saved)[0]?.text, "Saved summary.", "Without rules, evidence is used");
  assert.deepEqual(itemProperties(projection({})), []);
});
