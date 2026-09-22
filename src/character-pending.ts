import type { Inputs, Request, Response } from "./character-model.js";
import type { BuilderNavigation } from "./character-builder-nav.js";
import { object, parseCharacter } from "./character-client.js";

export type CharacterTab = "sheet" | "combat" | "spells" | "builder" | "tools";
export interface CommandAttempt { method: "save" | "commit"; request: Omit<Request, "contractVersion">; retry: boolean }
export interface SaveAttempt { request: Omit<Request, "contractVersion"> & { inputs: Inputs }; base: Inputs; version: number }
export interface CharacterPending {
  version: "character-pending.v1"; key: string; actorId: string; role: Response["role"];
  inputs: Inputs; base: Inputs; revision: number; dirty: boolean; changeVersion: number;
  tab: CharacterTab; builder: BuilderNavigation; attempt?: SaveAttempt; command?: CommandAttempt;
}

/** A host-owned, page-memory handoff; never a device draft or an SDK handle. */
export function readCharacterPending(value: unknown): CharacterPending {
  const row = object(value), attempt = object(row["attempt"]), command = object(row["command"]), builder = object(row["builder"]);
  const integer = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= 0;
  const input = (v: unknown): void => { parseCharacter(JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: v })); };
  const request = (v: unknown): void => {
    const r = object(v);
    if (r["key"] !== row["key"] || !integer(r["expectedRevision"]) || typeof r["operationId"] !== "string") throw new Error();
    if (r["inputs"] !== undefined) input(r["inputs"]);
  };
  try {
    if (row["version"] !== "character-pending.v1" || typeof row["key"] !== "string" ||
      typeof row["actorId"] !== "string" || !["dm", "player"].includes(String(row["role"])) ||
      !integer(row["revision"]) || !integer(row["changeVersion"]) || typeof row["dirty"] !== "boolean" ||
      !["sheet", "combat", "spells", "builder", "tools"].includes(String(row["tab"])) ||
      typeof builder["tab"] !== "string" || builder["tab"].length > 200 ||
      typeof builder["target"] !== "string" || typeof builder["open"] !== "boolean") throw new Error();
    input(row["inputs"]); input(row["base"]);
    if (row["attempt"] !== undefined) { request(attempt["request"]); input(object(attempt["request"])["inputs"]); input(attempt["base"]); if (!integer(attempt["version"])) throw new Error(); }
    if (row["command"] !== undefined) {
      if (!["save", "commit"].includes(String(command["method"])) || typeof command["retry"] !== "boolean") throw new Error();
      request(command["request"]);
    }
  } catch { throw new Error("Pending changes could not be restored by this version. Keep this page open and retry with a compatible add-on."); }
  return structuredClone(value) as CharacterPending;
}
