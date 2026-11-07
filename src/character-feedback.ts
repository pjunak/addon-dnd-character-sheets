import type { Explanation } from "./character-model.js";
import { abilityNames, translator } from "./character-locale.js";

// The rules engine writes English and keys only its builder guidance, so its
// messages, explanation labels and formulas are translated by their exact
// wording or by these templates. Captured names, source prose and IDs stay
// literal; a captured ability code shows as the ability's name.
const templates: readonly (readonly [string, RegExp])[] = [
  [
    "Choose between 1 and {0} ordered class levels.",
    /^Choose between 1 and (\d+) ordered class levels\.$/u,
  ],
  [
    "Allocate {0} ability points; currently {1}.",
    /^Allocate (\d+) ability points; currently (-?\d+)\.$/u,
  ],
  [
    "Assign the ruleset standard array once each: {0}.",
    /^Assign the ruleset standard array once each: (\[[\d -]+\])\.$/u,
  ],
  [
    "Current HP must be between 0 and {0}; review the required correction.",
    /^Current HP must be between 0 and (-?\d+); review the required correction\.$/u,
  ],
  [
    "Record {0} d{1} and retain the highest {2} results without rerolling during recalculation.",
    /^Record (\d+) d(\d+) and retain the highest (\d+) results without rerolling during recalculation\.$/u,
  ],
  [
    "Recorded hit die must be between 1 and {0}.",
    /^Recorded hit die must be between 1 and (\d+)\.$/u,
  ],
  [
    "Current HP cannot exceed the effective maximum ({0}).",
    /^Current HP cannot exceed the effective maximum \((-?\d+)\)\.$/u,
  ],
  [
    "Spell {0} is not eligible at its recorded gain at character level {1}. Reorder level-granted spellbook choices or replace it.",
    /^Spell (.+) is not eligible at its recorded gain at character level (\d+)\. Reorder level-granted spellbook choices or replace it\.$/su,
  ],
  [
    "{0} must have a positive score and cap.",
    /^(STR|DEX|CON|INT|WIS|CHA) must have a positive score and cap\.$/u,
  ],
  ["Conflicting DM replacement values: {0}", /^Conflicting DM replacement values: (.+)$/su],
  [
    "Resolve the spent resource against its current capacity: {0}",
    /^Resolve the spent resource against its current capacity: (.+)$/su,
  ],
  [
    "This prerequisite needs recorded DM adjudication: {0}",
    /^This prerequisite needs recorded DM adjudication: (.+)$/su,
  ],
  ["DM given: {0} waives this requirement.", /^DM given: (.+) waives this requirement\.$/su],
  [
    "Attuned to more than {0} magic items (limit {1})",
    /^Attuned to more than (\d+) magic items \(limit (\d+)\)$/u,
  ],
  [
    "This character is {0} bytes; the rules engine accepts at most {1}. Remove inventory entries or shorten item notes, then try again.",
    /^This character is (\d+) bytes; the rules engine accepts at most (\d+)\. Remove inventory entries or shorten item notes, then try again\.$/u,
  ],
  [
    "This character is {0} bytes; the rules engine accepts at most {1}. The saved character remains readable, printable and exportable.",
    /^This character is (\d+) bytes; the rules engine accepts at most (\d+)\. The saved character remains readable, printable and exportable\.$/u,
  ],
  [
    "This character's saved snapshot would be {0} bytes; the storage limit is {1}. It keeps rules evidence for each referenced class, feat, spell and item, so remove entries the character no longer needs, then try again.",
    /^This character's saved snapshot would be (\d+) bytes; the storage limit is (\d+)\. It keeps rules evidence for each referenced class, feat, spell and item, so remove entries the character no longer needs, then try again\.$/u,
  ],
  ["Copying this spell requires {0} GP.", /^Copying this spell requires (\d+(?:\.\d+)?) GP\.$/u],
  [
    "The class selection limit has been reached ({0}).",
    /^The class selection limit has been reached \((\d+)\)\.$/u,
  ],
  ["Only one item may occupy the {0} slot.", /^Only one item may occupy the (.+) slot\.$/su],
  [
    "{0} has no base weapon or armor or bonus to choose; clear its base and bonus.",
    /^(.+) has no base weapon or armor or bonus to choose; clear its base and bonus\.$/su,
  ],
  [
    "{0} has no base weapon or armor to choose; clear its base.",
    /^(.+) has no base weapon or armor to choose; clear its base\.$/su,
  ],
  ["Choose which weapon {0} is.", /^Choose which weapon (.+) is\.$/su],
  ["Choose which armor {0} is.", /^Choose which armor (.+) is\.$/su],
  ["No weapon in the rules data can be {0}.", /^No weapon in the rules data can be (.+)\.$/su],
  ["No armor in the rules data can be {0}.", /^No armor in the rules data can be (.+)\.$/su],
  [
    "{0} cannot be that weapon; choose one of its options.",
    /^(.+) cannot be that weapon; choose one of its options\.$/su,
  ],
  [
    "{0} cannot be that armor; choose one of its options.",
    /^(.+) cannot be that armor; choose one of its options\.$/su,
  ],
  ["Choose the bonus of {0}.", /^Choose the bonus of (.+)\.$/su],
  [
    "{0} does not offer that bonus; choose one of its options.",
    /^(.+) does not offer that bonus; choose one of its options\.$/su,
  ],
  ["Coins ({0} ÷ {1})", /^Coins \((\d+(?:\.\d+)?) ÷ (\d+(?:\.\d+)?)\)$/u],
  ["Capacity: Strength {0} × {1}", /^Capacity: Strength (\d+) × (\d+(?:\.\d+)?)$/u],
  ["{0} saving throw", /^(STR|DEX|CON|INT|WIS|CHA) saving throw$/u],
  ["{0} score", /^(STR|DEX|CON|INT|WIS|CHA) score$/u],
  ["{0} modifier", /^(STR|DEX|CON|INT|WIS|CHA) modifier$/u],
  ["{0} remaining", /^(.+) remaining$/su],
  [
    "each coin count × its value, divided by the value of one {0}",
    /^each coin count × its value, divided by the value of one (\w+)$/u,
  ],
];

export function feedbackMessage(message: string, locale: string): string {
  const t = translator(locale);
  const exact = t(message);
  if (exact !== message) return exact;
  // Unusually large diagnostics remain intact without running template matching.
  if (message.length > 8192) return message;
  for (const [key, pattern] of templates) {
    const match = pattern.exec(message);
    if (match)
      return t(
        key,
        match.slice(1).map((value) => {
          const name = abilityNames[value];
          return name === undefined ? value : t(name);
        }),
      );
  }
  return message;
}

/** An Engine explanation with its wording in the reader's language, for the host's rule details. */
export function explanationText(explanation: Explanation, locale: string): Explanation {
  const text = (value: string): string => (value ? feedbackMessage(value, locale) : value);
  return {
    ...explanation,
    label: text(explanation.label),
    formula: text(explanation.formula),
    ...(explanation.unit === undefined ? {} : { unit: text(explanation.unit) }),
    terms: explanation.terms.map((term) => ({ ...term, label: text(term.label) })),
  };
}
