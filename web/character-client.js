export const abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
export const newId = () => crypto.randomUUID();
export const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
export const rows = (value) => Array.isArray(value) ? value.map(object) : [];
export const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
export function blank() {
    return { build: { method: "point-buy", baseScores: {}, rolls: [], species: "", lineage: "", background: "", levels: [], subclasses: {}, choices: [], spells: { cantrips: {}, spellbook: {}, grantChoices: {}, castingAbilities: {}, swaps: [], acquisitions: [] } }, play: { rolls: [], hp: 0, temporaryHp: 0, inventory: [], currency: {}, resourceUses: {}, activeFeatures: {}, preparedSpells: {}, asOf: "" }, grants: [], notes: "" };
}
export class CharacterClient {
    service;
    providerId;
    engine;
    signal;
    subscribe;
    constructor(service, providerId, engine, signal, subscribe) {
        this.service = service;
        this.providerId = providerId;
        this.engine = engine;
        this.signal = signal;
        this.subscribe = subscribe;
    }
    async call(method, request) {
        const result = await this.service.call(method, { ...request, contractVersion: "character.v1" }, { providerAddonId: this.providerId, deadlineMs: 30000, signal: this.signal });
        if (result.contractVersion !== "character-response.v1" || result.key !== request.key)
            throw new Error("The character service returned an incompatible response.");
        return result;
    }
    async catalog(kind) {
        if (!this.engine.available)
            return [];
        const result = [];
        let cursor = "";
        do {
            const page = await this.engine.call("query-records", { contractVersion: "rules-engine-query.v1", kind, limit: 200, ...(cursor ? { cursor } : {}) }, { deadlineMs: 15000, signal: this.signal });
            result.push(...page.records);
            cursor = page.nextCursor ?? "";
            if (result.length > 20000)
                throw new Error("The rules catalog is too large to browse in this view.");
        } while (cursor);
        return result;
    }
}
export async function connectCharacter(context) {
    const [service, engine] = await Promise.all([
        context.services.connect("dnd5e.character", { range: "^1.0.0", cardinality: "many", includeOwn: true, signal: context.signal }),
        context.services.connect("dnd5e.rules-engine", { range: "^4.0.0", cardinality: "one", signal: context.signal }),
    ]);
    if (!service.providers.some(provider => provider.addonId === context.addon.id))
        throw new Error("The character worker is unavailable.");
    return new CharacterClient(service, context.addon.id, engine, context.signal, context.data.subscribe);
}
export class DraftStore {
    storage;
    key;
    constructor(actor, character, storage = localStorage) {
        this.storage = storage;
        this.key = `dnd-character-draft.v1:${location.origin}:${actor}:${character}`;
    }
    read() {
        const body = this.storage.getItem(this.key);
        if (body === null)
            return undefined;
        const value = JSON.parse(body);
        if (value.version !== 1 || !Number.isSafeInteger(value.baseRevision) || !value.inputs?.build || !value.inputs.play)
            throw new Error("The saved draft cannot be read. Export it before clearing local storage.");
        return value;
    }
    write(inputs, baseRevision) { this.storage.setItem(this.key, JSON.stringify({ version: 1, inputs, baseRevision, updatedAt: new Date().toISOString() })); }
    clear() { this.storage.removeItem(this.key); }
}
const transferLimit = 1000000;
export function exportCharacter(state, history) {
    const body = JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: state.inputs, savedRules: state.rules, savedProjection: state.projection, ...(history ? { externalHistory: history } : {}) }, null, 2);
    if (history && (history.length > 5 || new TextEncoder().encode(body).length > transferLimit))
        throw new Error("This history archive exceeds the transfer limit. Export fewer revisions; full installation backups retain all history.");
    return body;
}
// Imported snapshots are untrusted reference material, never a local audit or
// rules result. Keep the original transfer on this device until explicitly
// discarded, including when no provider can evaluate its mechanical inputs.
export class TransferStore {
    storage;
    key;
    constructor(actor, character, storage = localStorage) {
        this.storage = storage;
        this.key = `dnd-character-transfer.v1:${location.origin}:${actor}:${character}`;
    }
    read() { return this.storage.getItem(this.key) ?? ""; }
    write(body) { parseCharacter(body); this.storage.setItem(this.key, body); }
    clear() { this.storage.removeItem(this.key); }
}
export function externalHistory(body) {
    const value = object(JSON.parse(body))["externalHistory"];
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 5 || value.some(entry => {
        const row = object(entry), state = object(row["state"]);
        return !Number.isSafeInteger(row["revision"]) || Number(row["revision"]) < 1 || !["actorId", "occurredAt", "summary"].every(key => typeof row[key] === "string" && String(row[key]).length <= 1000) || state["schemaVersion"] !== "4.0.0";
    }))
        throw new Error("The external history archive is invalid or exceeds five revisions.");
    return value;
}
export function parseCharacter(body) {
    if (new TextEncoder().encode(body).length > 1000000)
        throw new Error("This character file exceeds the import limit.");
    const envelope = object(JSON.parse(body));
    if (envelope["format"] !== "dnd-character.v1" || envelope["schemaVersion"] !== "4.0.0" || Object.keys(envelope).some(key => !["format", "schemaVersion", "inputs", "savedRules", "savedProjection", "externalHistory"].includes(key)))
        throw new Error("Choose a current dnd-character.v1 export. Retired sheets and raw objects are not supported.");
    externalHistory(body);
    const input = object(envelope["inputs"]);
    if (!input["build"] || !input["play"] || !Array.isArray(input["grants"]) || typeof input["notes"] !== "string")
        throw new Error("The character export is incomplete.");
    if (new TextEncoder().encode(JSON.stringify(input)).length > 180000)
        throw new Error("The character inputs exceed the import limit.");
    return input; // Full closed-schema validation is server-owned.
}
