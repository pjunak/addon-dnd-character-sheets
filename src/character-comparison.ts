import type { Difference, Projection } from "./character-model.js";
import { translator } from "./character-locale.js";
import { el, human, label, rule } from "./character-ui.js";

/** Both pending operations and retained revisions use the coordinator's diff. */
export function comparisonView(changes: readonly Difference[], projection?: Projection, locale = "en"): HTMLElement {
  const t = translator(locale), root = el("div");
  if (!changes.length) root.append(el("p", t("These revisions have the same character values and rules.")));
  const groups = new Map<string, Difference[]>();
  for (const change of changes) {
    // Explanations/evidence can be inspected from the saved projection. Keep the
    // initial impact list focused on decisions, resulting values and rules.
    const parts = change.path.split("/").filter(Boolean);
    const group = parts[0] === "inputs" ? parts[1]! : parts[0] === "rules" ? "rules" : "calculated values";
    if (parts[0] === "projection" && parts[1] !== "sheet") continue;
    groups.set(group, [...(groups.get(group) ?? []), change]);
  }
  for (const [group, entries] of groups) {
    const section = el("details", el("summary", t(label(group)))); section.open = true;
    for (const change of entries) {
      const path = change.path.replace(/^\/(inputs|projection\/sheet|rules)\//u, "");
      const explanation = change.path.startsWith("/projection/sheet/") ? projection?.explanations[path.replaceAll("/", ".")] : undefined;
      const title = path.split("/").map(part => t(label(part))).join(" › ");
      section.append(el("details", el("summary", explanation ? rule(title, undefined, explanation) : title),
        el("p", t("Before: {0}", [human(change.before)])), el("p", t("After: {0}", [human(change.after)]))));
    }
    root.append(section);
  }
  return root;
}
