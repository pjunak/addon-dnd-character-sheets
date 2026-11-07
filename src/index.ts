import { connectCharacter } from "./character-client.js";
import { defineCharacterElement } from "./character-element.js";
import { useTranslations } from "./character-locale.js";
import type { AddonContext, Disposable } from "./sdk.js";

export async function activate(context: AddonContext): Promise<Disposable> {
  context.capabilities.require("ui.contributions");
  context.capabilities.require("ui.controls.v1");
  context.capabilities.require("ui.markdown");
  context.capabilities.require("ui.i18n");
  context.signal.throwIfAborted();
  const client = await connectCharacter(context);
  context.signal.throwIfAborted();
  // A closed generation answers no more calls; its last views fall back to English.
  useTranslations(() => (context.signal.aborted ? undefined : context.i18n));
  const sheetElementTag = defineCharacterElement(
    context.addon.generation,
    client,
    (root) => context.ui.enhance(root),
    context.i18n,
  );
  const binding = context.ui.bind("sheet.section", { kind: "element", tag: sheetElementTag });
  let disposed = false;
  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      binding.dispose();
    },
  });
}
