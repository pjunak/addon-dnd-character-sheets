import assert from "node:assert/strict";
import { test } from "node:test";
import { blank } from "#web/character-client";
import { commandBlocker, readCharacterPending, sheetAccess } from "#web/character-pending";
import { feedbackMessage } from "#web/character-feedback";

function pending() {
  const inputs = blank(),
    base = blank();
  inputs.play.currency.gp = 1;
  return {
    version: "character-pending.v1",
    key: "hero",
    actorId: "dm",
    role: "dm",
    inputs,
    base,
    revision: 7,
    dirty: true,
    changeVersion: 3,
    tab: "builder",
    builder: { tab: "wizard", target: "spell-one", open: true },
    attempt: {
      request: {
        key: "hero",
        operation: "build",
        operationId: "original",
        expectedRevision: 7,
        inputs,
      },
      base,
      version: 2,
    },
  };
}
void test("pending input keeps its base, queued version and original uncertain request detached", () => {
  const original = pending(),
    value = readCharacterPending(original);
  assert.deepEqual(value, original);
  value.inputs.play.currency.gp = 2;
  value.attempt.request.inputs.play.currency.gp = 3;
  assert.equal(original.inputs.play.currency.gp, 1);
  assert.equal(original.attempt.request.expectedRevision, 7);
  const command = {
    ...pending(),
    command: {
      method: "commit",
      retry: true,
      request: { key: "hero", expectedRevision: 7, operationId: "reviewed", token: "approved" },
    },
  };
  assert.deepEqual(readCharacterPending(command).command, command.command);
});
void test("pending recovery rejects incompatible versions, identities, requests and oversized input", () => {
  for (const change of [
    { version: "retired" },
    { revision: -1 },
    { role: "other" },
    { inputs: {} },
    {
      attempt: { ...pending().attempt, request: { ...pending().attempt.request, key: "another" } },
    },
    { command: { method: "preview", retry: true, request: pending().attempt.request } },
    { inputs: { ...blank(), grants: ["x".repeat(180001)] } },
  ])
    assert.throws(
      () => readCharacterPending({ ...pending(), ...change }),
      /Pending changes could not be restored/,
    );
});

void test("Equipment navigation survives the host-owned pending handoff", () => {
  const original = { ...pending(), tab: "equipment" };
  assert.deepEqual(readCharacterPending(original), original);
});

void test("changed rules allow repairing edits, while commands wait for the adoption", () => {
  assert.deepEqual(sheetAccess(true, { status: "ready", rulesChanged: true }), {
    edit: true,
    command: false,
  });
  assert.deepEqual(sheetAccess(true, { status: "invalid", rulesChanged: true }), {
    edit: true,
    command: false,
  });
  assert.deepEqual(sheetAccess(true, { status: "ready", rulesChanged: false }), {
    edit: true,
    command: true,
  });
  assert.deepEqual(sheetAccess(true, { status: "unavailable", rulesChanged: false }), {
    edit: false,
    command: false,
  });
  assert.deepEqual(sheetAccess(false, { status: "ready", rulesChanged: true }), {
    edit: false,
    command: false,
  });
});

void test("a command that cannot start says why in both languages", () => {
  const ready = { canEdit: true, busy: false, command: false, attempt: false, dirty: false };
  assert.equal(commandBlocker(ready), "");
  const reasons = [
    commandBlocker({ ...ready, canEdit: false }),
    commandBlocker({ ...ready, command: true }),
    commandBlocker({ ...ready, attempt: true }),
    commandBlocker({ ...ready, busy: true }),
    commandBlocker({ ...ready, dirty: true }),
  ];
  assert.equal(new Set(reasons).size, reasons.length);
  for (const reason of reasons) {
    assert.ok(reason);
    assert.notEqual(feedbackMessage(reason, "cs"), reason, reason);
  }
  // Adopting changed rules saves the pending edits itself, but never over an
  // uncertain earlier save.
  assert.equal(commandBlocker({ ...ready, dirty: true }, true), "");
  assert.notEqual(commandBlocker({ ...ready, dirty: true, attempt: true }, true), "");
});
