import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { blank, DraftStore, TransferStore, parseCharacter, exportCharacter, externalHistory } from '../web/character-client.js';

test('current transfer accepts only the explicit current envelope and preserves authored inputs', () => {
  const inputs = blank(); inputs.notes = 'Mira — a new beginning'; inputs.play.rolls = [{ id: 'roll-one', resource: 'hit-dice-d10', die: 10, result: 6, at: '2026-09-11T00:00:00Z' }];
  const state = { schemaVersion: '4.0.0', inputs, rules: { engineId: 'rules', engineVersion: '4.0.0', engineGeneration: 'generation', identity: {} }, projection: { sheet: {}, explanations: {}, evidence: [], issues: [] }, operationId: 'first' };
  assert.deepEqual(parseCharacter(exportCharacter(state)), inputs);
  for (const value of [inputs, { v: 3 }, { format: 'dnd-character.v1', schemaVersion: '3.0.0', inputs }, { format: 'dnd-character.v1', schemaVersion: '4.0.0', inputs, admin: true }]) assert.throws(() => parseCharacter(JSON.stringify(value)));
  assert.throws(() => parseCharacter(' '.repeat(190001)));
});

test('durable drafts survive a new instance, retain the observed revision and isolate editors', () => {
  const records = new Map(), storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  globalThis.location = { origin: 'https://fixture.invalid' };
  const first = new DraftStore('editor-one', 'hero', storage), inputs = blank(); inputs.notes = 'Unsaved correction'; first.write(inputs, 12);
  inputs.notes = 'Later typing';
  const recovered = new DraftStore('editor-one', 'hero', storage).read(); assert.equal(recovered.baseRevision, 12); assert.equal(recovered.inputs.notes, 'Unsaved correction');
  assert.equal(new DraftStore('editor-two', 'hero', storage).read(), undefined); assert.equal(new DraftStore('editor-one', 'another-hero', storage).read(), undefined);
  records.set(first.key, '{bad-json'); assert.throws(() => first.read()); assert.equal(records.get(first.key), '{bad-json');
});

test('manifest declares worker authority, retained history and the current engine contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../addon.json', import.meta.url), 'utf8'));
  assert.equal(manifest.recordExtensions[0].id, 'dnd-sheets'); assert.equal(manifest.recordExtensions[0].retained, true); assert.equal(manifest.recordExtensions[0].schemaVersion, '4.0.0');
  assert.equal(manifest.services.consumes.find(service => service.contract === 'dnd5e.rules-engine').range, '^4.0.0');
  assert.ok(manifest.capabilities.required.includes('data.history')); assert.ok(manifest.capabilities.required.includes('ui.rule-details'));
  const service = JSON.parse(await readFile(new URL('../contracts/character.service.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(service.methods).sort(), ['commit', 'compare', 'evaluate', 'history', 'load', 'preview', 'revision']);
});

test('bounded history transfers remain separate from playable inputs and recover without rules', () => {
  const inputs = blank(), state = {schemaVersion:'4.0.0', inputs, rules:{}, projection:{}, operationId:'export'};
  const history = [{revision:3, actorId:'claimed-dm', occurredAt:'2026-09-11T00:00:00Z', summary:'External reward', state}];
  const body = exportCharacter(state, history);
  assert.deepEqual(parseCharacter(body), inputs);
  assert.deepEqual(externalHistory(body), history);
  assert.equal(parseCharacter(body).actorId, undefined);
  assert.throws(()=>exportCharacter(state, Array(6).fill(history[0])));
  assert.throws(()=>exportCharacter({...state, inputs:{...inputs,notes:'x'.repeat(1000000)}},history));
  assert.throws(()=>parseCharacter(JSON.stringify({...JSON.parse(body),externalHistory:[{...history[0],revision:-1}]})));
  const values = new Map(), storage = {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.location = {origin:'https://fixture.invalid'};
  const transfer = new TransferStore('editor','hero',storage); transfer.write(body);
  assert.equal(new TransferStore('editor','hero',storage).read(),body);
  assert.equal(new TransferStore('other','hero',storage).read(),'');
  assert.throws(()=>transfer.write('{invalid')); assert.equal(transfer.read(),body);
  transfer.clear(); assert.equal(transfer.read(),'');
});
