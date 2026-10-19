import type { AddonContext, ServiceHandle } from "./sdk.js";
import {
  maxRequestBytes,
  type Inputs,
  type Request,
  type Response,
  type State,
} from "./character-model.js";

export const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export const newId = (): string => crypto.randomUUID();
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(object) : [];
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
export function blank(): Inputs {
  return {
    build: {
      method: "point-buy",
      baseScores: {},
      rolls: [],
      species: "",
      lineage: "",
      background: "",
      levels: [],
      subclasses: {},
      choices: [],
      spells: {
        cantrips: {},
        spellbook: {},
        grantChoices: {},
        castingAbilities: {},
        swaps: [],
        acquisitions: [],
      },
    },
    play: {
      rolls: [],
      hp: 0,
      temporaryHp: 0,
      inventory: [],
      currency: {},
      resourceUses: {},
      activeFeatures: {},
      preparedSpells: {},
      asOf: "",
    },
    grants: [],
  };
}
export interface CatalogRecord {
  kind: string;
  id: string;
  value: Record<string, unknown>;
}
const catalogIndexes = new WeakMap<readonly CatalogRecord[], ReadonlyMap<string, CatalogRecord>>();

/**
 * A catalog record by ID. Each loaded catalog is indexed once, so lists that
 * look up every row do not scan the whole catalog per row. Catalog arrays are
 * replaced, never changed, when rules data reloads.
 */
export function catalogRecord(
  catalog: readonly CatalogRecord[] | undefined,
  id: string | undefined,
): CatalogRecord | undefined {
  if (!catalog || id === undefined) return undefined;
  let index = catalogIndexes.get(catalog);
  if (!index) {
    const byId = new Map<string, CatalogRecord>();
    for (const record of catalog) if (!byId.has(record.id)) byId.set(record.id, record);
    catalogIndexes.set(catalog, (index = byId));
  }
  return index.get(id);
}

type Subscribe = NonNullable<AddonContext["data"]["subscribe"]>;

/** A character request; the client adds the contract version. */
export type CharacterRequest = Omit<Request, "contractVersion">;

export class CharacterClient {
  private readonly service: ServiceHandle;
  private readonly engine: ServiceHandle;
  readonly signal: AbortSignal;
  readonly subscribe: Subscribe;
  constructor(
    service: ServiceHandle,
    engine: ServiceHandle,
    signal: AbortSignal,
    subscribe: Subscribe,
  ) {
    this.service = service;
    this.engine = engine;
    this.signal = signal;
    this.subscribe = subscribe;
  }
  /** The activation's signal, or both it and `signal` when a caller can cancel earlier. */
  private until(signal: AbortSignal | undefined): AbortSignal {
    return signal ? AbortSignal.any([this.signal, signal]) : this.signal;
  }
  async call(method: string, request: CharacterRequest, signal?: AbortSignal): Promise<Response> {
    const result = await this.service.call<Response>(
      method,
      { ...request, contractVersion: "character.v3" },
      { deadlineMs: 30000, signal: this.until(signal) },
    );
    if (result.contractVersion !== "character-response.v3" || result.key !== request.key)
      throw new Error("The character service returned an incompatible response.");
    return result;
  }
  async catalog(kind: string, signal?: AbortSignal): Promise<CatalogRecord[]> {
    if (!this.engine.available) return [];
    const until = this.until(signal);
    const result: CatalogRecord[] = [];
    let cursor = "";
    do {
      const page = await this.engine.call<{ records: CatalogRecord[]; nextCursor?: string }>(
        "query-records",
        {
          contractVersion: "rules-engine-query.v1",
          kind,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        },
        { deadlineMs: 15000, signal: until },
      );
      result.push(...page.records);
      cursor = page.nextCursor ?? "";
      if (result.length > 20000)
        throw new Error("The rules catalog is too large to browse in this view.");
    } while (cursor);
    return result;
  }
}
export async function connectCharacter(context: AddonContext): Promise<CharacterClient> {
  const [service, engine] = await Promise.all([
    context.services.own("dnd5e.character", { signal: context.signal }),
    context.services.connect("dnd5e.rules-engine", {
      range: "^5.0.0",
      cardinality: "one",
      signal: context.signal,
    }),
  ]);
  if (!service.available) throw new Error("The character worker is unavailable.");
  const subscribe = context.data.subscribe;
  return new CharacterClient(
    service,
    engine,
    context.signal,
    // Without the host's live event stream, sheets refresh only when reopened.
    subscribe ? (listener, options) => subscribe(listener, options) : () => () => undefined,
  );
}

const transferLimit = 1000000;
export function exportCharacter(state: State): string {
  const body = JSON.stringify(
    {
      format: "dnd-character.v2",
      schemaVersion: "5.0.0",
      inputs: state.inputs,
      savedRules: state.rules,
      savedProjection: state.projection,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(body).length > transferLimit)
    throw new Error("This character exceeds the transfer limit.");
  return body;
}
export function parseCharacter(body: string): Inputs {
  if (new TextEncoder().encode(body).length > transferLimit)
    throw new Error("This character file exceeds the import limit.");
  const envelope = object(JSON.parse(body));
  if (
    envelope["format"] !== "dnd-character.v2" ||
    envelope["schemaVersion"] !== "5.0.0" ||
    Object.keys(envelope).some(
      (key) =>
        !["format", "schemaVersion", "inputs", "savedRules", "savedProjection"].includes(key),
    )
  )
    throw new Error("Choose a current character export.");
  const input = object(envelope["inputs"]);
  if (!input["build"] || !input["play"] || !Array.isArray(input["grants"]))
    throw new Error("The character export is incomplete.");
  if (new TextEncoder().encode(JSON.stringify(input)).length > maxRequestBytes)
    throw new Error("The character inputs exceed the import limit.");
  return input as unknown as Inputs;
}

// Saved state and local edits can list the same object keys in different
// orders (the worker uses Go field order), so compare values, not key order.
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys);
}
function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

// Rebase independent edits only. Arrays (ordered levels, choices, inventory) are
// atomic so concurrent edits to the same collection never silently overwrite.
export function mergeCharacter(base: Inputs, local: Inputs, remote: Inputs): Inputs | undefined {
  const equal = sameValue;
  let conflict = false;
  const merge = (a: unknown, b: unknown, c: unknown): unknown => {
    if (equal(a, b)) return c;
    if (equal(a, c) || equal(b, c)) return b;
    if (
      [a, b, c].every(
        (value) => value !== null && typeof value === "object" && !Array.isArray(value),
      )
    ) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([
        ...Object.keys(object(a)),
        ...Object.keys(object(b)),
        ...Object.keys(object(c)),
      ])) {
        const value = merge(object(a)[key], object(b)[key], object(c)[key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflict = true;
    return b;
  };
  const result = merge(base, local, remote) as Inputs;
  return conflict ? undefined : result;
}

// Apply accepted choice withdrawals without resurrecting them when another
// choice changed during the save. Later authored replacements/removals win.
export function reconcileCharacterChoices(
  sent: Inputs["build"]["choices"],
  current: Inputs["build"]["choices"],
  saved: Inputs["build"]["choices"],
): Inputs["build"]["choices"] {
  const key = (choice: Inputs["build"]["choices"][number]): string =>
    JSON.stringify([choice.id, choice.slot]);
  const before = new Map(sent.map((choice) => [key(choice), choice])),
    accepted = new Map(saved.map((choice) => [key(choice), choice]));
  const result = current.flatMap((choice) => {
    if (!sameValue(choice, before.get(key(choice)))) return [choice];
    const corrected = accepted.get(key(choice));
    return corrected ? [corrected] : [];
  });
  const currentKeys = new Set(current.map(key));
  for (const choice of saved)
    if (!before.has(key(choice)) && !currentKeys.has(key(choice))) result.push(choice);
  return structuredClone(result);
}

export function reconcileCharacterMap<T>(
  sent: Record<string, T>,
  current: Record<string, T>,
  saved: Record<string, T>,
): void {
  const equal = sameValue;
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(sent, key) || !equal(current[key], sent[key])) continue;
    if (Object.hasOwn(saved, key)) current[key] = structuredClone(saved[key]!);
    else delete current[key];
  }
}

/**
 * Applies a saved answer's corrections to inputs edited since the save was
 * sent. Values edited meanwhile win, withdrawn selections stay withdrawn, and
 * the `build` and `play` objects stay in place for the fields bound to them.
 */
export function reconcileCharacter(sent: Inputs, current: Inputs, saved: Inputs): void {
  if (current.play.asOf === sent.play.asOf) current.play.asOf = saved.play.asOf;
  if (current.play.hp === sent.play.hp) current.play.hp = saved.play.hp;
  current.build.choices = reconcileCharacterChoices(
    sent.build.choices,
    current.build.choices,
    saved.build.choices,
  );
  // Maps the worker may withdraw entries from after a structural edit.
  for (const select of [
    (value: Inputs) => value.build.subclasses,
    (value: Inputs) => value.build.spells.cantrips,
    (value: Inputs) => value.build.spells.spellbook,
    (value: Inputs) => value.build.spells.grantChoices,
    (value: Inputs) => value.build.spells.castingAbilities,
    (value: Inputs) => value.play.preparedSpells,
    (value: Inputs) => value.play.resourceUses,
    (value: Inputs) => value.play.activeFeatures,
  ] as ((value: Inputs) => Record<string, unknown>)[])
    reconcileCharacterMap(select(sent), select(current), select(saved));
}
