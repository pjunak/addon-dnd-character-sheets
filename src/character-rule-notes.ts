import { styled } from "./character-ui.js";

/** A rules refusal shown next to what caused it. */
export interface RuleNote {
  readonly message: string;
  /** `data-focus-key` of the control that requested the refused action. */
  readonly focusKey?: string;
  /** Engine issue target, matched against `data-rules-target` on sheet sections. */
  readonly target?: string;
}

/** Names the engine issue targets (abilities, inventory, spells…) a section shows. */
export function rulesTarget<T extends HTMLElement>(node: T, ...targets: readonly string[]): T {
  node.dataset["rulesTarget"] = targets.join(" ");
  return node;
}

/**
 * Outlines each note's control or section and attaches a small floating note
 * whose reason appears on hover or keyboard focus. Notes never move focus;
 * a note without an anchor in the current view relies on the status message.
 */
export function showRuleNotes(
  root: ParentNode,
  notes: readonly RuleNote[],
  label: string,
  translate: (message: string) => string,
): void {
  notes.forEach((note, index) => {
    const anchors = note.focusKey
      ? [root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(note.focusKey)}"]`)]
      : note.target
        ? [
            ...root.querySelectorAll<HTMLElement>(
              `[data-rules-target~="${CSS.escape(note.target)}"]`,
            ),
          ]
        : [];
    const placed = anchors.filter((anchor): anchor is HTMLElement => anchor !== null);
    placed.forEach((anchor, position) => {
      const id = `dnd-rule-note-${index}-${position}`;
      const detail = styled("span", "dnd-rule-note-detail", translate(note.message));
      detail.id = id;
      detail.setAttribute("role", "tooltip");
      const badge = styled("span", "dnd-rule-note-label", label);
      badge.tabIndex = 0;
      badge.setAttribute("aria-describedby", id);
      const marker = styled("span", "dnd-rule-note", badge, detail);
      anchor.dataset["ruleIssue"] = "";
      anchor.setAttribute(
        "aria-describedby",
        [anchor.getAttribute("aria-describedby"), id].filter(Boolean).join(" "),
      );
      // A section shows the note under its heading; a control shows it beside itself.
      const heading = anchor.querySelector(":scope > h3, :scope > h2");
      if (anchor.dataset["rulesTarget"] === undefined) anchor.after(marker);
      else if (heading) heading.after(marker);
      else anchor.prepend(marker);
    });
  });
}
