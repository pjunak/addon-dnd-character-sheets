import { catalogs } from "./character-messages.js";
import { translator } from "./character-locale.js";
// The current service returns readable messages rather than localization keys.
// Match only known complete wording; captured names, source prose and IDs stay literal.
const templates = [
    ["Choose between 1 and {0} ordered class levels.", /^Choose between 1 and (\d+) ordered class levels\.$/u],
    ["Allocate {0} ability points; currently {1}.", /^Allocate (\d+) ability points; currently (-?\d+)\.$/u],
    ["Assign the ruleset standard array once each: {0}.", /^Assign the ruleset standard array once each: (\[[\d -]+\])\.$/u],
    ["Current HP must be between 0 and {0}; review the required correction.", /^Current HP must be between 0 and (-?\d+); review the required correction\.$/u],
    ["Record {0} d{1} and retain the highest {2} results without rerolling during recalculation.", /^Record (\d+) d(\d+) and retain the highest (\d+) results without rerolling during recalculation\.$/u],
    ["Recorded hit die must be between 1 and {0}.", /^Recorded hit die must be between 1 and (\d+)\.$/u],
    ["Current HP cannot exceed the effective maximum ({0}).", /^Current HP cannot exceed the effective maximum \((-?\d+)\)\.$/u],
    ["Spell {0} is not eligible at its recorded gain at character level {1}. Reorder level-granted spellbook choices or replace it.", /^Spell (.+) is not eligible at its recorded gain at character level (\d+)\. Reorder level-granted spellbook choices or replace it\.$/su],
    ["{0} must have a positive score and cap.", /^(STR|DEX|CON|INT|WIS|CHA) must have a positive score and cap\.$/u],
    ["Conflicting DM replacement values: {0}", /^Conflicting DM replacement values: (.+)$/su],
    ["Resolve the spent resource against its current capacity: {0}", /^Resolve the spent resource against its current capacity: (.+)$/su],
    ["This prerequisite needs recorded DM adjudication: {0}", /^This prerequisite needs recorded DM adjudication: (.+)$/su],
    ["DM given: {0} waives this requirement.", /^DM given: (.+) waives this requirement\.$/su],
    ["Attuned to more than {0} magic items (limit {1})", /^Attuned to more than (\d+) magic items \(limit (\d+)\)$/u],
];
export function feedbackMessage(message, locale) {
    if (locale !== "cs")
        return message;
    const catalog = catalogs.cs;
    if (Object.hasOwn(catalog, message))
        return catalog[message];
    // Unusually large diagnostics remain intact without running template matching.
    if (message.length > 8192)
        return message;
    for (const [key, pattern] of templates) {
        const match = pattern.exec(message);
        if (match)
            return translator(locale)(key, match.slice(1));
    }
    return message;
}
