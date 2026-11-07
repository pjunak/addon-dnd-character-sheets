import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explanationText,
  feedbackMessage,
  issueWording,
  responseWording,
  termLabel,
} from "#web/character-feedback";
import { builderLabel } from "#web/character-locale";
import { engineAddon } from "./support/translations.mts";

void test("the sheet's own save and review messages read in Czech", () => {
  for (const [source, expected] of [
    ["This change is outside the character rules.", "Tato změna neodpovídá pravidlům postavy."],
    [
      "This review expired or belongs to another session. Review again.",
      "Platnost této kontroly vypršela nebo patří jiné relaci. Proveďte kontrolu znovu.",
    ],
    [
      "Compatible rules are unavailable. The saved character remains readable, printable and exportable.",
      "Kompatibilní pravidla nejsou dostupná. Uloženou postavu lze nadále číst, tisknout a exportovat.",
    ],
  ] as const) {
    assert.equal(feedbackMessage(source, "cs"), expected);
    assert.equal(feedbackMessage(source, "en"), source);
  }
  for (const source of [
    "The character view changed. Try again.",
    "The import could not be reviewed.",
    "The current rules no longer allow these saved selections, so they were removed:",
    "The rules changed. Adopt them to save edits and use play actions.",
  ])
    assert.notEqual(feedbackMessage(source, "cs"), source, source);
});

void test("the worker's templated messages read in Czech with their values", () => {
  for (const [key, args, expected] of [
    [
      "This character is {0} bytes; the rules engine accepts at most {1}. Remove inventory entries or shorten item notes, then try again.",
      { "0": "180001", "1": "180000" },
      "Tato postava má 180001 bajtů; engine pravidel přijme nejvýše 180000. Odeberte položky z inventáře nebo zkraťte jejich poznámky a zkuste to znovu.",
    ],
    [
      "This character's saved snapshot would be {0} bytes; the storage limit is {1}. It keeps rules evidence for each referenced class, feat, spell and item, so remove entries the character no longer needs, then try again.",
      { "0": "251234", "1": "250000" },
      "Uložený snímek postavy by měl 251234 bajtů; limit úložiště je 250000. Snímek uchovává podklady pravidel pro každé použité povolání, odbornost, kouzlo a předmět, proto odeberte položky, které postava už nepotřebuje, a zkuste to znovu.",
    ],
  ] as const) {
    const wording = responseWording({
      message: "English",
      messageText: { text: "English", key, args },
    });
    assert.equal(feedbackMessage(wording, "cs"), expected);
  }
  assert.equal(responseWording({ message: "Saved" }), "Saved");
});

void test("Engine issues and refusals read through the Engine's catalog, names stay literal", () => {
  const name = "Mira {0} <em>Žár</em>\n$&";
  const waived = issueWording({
    message: `DM given: ${name} waives this requirement.`,
    messageKey: "DM given: {0} waives this requirement.",
    messageArgs: [name],
  });
  assert.deepEqual(waived, {
    text: `DM given: ${name} waives this requirement.`,
    key: "DM given: {0} waives this requirement.",
    addon: engineAddon,
    args: { "0": name },
  });
  assert.equal(
    feedbackMessage(waived, "cs"),
    `Udělení PJ: ${name} uděluje výjimku z tohoto požadavku.`,
  );
  assert.equal(feedbackMessage(waived, "en"), `DM given: ${name} waives this requirement.`);
  // A refused play change the worker forwards names the Engine's catalog.
  const refusal = responseWording({
    message: "Current HP cannot exceed the effective maximum (28).",
    messageText: {
      text: "Current HP cannot exceed the effective maximum (28).",
      key: "Current HP cannot exceed the effective maximum ({0}).",
      args: { "0": "28" },
      addon: engineAddon,
    },
  });
  assert.equal(
    feedbackMessage(refusal, "cs"),
    "Současné životy nesmí překročit výsledné maximum (28).",
  );
});

void test("unkeyed and unknown wording stays intact, never matched against catalogs", () => {
  // An Engine issue without a key repeats data; it is shown as given even when
  // it equals a catalog entry.
  assert.equal(
    feedbackMessage(issueWording({ message: "Proficiency bonus" }), "cs"),
    "Proficiency bonus",
  );
  for (const source of [
    "Provider says {0}: <img src=x> — no translation",
    "__proto__",
    "constructor",
    "",
  ]) {
    assert.equal(feedbackMessage(source, "cs"), source);
    assert.equal(feedbackMessage(source, "de"), source);
  }
  // A key the Engine's catalog lacks shows the English text.
  assert.equal(
    feedbackMessage(
      { text: "New Engine wording", key: "New Engine wording", addon: engineAddon },
      "cs",
    ),
    "New Engine wording",
  );
});

void test("Engine explanations and guidance read in Czech while names stay literal", () => {
  const explanation = explanationText(
    {
      label: "Spell save DC",
      labelKey: "Spell save DC",
      formula: "base + proficiency bonus + spellcasting ability modifier",
      formulaKey: "base + proficiency bonus + spellcasting ability modifier",
      value: 13,
      terms: [
        { label: "Proficiency bonus", labelKey: "Proficiency bonus", value: 2 },
        { label: "Ring of Protection", value: 1 },
        {
          label: "Coins (150 ÷ 50)",
          labelKey: "Coins ({0} ÷ {1})",
          labelArgs: ["150", "50"],
          value: 3,
        },
      ],
      sources: [],
    },
    "cs",
  );
  assert.equal(explanation.label, "SO záchranného hodu proti kouzlům");
  assert.equal(explanation.formula, "základ + zdatnostní bonus + oprava sesílací vlastnosti");
  assert.deepEqual(
    explanation.terms.map((term) => term.label),
    ["Zdatnostní bonus", "Ring of Protection", "Mince (150 ÷ 50)"],
  );
  assert.equal(explanation.value, 13);
  // The host's rule details accept only their own fields: no catalog keys.
  assert.deepEqual(Object.keys(explanation).sort(), [
    "formula",
    "label",
    "sources",
    "terms",
    "value",
  ]);
  assert.deepEqual(
    explanation.terms.map((term) => Object.keys(term).sort()),
    [
      ["label", "value"],
      ["label", "value"],
      ["label", "value"],
    ],
  );
  assert.equal(
    termLabel({ label: "CON saving throw", labelKey: "CON saving throw", value: 4 }, "cs"),
    "Odolnost: záchranný hod",
  );
  assert.equal(
    builderLabel(
      { label: "Choose Wizard subclass", labelKey: "Choose {0} subclass", labelArgs: ["Wizard"] },
      "cs",
    ),
    "Vybrat podtřídu: Wizard",
  );
  // A saved explanation from before the Engine keyed its wording stays English.
  assert.equal(
    explanationText(
      { label: "Spell save DC", formula: "x", value: 1, terms: [], sources: [] },
      "cs",
    ).label,
    "Spell save DC",
  );
});
