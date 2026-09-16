import { connectCharacter } from "./character-client.js";
import { defineCharacterElement } from "./character-element.js";
export async function activate(context) {
    context.capabilities.require("ui.contributions");
    context.capabilities.require("ui.controls.v1");
    context.signal.throwIfAborted();
    const client = await connectCharacter(context);
    context.signal.throwIfAborted();
    const sheetElementTag = defineCharacterElement(context.addon.generation, client, context.ui.enhance);
    const binding = context.ui.bind("sheet.section", { kind: "element", tag: sheetElementTag });
    let disposed = false;
    return Object.freeze({
        dispose() {
            if (disposed)
                return;
            disposed = true;
            binding.dispose();
        },
    });
}
