import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterClient } from "#web/character-client";
import type { ServiceHandle } from "#web/sdk";
import { required } from "./support/helpers.mts";

/** A provider that answers at once and records each request's signal. */
function provider(answer: (params: Record<string, unknown>) => unknown) {
  const signals: (AbortSignal | undefined)[] = [];
  const handle = {
    contract: "test",
    range: "^1.0.0",
    cardinality: "one",
    providers: [],
    available: true,
    call: (_method: string, params: unknown, options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal);
      return Promise.resolve(answer(params as Record<string, unknown>));
    },
  } as unknown as ServiceHandle;
  return { handle, signals };
}

void test("a view's signal stops its character reads and catalog pages; saves keep running", async () => {
  const service = provider((params) => ({
    contractVersion: "character-response.v3",
    key: params["key"],
  }));
  const engine = provider(() => ({ records: [] }));
  const activation = new AbortController(),
    view = new AbortController();
  const client = new CharacterClient(
    service.handle,
    engine.handle,
    activation.signal,
    () => () => undefined,
  );
  await client.call("save", { key: "hero" });
  await client.call("load", { key: "hero" }, view.signal);
  await client.catalog("spell", view.signal);
  const save = required(service.signals[0]),
    read = required(service.signals[1]),
    catalog = required(engine.signals[0]);
  assert.equal(save, activation.signal);
  view.abort();
  assert.equal(read.aborted, true);
  assert.equal(catalog.aborted, true);
  assert.equal(save.aborted, false);

  // Ending the activation still stops a read whose view is open.
  const open = new AbortController();
  await client.catalog("feat", open.signal);
  activation.abort();
  assert.equal(required(engine.signals[1]).aborted, true);
  assert.equal(open.signal.aborted, false);
});
