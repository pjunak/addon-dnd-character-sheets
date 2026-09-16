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
        const result = await this.service.call(method, { ...request, contractVersion: "character.v2" }, { providerAddonId: this.providerId, deadlineMs: 30000, signal: this.signal });
        if (result.contractVersion !== "character-response.v2" || result.key !== request.key)
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
        context.services.connect("dnd5e.character", { range: "^2.0.0", cardinality: "many", includeOwn: true, signal: context.signal }),
        context.services.connect("dnd5e.rules-engine", { range: "^4.0.0", cardinality: "one", signal: context.signal }),
    ]);
    if (!service.providers.some(provider => provider.addonId === context.addon.id))
        throw new Error("The character worker is unavailable.");
    return new CharacterClient(service, context.addon.id, engine, context.signal, context.data.subscribe);
}
const transferLimit = 1000000;
export function exportCharacter(state) {
    const body = JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: state.inputs, savedRules: state.rules, savedProjection: state.projection }, null, 2);
    if (new TextEncoder().encode(body).length > transferLimit)
        throw new Error("This character exceeds the transfer limit.");
    return body;
}
export function parseCharacter(body) {
    if (new TextEncoder().encode(body).length > transferLimit)
        throw new Error("This character file exceeds the import limit.");
    const envelope = object(JSON.parse(body));
    if (envelope["format"] !== "dnd-character.v1" || envelope["schemaVersion"] !== "4.0.0" || Object.keys(envelope).some(key => !["format", "schemaVersion", "inputs", "savedRules", "savedProjection"].includes(key)))
        throw new Error("Choose a current character export without history.");
    const input = object(envelope["inputs"]);
    if (!input["build"] || !input["play"] || !Array.isArray(input["grants"]) || typeof input["notes"] !== "string")
        throw new Error("The character export is incomplete.");
    if (new TextEncoder().encode(JSON.stringify(input)).length > 180000)
        throw new Error("The character inputs exceed the import limit.");
    return input;
}
// Rebase independent edits only. Arrays (ordered levels, choices, inventory) are
// atomic so concurrent edits to the same collection never silently overwrite.
export function mergeCharacter(base, local, remote) {
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let conflict = false;
    const merge = (a, b, c) => {
        if (equal(a, b))
            return c;
        if (equal(a, c) || equal(b, c))
            return b;
        if ([a, b, c].every(value => value !== null && typeof value === "object" && !Array.isArray(value))) {
            const result = {};
            for (const key of new Set([...Object.keys(object(a)), ...Object.keys(object(b)), ...Object.keys(object(c))])) {
                const value = merge(object(a)[key], object(b)[key], object(c)[key]);
                if (value !== undefined)
                    result[key] = value;
            }
            return result;
        }
        conflict = true;
        return b;
    };
    const result = merge(base, local, remote);
    return conflict ? undefined : result;
}
// Apply accepted choice withdrawals without resurrecting them when another
// choice changed during the save. Later authored replacements/removals win.
export function reconcileCharacterChoices(sent, current, saved) {
    const key = (choice) => JSON.stringify([choice.id, choice.slot]);
    const before = new Map(sent.map(choice => [key(choice), choice])), accepted = new Map(saved.map(choice => [key(choice), choice]));
    const result = current.flatMap(choice => {
        if (JSON.stringify(choice) !== JSON.stringify(before.get(key(choice))))
            return [choice];
        const corrected = accepted.get(key(choice));
        return corrected ? [corrected] : [];
    });
    const currentKeys = new Set(current.map(key));
    for (const choice of saved)
        if (!before.has(key(choice)) && !currentKeys.has(key(choice)))
            result.push(choice);
    return structuredClone(result);
}
