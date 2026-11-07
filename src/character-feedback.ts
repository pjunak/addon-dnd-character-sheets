import { text } from "./character-client.js";
import type { Explanation, Response, Term } from "./character-model.js";
import { engineWording, wordingText, type Wording } from "./character-locale.js";

// The rules engine keys its own wording in its message catalog; record names
// and other data it repeats stay literal. This add-on's own messages are keyed
// by their English wording, and the worker keys its templated ones.

/** A status, refusal or issue message in the view's language. */
export function feedbackMessage(message: Wording, locale: string): string {
  return wordingText(message, locale);
}

/** An Engine issue's message as wording. */
export function issueWording(issue: Record<string, unknown>): Wording {
  return engineWording(text(issue["message"]), issue["messageKey"], issue["messageArgs"]);
}

/** A character service answer's message, with its catalog key when it has one. */
export function responseWording(response: Pick<Response, "message" | "messageText">): Wording {
  return response.messageText ?? response.message;
}

/** An Engine explanation term's label in the view's language. */
export function termLabel(term: Term, locale: string): string {
  return wordingText(engineWording(term.label, term.labelKey, term.labelArgs), locale);
}

/**
 * An Engine explanation with its wording in the reader's language, for the
 * host's rule details. The host accepts only its own explanation fields, so
 * the catalog keys stay behind.
 */
export function explanationText(explanation: Explanation, locale: string): Explanation {
  const translate = (english: string, key?: string, args?: readonly string[]): string =>
    english ? wordingText(engineWording(english, key, args), locale) : english;
  return {
    label: translate(explanation.label, explanation.labelKey, explanation.labelArgs),
    formula: translate(explanation.formula, explanation.formulaKey, explanation.formulaArgs),
    value: explanation.value,
    ...(explanation.unit === undefined ? {} : { unit: explanation.unit }),
    ...(explanation.minimum === undefined ? {} : { minimum: explanation.minimum }),
    ...(explanation.maximum === undefined ? {} : { maximum: explanation.maximum }),
    terms: explanation.terms.map((term) => ({
      label: termLabel(term, locale),
      value: term.value,
      ...(term.source === undefined ? {} : { source: term.source }),
      ...(term.grantId === undefined ? {} : { grantId: term.grantId }),
      ...(term.status === undefined ? {} : { status: term.status }),
    })),
    sources: explanation.sources,
  };
}
