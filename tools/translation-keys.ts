import { parseSync, Visitor, type CallExpression, type Expression } from "oxc-parser";

function isTranslationCallee(callee: Expression): boolean {
  if (callee.type === "Identifier") return callee.name === "t";
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "ThisExpression" &&
    callee.property.type === "PrivateIdentifier" &&
    callee.property.name === "t"
  );
}

export function extractTranslationKeys(filename: string, source: string): readonly string[] {
  const parsed = parseSync(filename, source, { lang: "ts", sourceType: "module" });
  if (parsed.errors.length > 0) {
    const diagnostics = parsed.errors.map((error) => error.codeframe ?? error.message).join("\n");
    throw new Error(`Cannot parse ${filename} while extracting translations:\n${diagnostics}`);
  }

  const keys = new Set<string>();
  new Visitor({
    CallExpression(node: CallExpression) {
      if (!isTranslationCallee(node.callee)) return;
      const firstArgument = node.arguments[0];
      if (firstArgument?.type === "Literal" && typeof firstArgument.value === "string")
        keys.add(firstArgument.value);
    },
  }).visit(parsed.program);
  return [...keys].toSorted((left, right) => left.localeCompare(right));
}
