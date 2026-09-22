import assert from "node:assert/strict";
import { test } from "node:test";
import { blank } from "../web/character-client.js";
import { readCharacterPending } from "../web/character-pending.js";

function pending() {
  const inputs = blank(), base = blank(); inputs.notes = "Unconfirmed";
  return { version: "character-pending.v1", key: "hero", actorId: "dm", role: "dm", inputs, base,
    revision: 7, dirty: true, changeVersion: 3, tab: "builder", builder: { tab: "wizard", target: "spell-one", open: true },
    attempt: { request: { key: "hero", operation: "build", operationId: "original", expectedRevision: 7, inputs }, base, version: 2 } };
}
test("pending input keeps its base, queued version and original uncertain request detached", () => {
  const original = pending(), value = readCharacterPending(original);
  assert.deepEqual(value, original);
  value.inputs.notes = "Newer"; value.attempt.request.inputs.notes = "Changed";
  assert.equal(original.inputs.notes, "Unconfirmed");
  assert.equal(original.attempt.request.expectedRevision, 7);
  const command = { ...pending(), command: { method: "commit", retry: true, request: { key: "hero", expectedRevision: 7, operationId: "reviewed", token: "approved" } } };
  assert.deepEqual(readCharacterPending(command).command, command.command);
});
test("pending recovery rejects incompatible versions, identities, requests and oversized input", () => {
  for (const change of [
    { version: "retired" }, { revision: -1 }, { role: "other" }, { inputs: {} },
    { attempt: { ...pending().attempt, request: { ...pending().attempt.request, key: "another" } } },
    { command: { method: "preview", retry: true, request: pending().attempt.request } },
    { inputs: { ...blank(), notes: "x".repeat(180001) } },
  ]) assert.throws(() => readCharacterPending({ ...pending(), ...change }), /Pending changes could not be restored/);
});
