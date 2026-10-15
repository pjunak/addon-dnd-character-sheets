import type { Difference, Projection } from "./character-model.js";
import { translator } from "./character-locale.js";
import { el, human, label, rule, styled } from "./character-ui.js";

/** Stored keys such as "feat:magic-initiate@background%3Aguide:mi-spell" read as their last part. */
function pathPart(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed escape is shown as stored.
  }
  return label(decoded.split(/[:@]/u).at(-1) || decoded);
}

/** Render complete change groups from the coordinator's reviewed import. */
export function comparisonView(
  changes: readonly Difference[],
  projection?: Projection,
  locale = "en",
): HTMLElement {
  const t = translator(locale),
    root = el("div");
  if (!changes.length)
    root.append(el("p", t("These revisions have the same character values and rules.")));
  const groups = new Map<string, Difference[]>();
  for (const change of changes) {
    // Explanations/evidence can be inspected from the saved projection. Keep the
    // initial impact list focused on decisions, resulting values and rules.
    const parts = change.path.split("/").filter(Boolean);
    const group =
      parts[0] === "inputs"
        ? (parts[1] ?? "character")
        : parts[0] === "rules"
          ? "rules"
          : "calculated values";
    if (parts[0] === "projection" && parts[1] !== "sheet") continue;
    groups.set(group, [...(groups.get(group) ?? []), change]);
  }
  for (const [group, entries] of groups) {
    // Calculated values follow from the decisions above, so they start folded.
    const section = el(
      "details",
      el("summary", t(label(group)), " ", styled("span", "dnd-change-count", entries.length)),
    );
    section.open = group !== "calculated values";
    for (const change of entries) {
      const path = change.path.replace(/^\/(inputs|projection\/sheet|rules)(?:\/|$)/u, "");
      const explanation = change.path.startsWith("/projection/sheet/")
        ? projection?.explanations[path.replaceAll("/", ".")]
        : undefined;
      // Inside "Build" or "Play" the heading already names the first part.
      const parts = path.split("/").filter(Boolean);
      if (change.path.startsWith("/inputs/")) parts.shift();
      const title = parts.length
        ? parts.map((part) => t(pathPart(part))).join(" › ")
        : t(label(group));
      const heading = explanation ? rule(title, undefined, explanation) : el("span", title),
        before = human(change.before),
        after = human(change.after);
      // Short values read best on the same line; long ones open on demand.
      section.append(
        before.length <= 40 && after.length <= 40
          ? styled(
              "p",
              "dnd-change",
              heading,
              styled("span", "dnd-change-values", t("{0} → {1}", [before, after])),
            )
          : el(
              "details",
              el("summary", heading),
              el("p", t("Before: {0}", [before])),
              el("p", t("After: {0}", [after])),
            ),
      );
    }
    root.append(section);
  }
  return root;
}
