import assert from "node:assert/strict";
import { test } from "node:test";
import { gearLabel, gearOptions } from "#web/character-magic-gear";
import { canStackOnto } from "#web/character-inventory";
import type { Item, Projection } from "#web/character-model";
import { partial } from "./support/helpers.mts";

const item = (extra: Partial<Item> = {}): Item => ({
  id: "pick",
  reference: { kind: "magic-item", id: "weapon-1-2-or-3" },
  name: "Weapon, +1, +2, or +3",
  quantity: 1,
  location: "equipped",
  attuned: false,
  acquisition: "",
  notes: "",
  ...extra,
});
const view = (equipment: Record<string, unknown>, projection?: Projection, locale = "en") => ({
  locale,
  equipment,
  catalogs: new Map(),
  projection,
});

void test("a magic weapon names its picked base and bonus from the Engine's options", () => {
  const equipment = {
    pick: {
      baseItems: [
        { id: "dagger", label: "Dagger" },
        { id: "longsword", label: "Longsword" },
      ],
      bonuses: [1, 2, 3],
    },
  };
  assert.deepEqual(gearOptions(view(equipment), item()), {
    bases: [
      { id: "dagger", label: "Dagger" },
      { id: "longsword", label: "Longsword" },
    ],
    bonuses: [1, 2, 3],
  });
  assert.equal(gearLabel(view(equipment), item()), "");
  assert.equal(gearLabel(view(equipment), item({ baseItemId: "longsword" })), "Longsword");
  assert.equal(
    gearLabel(view(equipment), item({ baseItemId: "longsword", bonus: 1 })),
    "Longsword, +1",
  );
  assert.equal(
    gearLabel(view(equipment, undefined, "cs"), item({ baseItemId: "longsword", bonus: 2 })),
    "Longsword +2",
  );
  // A single option needs no pick.
  const fixed = { pick: { baseItems: [{ id: "shield", label: "Shield" }], bonuses: [2] } };
  assert.equal(gearLabel(view(fixed), item()), "Shield, +2");
  assert.equal(
    gearLabel(view({ pick: { slot: "worn" } }), item({ reference: { kind: "gear", id: "rope" } })),
    "",
  );
});

void test("without rules a picked base is named from saved evidence", () => {
  const projection = partial<Projection>({
    evidence: [{ reference: { kind: "weapon", id: "longsword" }, name: "Longsword" }],
  });
  assert.equal(
    gearLabel(view({}, projection), item({ baseItemId: "longsword", bonus: 1 })),
    "Longsword, +1",
  );
  assert.equal(gearLabel(view({}), item({ baseItemId: "unknown" })), "unknown");
});

void test("new copies never stack onto magic gear with picks", () => {
  const reference = { kind: "magic-item", id: "weapon-1-2-or-3" };
  assert.equal(canStackOnto(item({ location: "carried" }), reference, undefined), true);
  assert.equal(
    canStackOnto(item({ location: "carried", baseItemId: "dagger" }), reference, undefined),
    false,
  );
  assert.equal(canStackOnto(item({ location: "carried", bonus: 1 }), reference, undefined), false);
});
