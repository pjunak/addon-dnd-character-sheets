export function required<T>(value: T | undefined, message = "Expected test fixture value"): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("Expected a JSON object");
  }
  return value;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a JSON array");
  return value;
}

export function storage(getItem: (key: string) => string | null): Storage {
  return {
    length: 0,
    clear() {},
    getItem,
    key() {
      return null;
    },
    removeItem() {},
    setItem() {},
  };
}
