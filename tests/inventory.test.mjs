import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attuneEquipment, attunementChoice, equipmentReason, equipmentSlot, moveEquipment, pinQuickUse, removeInventoryItem, quickUseReason, stowAndUnattune } from '../web/character-inventory.js';

import { blank } from '../web/character-client.js';

const item = (id, location = 'carried') => ({ id, name: id, location, quantity: 1, attuned: false, acquisition: 'Keep provenance', notes: 'Keep notes' });

test('quick use pins exact instances without copying or resetting inventory', () => {
  const input = blank();
  input.play.inventory = [item('one'), { ...item('two'), name: 'one', quantity: 0, location: 'stored', grantId: 'reward' }];
  const before = structuredClone(input.play.inventory);
  assert.equal(pinQuickUse(input, 'missing', true), false);
  assert.equal(pinQuickUse(input, 'two', true), true);
  assert.equal(pinQuickUse(input, 'one', true), true);
  assert.equal(pinQuickUse(input, 'two', true), false);
  assert.deepEqual(input.play.quickUse, ['two', 'one']);
  assert.deepEqual(input.play.inventory, before);
  removeInventoryItem(input, 'one');
  assert.deepEqual(input.play.quickUse, ['two']);
  assert.deepEqual(input.play.inventory, [before[1]]);
  assert.equal(pinQuickUse(input, 'two', false), true);
  assert.equal(Object.hasOwn(input.play, 'quickUse'), false);
  assert.deepEqual(input.play.inventory, [before[1]], 'Unpinning never removes an item');
  for (const reason of ['empty', 'stored', 'missing', 'build']) {
    assert.ok(quickUseReason(reason, 'en'));
    assert.notEqual(quickUseReason(reason, 'cs'), quickUseReason(reason, 'en'));
  }
});

test('both inventory entry points can replace only the occupied exclusive slot', () => {
  for (const slot of ['armor', 'shield']) {
    const inventory = [item('old', 'equipped'), item('new', 'stored'), item('spare', 'stored'), item('carried'), item('other', 'equipped')];
    inventory[0].attuned = true;
    const guidance = Object.fromEntries(inventory.map(row => [row.id, { slot: row.id === 'other' ? 'worn' : slot, canEquip: true }]));
    const before = structuredClone(inventory);
    assert.equal(moveEquipment(inventory, 'new', 'equipped', guidance), true);
    assert.deepEqual(inventory, before.map(row => ({ ...row, location: row.id === 'old' ? 'carried' : row.id === 'new' ? 'equipped' : row.location })));
    assert.equal(moveEquipment(inventory, 'new', 'stored', guidance), true);
    assert.equal(inventory[0].attuned, true, 'Unequipping does not silently end attunement');
    assert.equal(inventory[2].location, 'stored');
  }
});

test('worn items coexist and denied actions preserve every authored field', () => {
  const inventory = [item('one', 'equipped'), item('two')], before = structuredClone(inventory);
  assert.equal(moveEquipment(inventory, 'two', 'equipped', {}), false);
  assert.equal(moveEquipment(inventory, 'two', 'missing', {}), false);
  assert.equal(attuneEquipment(inventory[1], true, {}), false);
  assert.deepEqual(inventory, before);
  assert.equal(moveEquipment(inventory, 'two', 'equipped', { two: { slot: 'worn', canEquip: true } }), true);
  assert.equal(inventory[0].location, 'equipped');
  inventory[0].attuned = true;
  assert.equal(attuneEquipment(inventory[0], false, {}), true, 'Repair remains possible after eligibility disappears');
});

test('saved slots and older evidence render without a provider or catalog ID heuristics', () => {
  const shield = { ...item('guard', 'equipped'), reference: { kind: 'armor', id: 'round-guard' } };
  const projection = { sheet: { equipment: { guard: { slot: 'shield' } } }, evidence: [] };
  assert.equal(equipmentSlot(shield, {}, projection), 'shield');
  assert.equal(equipmentSlot(shield, { guard: { slot: 'armor' } }, projection), 'armor');
  const older = { sheet: {}, evidence: [{ reference: shield.reference, facts: { armorType: 'shield' } }] };
  assert.equal(equipmentSlot(shield, {}, older), 'shield');
  older.evidence[0].facts.armorType = 'heavy';
  assert.equal(equipmentSlot(shield, {}, older), 'armor');
  assert.equal(equipmentSlot({ ...shield, reference: { kind: 'armor', id: 'shield' } }, {}), 'worn', 'IDs are not mechanics');
});

test('new attunements require equipped positive quantities and engine eligibility', () => {
  for (const location of ['carried', 'stored', 'equipped']) {
    const candidate = item('candidate', location), before = structuredClone(candidate);
    const guidance = { candidate: { canAttune: true } };
    assert.equal(attunementChoice(candidate, guidance).allowed, location === 'equipped');
    assert.equal(attuneEquipment(candidate, true, guidance), location === 'equipped');
    assert.deepEqual(candidate, { ...before, attuned: location === 'equipped' });
    candidate.attuned = true;
    assert.equal(attuneEquipment(candidate, false, {}), true, 'Old allocations are always repairable');
    candidate.quantity = 0;
    assert.equal(attuneEquipment(candidate, true, guidance), false);
    assert.equal(attunementChoice(candidate, guidance).reason, 'empty');
  }
  const candidate = item('candidate', 'equipped'), before = structuredClone(candidate);
  assert.equal(attuneEquipment(candidate, true, { candidate: { canAttune: false, attuneReason: 'prerequisite' } }), false);
  assert.deepEqual(candidate, before);
});

test('stowing explicitly releases only the selected allocation and preserves its instance', () => {
  for (const location of ['carried', 'stored', 'equipped']) {
    const inventory = [item('selected', location), item('other', 'equipped')];
    Object.assign(inventory[0], { attuned: true, quantity: 2, grantId: 'grant', spellId: 'spell', reference: { kind: 'magic-item', id: 'source' } });
    inventory[1].attuned = true;
    const before = structuredClone(inventory);
    assert.equal(stowAndUnattune(inventory[0]), true);
    assert.deepEqual(inventory, [{ ...before[0], location: 'stored', attuned: false }, before[1]]);
    assert.equal(stowAndUnattune(inventory[0]), false, 'A stale action cannot stow a subsequently unattuned item');
  }
});

test('all equipment rejection codes have translated explanations', () => {
  for (const reason of ['empty', 'not-equipped', 'source', 'mechanics', 'not-required', 'build', 'capacity', 'duplicate', 'prerequisite']) {
    assert.ok(equipmentReason(reason, 'en'));
    assert.notEqual(equipmentReason(reason, 'cs'), equipmentReason(reason, 'en'), reason);
  }
  assert.equal(equipmentReason(undefined, 'en'), '');
});
