// The Compact HP field accepts a plain value or a short instruction:
// "-7" (damage), "+5" (heal) or "=30" (set). The rules apply damage and
// healing; this only reads what the player typed.
export interface HpEntry {
  kind: "set" | "damage" | "heal";
  amount: number;
  // A plain number is applied while typing; instructions wait for Enter.
  instruction: boolean;
}

export function parseHpEntry(raw: string): HpEntry | undefined {
  const match = /^([+\-=]?)\s*(\d{1,7})$/u.exec(raw.trim().replace(/^[−–]/u, "-"));
  if (!match) return undefined;
  const sign = match[1] ?? "";
  return {
    kind: sign === "-" ? "damage" : sign === "+" ? "heal" : "set",
    amount: Number(match[2]),
    instruction: sign !== "",
  };
}
