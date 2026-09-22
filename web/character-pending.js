import { object, parseCharacter } from "./character-client.js";
/** A host-owned, page-memory handoff; never a device draft or an SDK handle. */
export function readCharacterPending(value) {
    const row = object(value), attempt = object(row["attempt"]), command = object(row["command"]), builder = object(row["builder"]);
    const integer = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
    const input = (v) => { parseCharacter(JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: v })); };
    const request = (v) => {
        const r = object(v);
        if (r["key"] !== row["key"] || !integer(r["expectedRevision"]) || typeof r["operationId"] !== "string")
            throw new Error();
        if (r["inputs"] !== undefined)
            input(r["inputs"]);
    };
    try {
        if (row["version"] !== "character-pending.v1" || typeof row["key"] !== "string" ||
            typeof row["actorId"] !== "string" || !["dm", "player"].includes(String(row["role"])) ||
            !integer(row["revision"]) || !integer(row["changeVersion"]) || typeof row["dirty"] !== "boolean" ||
            !["sheet", "combat", "spells", "builder", "tools"].includes(String(row["tab"])) ||
            typeof builder["tab"] !== "string" || builder["tab"].length > 200 ||
            typeof builder["target"] !== "string" || typeof builder["open"] !== "boolean")
            throw new Error();
        input(row["inputs"]);
        input(row["base"]);
        if (row["attempt"] !== undefined) {
            request(attempt["request"]);
            input(object(attempt["request"])["inputs"]);
            input(attempt["base"]);
            if (!integer(attempt["version"]))
                throw new Error();
        }
        if (row["command"] !== undefined) {
            if (!["save", "commit"].includes(String(command["method"])) || typeof command["retry"] !== "boolean")
                throw new Error();
            request(command["request"]);
        }
    }
    catch {
        throw new Error("Pending changes could not be restored by this version. Keep this page open and retry with a compatible add-on.");
    }
    return structuredClone(value);
}
