import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { blank, parseCharacter, exportCharacter, mergeCharacter } from '../web/character-client.js';

test('current transfer accepts only the explicit current envelope and preserves authored inputs', () => {
  const inputs = blank(); inputs.notes = 'Mira — a new beginning'; inputs.play.rolls = [{ id: 'roll-one', resource: 'hit-dice-d10', die: 10, result: 6, at: '2026-09-11T00:00:00Z' }];
  const state = { schemaVersion: '4.0.0', inputs, rules: { engineId: 'rules', engineVersion: '4.0.0', engineGeneration: 'generation', identity: {} }, projection: { sheet: {}, explanations: {}, evidence: [], issues: [] }, operationId: 'first' };
  assert.deepEqual(parseCharacter(exportCharacter(state)), inputs);
  for (const value of [inputs, { v: 3 }, { format: 'dnd-character.v1', schemaVersion: '3.0.0', inputs }, { format: 'dnd-character.v1', schemaVersion: '4.0.0', inputs, admin: true }]) assert.throws(() => parseCharacter(JSON.stringify(value)));
  assert.throws(() => parseCharacter(' '.repeat(190001)));
});

test('manifest declares worker authority without retained history', async () => {
  const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));
  assert.equal(manifest.recordExtensions[0].id, 'dnd-sheets'); assert.equal(manifest.recordExtensions[0].retained, undefined); assert.equal(manifest.recordExtensions[0].workerOnly, true); assert.equal(manifest.recordExtensions[0].schemaVersion, '4.0.0');
  assert.equal(manifest.services.consumes.find(service => service.contract === 'dnd5e.rules-engine').range, '^4.0.0');
  assert.ok(!manifest.capabilities.required.includes('data.history')); assert.ok(manifest.capabilities.required.includes('ui.rule-details'));
  const service = JSON.parse(await readFile(new URL('../contracts/character.service.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(service.methods).sort(), ['commit', 'evaluate', 'load', 'preview', 'save']);
});

test('restored layouts read the former character preference without rewriting it', async () => {
  const { preferredLayout } = await import('../web/character-sheet.js');
  const entries = new Map([['dse-ui:renderer:hero', 'builtin:classic']]);
  const storage = { getItem: key => entries.get(key) ?? null };
  assert.equal(preferredLayout(storage, 'dm', 'hero'), 'classic');
  assert.equal(preferredLayout(storage, 'dm', 'other'), 'compact');
  entries.set('dnd-character-layout:dm:hero', 'compact');
  assert.equal(preferredLayout(storage, 'dm', 'hero'), 'compact');
  assert.equal(preferredLayout(storage, 'player', 'hero'), 'classic');
  assert.equal(entries.get('dse-ui:renderer:hero'), 'builtin:classic');
  assert.equal(preferredLayout({ getItem() { throw new Error('Storage unavailable'); } }, 'dm', 'hero'), 'compact');
});

test('autosave rebases disjoint fields and rejects overlapping changes', () => {
 const base=blank(),local=structuredClone(base),remote=structuredClone(base);local.notes='Local notes';remote.play.hp=5;
 const merged=mergeCharacter(base,local,remote);assert.equal(merged.notes,'Local notes');assert.equal(merged.play.hp,5);
 remote.notes='Remote notes';assert.equal(mergeCharacter(base,local,remote),undefined);
 const same=mergeCharacter(base,local,local);assert.deepEqual(same,local);
 local.play.inventory=[{id:'local'}];remote.notes=base.notes;remote.play.inventory=[{id:'remote'}];assert.equal(mergeCharacter(base,local,remote),undefined);
});

test('accepted choice withdrawals preserve newer edits without restoring retired selections', async () => {
 const { reconcileCharacterChoices } = await import('../web/character-client.js');
 const old = { id: 'old-origin', slot: 0, value: 'former-choice' }, newer = { id: 'new-origin', slot: 0, value: 'new-choice' };
 const sent = [old], current = [old, newer], saved = [];
 const before = structuredClone({ sent, current, saved });
 const result = reconcileCharacterChoices(sent, current, saved);
 assert.deepEqual(result, [newer]); result[0].value = 'Detached';
 assert.deepEqual({ sent, current, saved }, before);
 assert.deepEqual(reconcileCharacterChoices(sent, [{ ...old, value: 'deliberate-replacement' }], saved), [{ ...old, value: 'deliberate-replacement' }]);
 assert.deepEqual(reconcileCharacterChoices(sent, [], sent), [], 'a later user removal must remain removed');
});
