import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseSync, Visitor, type CallExpression } from "oxc-parser";

const sources = new URL("../src/", import.meta.url);

/** Every `field(key, label, …)` call in the sheet's source, as written. */
async function fieldCalls(): Promise<{ file: string; key: string; label: string }[]> {
  const calls: { file: string; key: string; label: string }[] = [];
  for (const file of (await readdir(sources)).filter((name) => name.endsWith(".ts")).toSorted()) {
    const source = await readFile(new URL(file, sources), "utf8"),
      parsed = parseSync(file, source, { lang: "ts", sourceType: "module" });
    assert.deepEqual(parsed.errors, [], file);
    new Visitor({
      CallExpression(node: CallExpression) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "field") return;
        const [key, label] = node.arguments;
        assert.ok(key && label, file + ": field() needs a key and a label");
        calls.push({
          file,
          key: source.slice(key.start, key.end),
          label: source.slice(label.start, label.end),
        });
      },
    }).visit(parsed.program);
  }
  return calls;
}

// The host returns focus to the first field whose key matches. A key taken
// from label text changes with the language and repeats where labels repeat.
void test("every field key is built from IDs and fixed names, never from label text", async () => {
  const calls = await fieldCalls();
  assert.ok(calls.length > 40, "Expected the sheet's field() calls");
  const derived = calls.filter(({ key, label }) => key.includes("(") || key === label);
  assert.deepEqual(derived, []);
});
