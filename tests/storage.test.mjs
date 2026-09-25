import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blank, mergeCharacter } from '../web/character-client.js';
import { assignContainer, containerOptions, moveEquipment, removeContainer, removeInventoryItem } from '../web/character-inventory.js';

function stored() {
  const input = blank();
  input.play.containers = [{ id: 'pack', name: 'Bag' }, { id: 'pouch', name: 'Bag' }];
  input.play.inventory = ['one', 'two', 'empty'].map((id, index) => ({ id, name: 'Same name', quantity: index === 2 ? 0 : 2, location: index === 1 ? 'stored' : 'carried', attuned: index === 1, acquisition: 'Reward', notes: 'Retain notes', grantId: 'reward', containerId: 'pack' }));
  input.play.quickUse = ['empty', 'one'];
  return input;
}

test('storage operations preserve exact instances, depleted contents and allocations', () => {
  const input = stored(), original = structuredClone(input);
  assert.equal(assignContainer(input, 'missing', 'pouch'), false);
  assert.equal(assignContainer(input, 'one', 'missing'), false);
  assert.deepEqual(input, original);
  assert.equal(assignContainer(input, 'one', 'pouch'), true);
  assert.deepEqual(input.play.inventory[0], { ...original.play.inventory[0], containerId: 'pouch' });
  assert.equal(removeContainer(input, 'pack'), true);
  for (const index of [1, 2]) {
    const expected = { ...original.play.inventory[index] }; delete expected.containerId;
    assert.deepEqual(input.play.inventory[index], expected);
  }
  assert.deepEqual(input.play.quickUse, original.play.quickUse);
  assert.equal(input.play.inventory[0].containerId, 'pouch');
  assert.equal(removeContainer(input, 'pouch'), true);
  assert.equal(Object.hasOwn(input.play, 'containers'), false);
  assert.equal(input.play.inventory.some(item => Object.hasOwn(item, 'containerId')), false);
  assert.deepEqual(containerOptions(original.play.containers), [{ id: 'pack', label: 'Bag (1)' }, { id: 'pouch', label: 'Bag (2)' }]);
});

test('equipment assignment releases membership only after eligibility and never recreates it', () => {
  const input = stored(), before = structuredClone(input.play.inventory);
  assert.equal(moveEquipment(input.play.inventory, 'one', 'equipped', {}), false);
  assert.deepEqual(input.play.inventory, before);
  assert.equal(moveEquipment(input.play.inventory, 'one', 'equipped', { one: { slot: 'worn', canEquip: true } }), true);
  assert.equal(Object.hasOwn(input.play.inventory[0], 'containerId'), false);
  assert.equal(assignContainer(input, 'one', 'pack'), false);
  assert.equal(moveEquipment(input.play.inventory, 'one', 'carried', {}), true);
  assert.equal(Object.hasOwn(input.play.inventory[0], 'containerId'), false);
  assert.equal(assignContainer(input, 'one', 'pouch'), true);
  removeInventoryItem(input, 'one');
  assert.deepEqual(input.play.quickUse, ['empty']);
  assert.deepEqual(input.play.containers, stored().play.containers);
});

test('storage conflicts retain a correctable proposal rather than guessing membership', () => {
  const base = stored(), local = structuredClone(base), remote = structuredClone(base);
  local.play.containers[0].name = 'Local label'; remote.play.currency.gp = 17;
  assert.equal(mergeCharacter(base, local, remote).play.containers[0].name, 'Local label');
  remote.play.containers[0].name = 'Other label';
  assert.equal(mergeCharacter(base, local, remote), undefined);
  const moving = structuredClone(base), removing = structuredClone(base);
  assignContainer(moving, 'one', 'pouch'); removeContainer(removing, 'pouch');
  const merged = mergeCharacter(base, moving, removing);
  assert.equal(merged.play.inventory[0].containerId, 'pouch', 'Engine must reject this missing destination for explicit repair');
  assert.deepEqual(merged.play.containers, [{ id: 'pack', name: 'Bag' }]);
});
