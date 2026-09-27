import assert from "node:assert/strict";
import test from "node:test";
import { extractTranslationKeys } from "../tools/translation-keys.ts";

void test("translation extraction reads real calls across formatting and string escapes", () => {
  const source = String.raw`
    const first = t("Simple label");
    const second = t(
      "Line one\nLine two",
      { count: 2 },
    );
    const continued = t("Continued \
label");
    class View {
      #t = (key: string) => key;
      render() {
        return this.#t('Character\'s choice');
      }
    }
  `;

  assert.deepEqual(extractTranslationKeys("character-example.ts", source), [
    "Character's choice",
    "Continued label",
    "Line one\nLine two",
    "Simple label",
  ]);
});

void test("translation extraction ignores comments, text, dynamic keys, and unrelated receivers", () => {
  const source = `
    // t("Comment only")
    const example = 'this.#t("String only")';
    object.t("Other object");
    this.t("Public member");
    t(dynamicKey);
    t(\`Template literal\`);
  `;

  assert.deepEqual(extractTranslationKeys("character-example.ts", source), []);
});

void test("translation extraction rejects malformed TypeScript instead of scanning partial text", () => {
  assert.throws(
    () => extractTranslationKeys("character-broken.ts", 't("Present"); const broken = {'),
    /Cannot parse character-broken\.ts while extracting translations/,
  );
});
