import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { blank, type CharacterRequest } from "#web/character-client";
import { changeGrant } from "#web/character-grant";
import type { Grant, Inputs, Response, Result, State } from "#web/character-model";
import type { CharacterPending } from "#web/character-pending";
import { CharacterSession, type ViewHandle } from "#web/character-session";
import { required } from "./support/helpers.mts";

const policy = { standardArray: [15, 14, 13, 12, 10, 8] };
const rules = { engineId: "engine", engineVersion: "5.0.0", engineGeneration: "one", identity: {} };
const builder = { tab: "character", target: "", open: true };

function saved(inputs: Inputs, operationId = "earlier-operation"): State {
  return {
    schemaVersion: "5.0.0",
    inputs: structuredClone(inputs),
    projection: { sheet: {}, explanations: {}, evidence: [], issues: [] },
    rules,
    operationId,
  };
}
function evaluation(inputs: Inputs, guidance: Record<string, unknown> = {}): Result {
  return {
    contractVersion: "rules-engine-result.v5",
    inputs: structuredClone(inputs),
    sheet: {},
    guidance,
    plan: {},
    spellOptions: {},
    explanations: {},
    evidence: [],
    issues: [],
    ready: true,
  };
}
function answer(fields: Partial<Response> = {}): Response {
  return {
    contractVersion: "character-response.v3",
    status: "ready",
    message: "",
    key: "hero",
    revision: 1,
    actorId: "player-one",
    role: "player",
    rulesChanged: false,
    ...fields,
  };
}
/** An evaluated answer for a saved character, as a read or a save returns it. */
function savedAnswer(inputs: Inputs, revision: number, fields: Partial<Response> = {}): Response {
  return answer({
    revision,
    state: saved(inputs),
    evaluation: evaluation(inputs),
    policy,
    ...fields,
  });
}
function edited(change: (input: Inputs) => void, from = blank()): Inputs {
  const inputs = structuredClone(from);
  change(inputs);
  return inputs;
}
const grant = (id: string): Grant => ({
  id,
  name: id,
  reason: "Quest",
  actorId: "dm-one",
  grantedAt: "2026-10-01T00:00:00Z",
  active: true,
  effectiveLevel: 1,
  condition: "always",
  effects: [],
  waivers: [],
});

interface Call {
  readonly method: string;
  /** The request as it was sent. */
  readonly request: CharacterRequest;
  /** What can cancel the request besides the add-on stopping. */
  readonly signal: AbortSignal | undefined;
  answer(response: Response): Promise<void>;
  fail(error: unknown): Promise<void>;
}

/** Lets every queued promise continuation run; timers stay mocked. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

const mockedTimers = new WeakSet<TestContext>();

/** A session whose worker answers only when the test says so. */
function sheet(t: TestContext) {
  if (!mockedTimers.has(t)) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    mockedTimers.add(t);
  }
  const calls: Call[] = [],
    events: string[] = [];
  const session = new CharacterSession({
    call: (method, request, signal) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({
          method,
          request: structuredClone(request),
          signal,
          answer: async (response) => {
            resolve(response);
            await settle();
          },
          fail: async (error) => {
            reject(error);
            await settle();
          },
        });
      }),
    signal: new AbortController().signal,
    view: {
      canEdit: () => true,
      typing: () => false,
      render: () => events.push("render"),
      status: () => events.push("status"),
      publish: () => events.push("publish"),
      busy: () => {
        events.push("busy");
        return () => events.push("idle");
      },
      focusStatus: () => events.push("focus-status"),
    },
  });
  /** The latest request, which must be for `method`. */
  const next = async (method: string): Promise<Call> => {
    await settle();
    const call = required(calls.at(-1), "Expected a request for " + method);
    assert.equal(call.method, method);
    return call;
  };
  /** Edits the page's inputs and lets the autosave start. */
  const edit = (change: (input: Inputs) => void): void => {
    change(session.state.input);
    session.changed();
    t.mock.timers.tick(250);
  };
  /** Opens a view of the character and answers its read. */
  const open = async (response: Response, handoff?: unknown): Promise<ViewHandle> => {
    session.connect(handoff);
    const view = session.begin("hero");
    const reading = session.guard(async () => {
      await session.read();
    });
    await (await next("load")).answer(response);
    await reading;
    return view;
  };
  const saves = (): Call[] => calls.filter((call) => call.method === "save");
  return { session, calls, events, next, edit, open, saves };
}

void test("a lost save reply is resent unchanged before newer edits are saved", async (t) => {
  const { session, next, edit, open, saves } = sheet(t);
  await open(savedAnswer(blank(), 3));
  edit((input) => {
    input.play.currency.gp = 5;
  });
  const lost = await next("save");
  assert.equal(lost.request.expectedRevision, 3);
  assert.equal(lost.request.inputs?.play.currency.gp, 5);
  await lost.fail(new Error("The network connection was lost."));
  assert.equal(session.state.blocked, true);
  assert.equal(session.state.dirty, true);
  assert.equal(session.state.message, "The network connection was lost.");
  // The host keeps the uncertain request with the page until its outcome is known.
  const kept = session.checkpoint("sheet", builder);
  assert.equal(kept.dirty, true);
  assert.deepEqual((kept.pending as CharacterPending).attempt?.request, lost.request);

  edit((input) => {
    input.play.currency.gp = 7;
  });
  const retried = await next("save");
  assert.deepEqual(retried.request, lost.request);
  // The worker recognizes the operation it already saved and answers with a receipt.
  await retried.answer(
    answer({
      revision: 4,
      state: saved(
        edited((input) => {
          input.play.currency.gp = 5;
        }),
        lost.request.operationId,
      ),
    }),
  );
  const newer = await next("save");
  assert.notEqual(newer.request.operationId, lost.request.operationId);
  assert.equal(newer.request.expectedRevision, 4);
  assert.equal(newer.request.inputs?.play.currency.gp, 7);
  await newer.answer(
    savedAnswer(
      edited((input) => {
        input.play.currency.gp = 7;
      }),
      5,
    ),
  );
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.message, "Saved");
  assert.equal(session.state.saved?.revision, 5);
  assert.equal(saves().length, 3);
});

void test("a save receipt without rules results keeps Saved and reads the guidance again", async (t) => {
  const { session, next, edit, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  edit((input) => {
    input.play.inspiration = true;
  });
  const save = await next("save");
  const stored = edited((input) => {
    input.play.inspiration = true;
  });
  await save.answer(answer({ revision: 4, state: saved(stored, save.request.operationId) }));
  assert.equal(session.state.message, "Saved");
  assert.equal(session.state.evaluation, undefined);
  // The rules' building options survive an answer that carries none.
  assert.deepEqual(session.state.policy, policy);
  await (await next("load")).answer(savedAnswer(stored, 4));
  assert.equal(session.state.message, "Saved");
  assert.ok(session.state.evaluation);
});

void test("disjoint edits from another session merge and save at its revision", async (t) => {
  const { session, next, edit, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  edit((input) => {
    input.play.currency.gp = 5;
  });
  const remote = edited((input) => {
    input.play.currency.sp = 9;
  });
  await (
    await next("save")
  ).answer(
    answer({
      status: "conflict",
      message: "The character changed in another session. Reload before editing the same values.",
      revision: 4,
      state: saved(remote),
    }),
  );
  const rebased = await next("save");
  assert.equal(rebased.request.expectedRevision, 4);
  assert.deepEqual(rebased.request.inputs?.play.currency, { gp: 5, sp: 9 });
  await rebased.answer(savedAnswer(required(rebased.request.inputs), 5));
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.message, "Saved");
  assert.deepEqual(session.state.input.play.currency, { gp: 5, sp: 9 });
});

void test("overlapping edits from another session stay on the page until reloaded", async (t) => {
  const { session, next, edit, open, saves } = sheet(t);
  await open(savedAnswer(blank(), 3));
  const loaded = session.state.saved;
  edit((input) => {
    input.play.currency.gp = 5;
  });
  await (
    await next("save")
  ).answer(
    answer({
      status: "conflict",
      message: "The character changed in another session. Reload before editing the same values.",
      revision: 4,
      state: saved(
        edited((input) => {
          input.play.currency.gp = 6;
        }),
      ),
    }),
  );
  assert.equal(saves().length, 1);
  assert.equal(session.state.blocked, true);
  assert.equal(session.state.dirty, true);
  assert.equal(
    session.state.message,
    "This character was edited elsewhere. Your pending input remains on this page. Reload the character before continuing.",
  );
  assert.equal(session.state.input.play.currency.gp, 5);
  assert.equal(session.state.saved, loaded);
});

void test("a sheet removed elsewhere is not shown from an earlier answer", async (t) => {
  const { session, next, edit, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  const refreshing = session.refresh();
  // A removed sheet reads empty at the host's deleted revision.
  await (await next("load")).answer(answer({ revision: 8 }));
  await refreshing;
  assert.equal(session.state.saved?.state, undefined);
  assert.equal(session.state.baseRevision, 8);
  assert.deepEqual(session.state.input, blank());

  await open(savedAnswer(blank(), 9));
  edit((input) => {
    input.play.currency.gp = 5;
  });
  await (
    await next("save")
  ).answer(
    answer({
      status: "conflict",
      message: "The character changed in another session. Reload before editing the same values.",
      revision: 10,
    }),
  );
  assert.equal(session.state.blocked, true);
  assert.equal(session.state.saved?.state, undefined);
  assert.equal(session.state.input.play.currency.gp, 5);
});

void test("a save the rules refuse keeps the edits and names what blocks it", async (t) => {
  const { session, next, edit, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  edit((input) => {
    input.build.baseScores["STR"] = 18;
  });
  const message = "Allocate 27 ability points; currently 30.";
  const refusal = evaluation(session.state.input, {
    saveIssues: [{ id: "point-buy", severity: "blocker", message, target: "abilities" }],
  });
  await (
    await next("save")
  ).answer(
    answer({
      status: "invalid",
      message: "This change is outside the character rules.",
      revision: 3,
      state: saved(blank()),
      evaluation: refusal,
      policy,
    }),
  );
  assert.equal(session.state.blocked, true);
  assert.equal(session.state.dirty, true);
  assert.equal(session.state.message, "This change is outside the character rules.");
  assert.deepEqual(session.state.saveIssues, [message]);
  assert.deepEqual(session.state.ruleNotes, [{ message, target: "abilities" }]);
  assert.equal(session.state.evaluation, refusal);
  assert.equal(session.state.input.build.baseScores["STR"], 18);
});

for (const status of ["invalid", "too-large"] as const)
  void test(`a newer edit is saved automatically after an older save is ${status}`, async (t) => {
    const { session, next, edit, open, saves } = sheet(t);
    await open(savedAnswer(blank(), 3));
    const loaded = session.state.saved;
    edit((input) => {
      input.play.inventory = [
        {
          id: "rope",
          name: "Rope",
          quantity: 1,
          location: "carried",
          attuned: false,
          acquisition: "",
          notes: "x".repeat(300),
        },
      ];
    });
    const refused = await next("save");
    edit((input) => {
      required(input.play.inventory[0]).notes = "Fifty feet";
    });
    assert.equal(saves().length, 1);
    await refused.answer(
      answer({
        status,
        message:
          status === "invalid"
            ? "This change is outside the character rules."
            : "This character is 180001 bytes; the rules engine accepts at most 180000. Remove inventory entries or shorten item notes, then try again.",
        revision: 3,
        state: saved(blank()),
        ...(status === "invalid" ? { evaluation: evaluation(blank()), policy } : {}),
      }),
    );
    // A too-large request was never evaluated, so it reports nothing about the rules.
    if (status === "too-large") assert.equal(session.state.saved, loaded);
    const corrected = await next("save");
    assert.equal(corrected.request.inputs?.play.inventory[0]?.notes, "Fifty feet");
    await corrected.answer(savedAnswer(required(corrected.request.inputs), 4));
    assert.equal(session.state.blocked, false);
    assert.equal(session.state.dirty, false);
    assert.deepEqual(session.state.saveIssues, []);
    assert.equal(session.state.message, "Saved");
  });

void test("changed rules hold edits and DM grant changes until adoption saves them", async (t) => {
  const { session, next, edit, open } = sheet(t);
  const start = edited((input) => {
    input.grants = [grant("blessing")];
  });
  const dm = { actorId: "dm-one", role: "dm" };
  await open(savedAnswer(start, 3, dm));
  const rulesChanged = (inputs: Inputs): Response =>
    answer({
      ...dm,
      status: "rules-changed",
      message: "Rules or allowed sources changed. Review and explicitly adopt this rules revision.",
      revision: 3,
      rulesChanged: true,
      state: saved(start),
      evaluation: evaluation(inputs),
      policy,
    });
  edit((input) => {
    input.play.currency.gp = 2;
  });
  await (await next("save")).answer(rulesChanged(session.state.input));
  assert.equal(session.state.blocked, true);
  assert.equal(session.state.saved?.rulesChanged, true);

  // A grant the new rules reject can still be revoked; it joins the pending edits.
  assert.equal(changeGrant(session.state.input, "blessing"), true);
  session.changed();
  t.mock.timers.tick(250);
  const held = await next("save");
  assert.equal(held.request.operation, "build");
  assert.deepEqual(held.request.inputs?.grants, []);
  await held.answer(rulesChanged(required(held.request.inputs)));
  assert.equal(session.state.dirty, true);

  // Adoption saves the pending edits with the rules; no autosave runs first.
  const request: CharacterRequest = {
    ...session.request("adopt-rules"),
    inputs: structuredClone(session.state.input),
    adoptRules: true,
  };
  assert.equal(await session.ready(request), "");
  const adopting = session.send(request, "adopt-rules");
  const adoption = await next("save");
  assert.equal(adoption.request.operation, "adopt-rules");
  assert.equal(adoption.request.adoptRules, true);
  assert.equal(adoption.request.expectedRevision, 3);
  assert.deepEqual(adoption.request.inputs?.grants, []);
  assert.equal(adoption.request.inputs?.play.currency.gp, 2);
  const withdrawn = [{ path: "/inputs/build/choices/feat", before: "alert", after: null }];
  await adoption.answer(
    savedAnswer(required(adoption.request.inputs), 4, { ...dm, message: "Saved", withdrawn }),
  );
  assert.equal(await adopting, true);
  assert.deepEqual(session.state.withdrawn, withdrawn);
  assert.equal(session.state.message, "Saved");
  assert.equal(session.state.saved?.rulesChanged, false);
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.blocked, false);
  assert.equal(session.state.command, undefined);
});

void test("a lost adoption reply pauses other actions and retries the exact adoption", async (t) => {
  const { session, events, next, open, saves } = sheet(t);
  await open(savedAnswer(blank(), 3, { rulesChanged: true }));
  const request: CharacterRequest = {
    ...session.request("adopt-rules"),
    inputs: structuredClone(session.state.input),
    adoptRules: true,
  };
  assert.equal(await session.ready(request), "");
  const sending = session.send(request);
  const lost = await next("save");
  await lost.fail(Object.assign(new Error("Gateway timeout"), { status: 504 }));
  assert.equal(await sending, false);
  assert.equal(session.state.command?.retry, true);
  assert.equal(session.state.message, "The action's outcome could not be confirmed.");
  assert.ok(events.includes("focus-status"));
  assert.equal(
    await session.ready({
      ...session.request("play"),
      change: { operation: "rest", rest: "short" },
    }),
    "An earlier action may already be saved. Resolve its outcome before starting another.",
  );

  const retrying = session.resend();
  const retried = await next("save");
  assert.deepEqual(retried.request, lost.request);
  await retried.answer(
    answer({ revision: 4, state: saved(blank(), required(lost.request.operationId)) }),
  );
  // A receipt carries no rules results, so the guidance is read again.
  await (await next("load")).answer(savedAnswer(blank(), 4));
  assert.equal(await retrying, true);
  assert.equal(session.state.message, "Saved");
  assert.equal(session.state.command, undefined);
  assert.equal(saves().length, 2);
});

void test("a play action the rules refuse saves nothing and marks its control", async (t) => {
  const { session, next, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  const sending = session.send(
    { ...session.request("play"), change: { operation: "rest", rest: "short" } },
    "rest/finish",
  );
  await (
    await next("save")
  ).answer(
    answer({
      status: "invalid",
      message: "No Hit Point Dice remain.",
      revision: 3,
      state: saved(blank()),
    }),
  );
  assert.equal(await sending, false);
  assert.equal(session.state.command, undefined);
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.message, "No Hit Point Dice remain.");
  assert.deepEqual(session.state.ruleNotes, [
    { message: "No Hit Point Dice remain.", focusKey: "rest/finish" },
  ]);
});

void test("an approved import commits its exact review and retries without a new preview", async (t) => {
  const { session, calls, next, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  const imported = edited((input) => {
    input.play.currency.pp = 4;
  });
  const request: CharacterRequest = {
    ...session.request("import"),
    inputs: imported,
    reauthorizeGrants: false,
  };
  let review: Response | undefined;
  const previewing = session.preview(request, (value) => {
    review = value;
  });
  const preview = await next("preview");
  assert.equal(preview.request.expectedRevision, 3);
  await preview.answer(
    answer({
      revision: 3,
      state: saved(blank()),
      evaluation: evaluation(imported),
      token: "approved-review",
      changes: [],
    }),
  );
  assert.deepEqual(await previewing, []);

  const committing = session.commit(request, required(review));
  const lost = await next("commit");
  assert.deepEqual(lost.request, {
    key: "hero",
    expectedRevision: 3,
    operationId: request.operationId,
    token: "approved-review",
  });
  await lost.fail(new Error("The network connection was lost."));
  assert.equal(await committing, false);
  assert.equal(session.state.command?.method, "commit");

  const retrying = session.resend();
  const retried = await next("commit");
  assert.deepEqual(retried.request, lost.request);
  await retried.answer(savedAnswer(imported, 4));
  assert.equal(await retrying, true);
  assert.deepEqual(session.state.input, imported);
  assert.equal(session.state.message, "Saved");
  assert.equal(calls.filter((call) => call.method === "preview").length, 1);
});

void test("an import review that expired or was overtaken ends without saving", async (t) => {
  const { session, next, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  const review = answer({ revision: 3, state: saved(blank()), token: "approved-review" });
  const request: CharacterRequest = { ...session.request("import"), inputs: blank() };

  const expiring = session.commit(request, review);
  await (
    await next("commit")
  ).fail(Object.assign(new Error("Review again."), { status: 409, code: "CONFLICT" }));
  assert.equal(await expiring, false);
  assert.equal(session.state.command, undefined);
  assert.equal(
    session.state.message,
    "This review is no longer valid. Check the saved character before reviewing another import.",
  );

  const overtaking = session.commit(request, review);
  const other = edited((input) => {
    input.play.currency.cp = 3;
  });
  await (
    await next("commit")
  ).answer(
    answer({
      status: "conflict",
      message: "The character changed since this review.",
      revision: 5,
      state: saved(other),
    }),
  );
  // The sheet re-reads the saved character instead of rebasing the import.
  await (await next("load")).answer(savedAnswer(other, 5));
  assert.equal(await overtaking, false);
  assert.equal(session.state.command, undefined);
  assert.deepEqual(session.state.input, other);
  assert.equal(
    session.state.message,
    "This character changed in another session. The sheet now shows the saved character; repeat the action if it is still needed.",
  );
});

void test("answers that arrive after the view changed are ignored", async (t) => {
  const { session, events, next, edit, open } = sheet(t);
  await open(savedAnswer(blank(), 3));
  edit((input) => {
    input.play.currency.gp = 5;
  });
  const save = await next("save");
  session.reset();
  const seen = events.length;
  await save.answer(savedAnswer(required(save.request.inputs), 4));
  assert.equal(session.state.saved, undefined);
  assert.equal(session.state.saving, false);
  assert.equal(events.length, seen);
});

void test("a view's reads stop when it ends, but its saves never do", async (t) => {
  const { session, next, edit, open } = sheet(t);
  const view = await open(savedAnswer(blank(), 3));
  assert.equal(view.signal.aborted, false);
  const refreshing = session.refresh();
  const read = await next("load");
  assert.equal(read.signal, view.signal);
  edit((input) => {
    input.play.currency.gp = 5;
  });
  const save = await next("save");
  assert.equal(save.signal, undefined);

  // Another character is shown: the old view's reads and catalog fetches stop.
  session.reset();
  assert.equal(view.signal.aborted, true);
  await read.fail(new DOMException("This operation was aborted", "AbortError"));
  await refreshing;
  assert.equal(session.state.saved, undefined);
  assert.equal(session.begin("villain").signal.aborted, false);

  // A read of a view that left the page stops too.
  session.connect(undefined);
  const reopened = session.begin("hero");
  const reading = session.guard(async () => {
    await session.read();
  });
  const reread = await next("load");
  const message = session.state.message;
  session.disconnect();
  assert.equal(reread.signal?.aborted, true);
  assert.equal(reopened.current(), false);
  await reread.fail(new DOMException("This operation was aborted", "AbortError"));
  await reading;
  // The stopped read reports nothing.
  assert.equal(session.state.message, message);
});

void test("pending edits handed over by the host return with their unanswered save", async (t) => {
  const first = sheet(t);
  await first.open(savedAnswer(blank(), 3));
  first.edit((input) => {
    input.play.currency.gp = 5;
  });
  const lost = await first.next("save");
  await lost.fail(new Error("The network connection was lost."));
  const { pending } = first.session.checkpoint("builder", builder);
  first.session.disconnect();

  const second = sheet(t);
  second.session.connect(pending);
  // Until the next view reads it, the host keeps the handoff and its navigation guard.
  assert.deepEqual(second.session.checkpoint("sheet", builder), {
    dirty: true,
    saving: false,
    pending,
  });
  second.session.begin("hero");
  let tab = "";
  const reading = second.session.guard(async () => {
    tab = required((await second.session.read()).recovered).tab;
  });
  await (await second.next("load")).answer(savedAnswer(blank(), 3));
  await reading;
  assert.equal(tab, "builder");
  assert.equal(second.session.state.blocked, true);
  assert.equal(second.session.state.input.play.currency.gp, 5);
  assert.equal(
    second.session.state.message,
    "The character reconnected. Your pending changes are still on this page. Review them before retrying.",
  );
  const retrying = second.session.retry();
  const retried = await second.next("save");
  assert.deepEqual(retried.request, lost.request);
  await retried.answer(savedAnswer(required(lost.request.inputs), 4));
  await retrying;
  assert.equal(second.session.state.dirty, false);
  assert.equal(second.session.state.message, "Saved");
});
