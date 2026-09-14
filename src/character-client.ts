import type { AddonContext, ServiceHandle } from "./sdk.js";
import type { Inputs, Request, Response, State } from "./character-model.js";

export const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export const newId = (): string => crypto.randomUUID();
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export function blank(): Inputs {
  return { build: { method: "point-buy", baseScores: {}, rolls: [], species: "", lineage: "", background: "", levels: [], subclasses: {}, choices: [], spells: { cantrips: {}, spellbook: {}, grantChoices: {}, castingAbilities: {}, swaps: [], acquisitions: [] } }, play: { rolls: [], hp: 0, temporaryHp: 0, inventory: [], currency: {}, resourceUses: {}, activeFeatures: {}, preparedSpells: {}, asOf: "" }, grants: [], notes: "" };
}
export interface CatalogRecord { kind: string; id: string; value: Record<string, unknown> }
export class CharacterClient {
  constructor(private readonly service: ServiceHandle, private readonly providerId: string, private readonly engine: ServiceHandle, readonly signal: AbortSignal, readonly subscribe: AddonContext["data"]["subscribe"]) {}
  async call(method: string, request: Omit<Request, "contractVersion">): Promise<Response> {
    const result = await this.service.call<Response>(method, { ...request, contractVersion: "character.v2" }, { providerAddonId: this.providerId, deadlineMs: 30000, signal: this.signal });
    if (result.contractVersion !== "character-response.v2" || result.key !== request.key) throw new Error("The character service returned an incompatible response.");
    return result;
  }
  async catalog(kind: string): Promise<CatalogRecord[]> {
    if (!this.engine.available) return [];
    const result: CatalogRecord[] = []; let cursor = "";
    do {
      const page = await this.engine.call<{ records: CatalogRecord[]; nextCursor?: string }>("query-records", { contractVersion: "rules-engine-query.v1", kind, limit: 200, ...(cursor ? { cursor } : {}) }, { deadlineMs: 15000, signal: this.signal });
      result.push(...page.records); cursor = page.nextCursor ?? "";
      if (result.length > 20000) throw new Error("The rules catalog is too large to browse in this view.");
    } while (cursor);
    return result;
  }
}
export async function connectCharacter(context: AddonContext): Promise<CharacterClient> {
  const [service, engine] = await Promise.all([
    context.services.connect("dnd5e.character", { range: "^2.0.0", cardinality: "many", includeOwn: true, signal: context.signal }),
    context.services.connect("dnd5e.rules-engine", { range: "^4.0.0", cardinality: "one", signal: context.signal }),
  ]);
  if (!service.providers.some(provider => provider.addonId === context.addon.id)) throw new Error("The character worker is unavailable.");
  return new CharacterClient(service, context.addon.id, engine, context.signal, context.data.subscribe);
}

const transferLimit = 1000000;
export function exportCharacter(state: State): string {
 const body = JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: state.inputs, savedRules: state.rules, savedProjection: state.projection }, null, 2);
 if (new TextEncoder().encode(body).length > transferLimit) throw new Error("This character exceeds the transfer limit.");
 return body;
}
export function parseCharacter(body: string): Inputs {
 if (new TextEncoder().encode(body).length > transferLimit) throw new Error("This character file exceeds the import limit.");
 const envelope = object(JSON.parse(body));
 if (envelope["format"] !== "dnd-character.v1" || envelope["schemaVersion"] !== "4.0.0" || Object.keys(envelope).some(key => !["format", "schemaVersion", "inputs", "savedRules", "savedProjection"].includes(key))) throw new Error("Choose a current character export without history.");
 const input = object(envelope["inputs"]);
 if (!input["build"] || !input["play"] || !Array.isArray(input["grants"]) || typeof input["notes"] !== "string") throw new Error("The character export is incomplete.");
 if (new TextEncoder().encode(JSON.stringify(input)).length > 180000) throw new Error("The character inputs exceed the import limit.");
 return input as unknown as Inputs;
}

// Rebase independent edits only. Arrays (ordered levels, choices, inventory) are
// atomic so concurrent edits to the same collection never silently overwrite.
export function mergeCharacter(base: Inputs, local: Inputs, remote: Inputs): Inputs | undefined {
 const equal = (a: unknown,b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
 let conflict = false;
 const merge = (a: unknown,b: unknown,c: unknown): unknown => {
  if (equal(a,b)) return c;
  if (equal(a,c) || equal(b,c)) return b;
  if ([a,b,c].every(value => value !== null && typeof value === "object" && !Array.isArray(value))) {
   const result: Record<string,unknown> = {};
   for (const key of new Set([...Object.keys(object(a)),...Object.keys(object(b)),...Object.keys(object(c))])) {
    const value = merge(object(a)[key],object(b)[key],object(c)[key]); if (value !== undefined) result[key] = value;
   }
   return result;
  }
  conflict = true; return b;
 };
 const result = merge(base,local,remote) as Inputs;
 return conflict ? undefined : result;
}
