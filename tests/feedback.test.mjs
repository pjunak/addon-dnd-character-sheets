import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackMessage } from '../web/character-feedback.js';

test('save, review and provider failures retain their specific explanation in Czech', () => {
  for (const [source, expected] of [
    ['This change is outside the character rules.', 'Tato změna neodpovídá pravidlům postavy.'],
    ['No distinct options remain for another acquisition of this feat.', 'Pro další získání této odbornosti už nezbývá žádná odlišná možnost.'],
    ["This feat's repeatability rule is unsupported.", 'Pravidlo opakovaného získání této odbornosti není podporováno.'],
    ['Currency must use supported coins and non-negative amounts.', 'Použijte podporované mince a nezáporné částky.'],
    ['The prerequisite is not met.', 'Předpoklad není splněn.'],
    ['The selected option is not eligible for this choice.', 'Vybraná možnost není pro tuto volbu povolená.'],
    ['Only one item may occupy the shield slot.', 'Pozici štítu smí obsadit pouze jeden předmět.'],
    ['This review expired or belongs to another session. Review again.', 'Platnost této kontroly vypršela nebo patří jiné relaci. Proveďte kontrolu znovu.'],
    ['Compatible rules are unavailable. The saved character remains readable, printable and exportable.', 'Kompatibilní pravidla nejsou dostupná. Uloženou postavu lze nadále číst, tisknout a exportovat.'],
  ]) {
    assert.equal(feedbackMessage(source, 'cs'), expected);
    assert.equal(feedbackMessage(source, 'en'), source);
  }
});

test('rule feedback preserves engine values and performs no calculation', () => {
  for (const [source, expected] of [
    ['Choose between 1 and 30 ordered class levels.', 'Vyberte 1 až 30 seřazených úrovní povolání.'],
    ['Allocate 42 ability points; currently 43.', 'Rozdělte 42 bodů vlastností; nyní je rozděleno 43.'],
    ['Assign the ruleset standard array once each: [17 15 13 11 9 7].', 'Každou hodnotu standardní sady pravidel přiřaďte právě jednou: [17 15 13 11 9 7].'],
    ['Current HP must be between 0 and 17; review the required correction.', 'Současné životy musí být v rozmezí 0 až 17. Zkontrolujte nutnou opravu.'],
    ['Record 5 d8 and retain the highest 2 results without rerolling during recalculation.', 'Zaznamenejte 5 k8 a ponechte 2 nejvyšších výsledků. Při přepočtu neházejte znovu.'],
    ['Recorded hit die must be between 1 and 12.', 'Zaznamenaná kostka životů musí být v rozmezí 1 až 12.'],
    ['Current HP cannot exceed the effective maximum (28).', 'Současné životy nesmí překročit výsledné maximum (28).'],
    ['DEX must have a positive score and cap.', 'Vlastnost DEX musí mít kladnou hodnotu i limit.'],
    ['Attuned to more than 4 magic items (limit 4)', 'Sladěno s více než 4 kouzelnými předměty (limit 4)'],
  ]) assert.equal(feedbackMessage(source, 'cs'), expected);
});

test('feedback never interpolates or translates captured authored and source values', () => {
  const value = 'Saved and Mira {0} <em>Žár</em>\n$&';
  for (const [prefix, suffix, translatedPrefix, translatedSuffix] of [
    ['Conflicting DM replacement values: ', '', 'Rozporné náhradní hodnoty od PJ: ', ''],
    ['Resolve the spent resource against its current capacity: ', '', 'Upravte spotřebu zdroje podle jeho současné kapacity: ', ''],
    ['This prerequisite needs recorded DM adjudication: ', '', 'Tento předpoklad vyžaduje zaznamenané rozhodnutí PJ: ', ''],
    ['DM given: ', ' waives this requirement.', 'Udělení PJ: ', ' uděluje výjimku z tohoto požadavku.'],
    ['Spell ', ' is not eligible at its recorded gain at character level 7. Reorder level-granted spellbook choices or replace it.', 'Kouzlo ', ' nelze získat na zaznamenané úrovni postavy 7. Změňte pořadí kouzel do knihy získaných postupem na úroveň nebo kouzlo nahraďte.'],
  ]) assert.equal(feedbackMessage(prefix + value + suffix, 'cs'), translatedPrefix + value + translatedSuffix);
});

test('unknown, changed and oversized feedback remains intact, including literal placeholders', () => {
  for (const source of [
    'Provider says {0}: <img src=x> — no translation',
    'Current HP cannot exceed the effective maximum (28). More details: {1}',
    'prefix Allocate 42 ability points; currently 43.',
    'Resolve the spent resource against its current capacity: ' + 'Ž'.repeat(8192),
    '__proto__', 'constructor', '',
  ]) {
    assert.equal(feedbackMessage(source, 'cs'), source);
    assert.equal(feedbackMessage(source, 'en'), source);
    assert.equal(feedbackMessage(source, 'de'), source);
  }
});
