import assert from "node:assert/strict";
import { test } from "node:test";
import { previewProblems } from "#web/character-comparison";
import type { Result } from "#web/character-model";

void test("an import preview that cannot be confirmed says why instead of offering a replacement", () => {
  assert.deepEqual(previewProblems({ status: "ready", message: "", token: "review" }), []);
  for (const [status, message] of [
    [
      "conflict",
      "The character changed in another session. Reload before editing the same values.",
    ],
    [
      "rules-changed",
      "Rules or allowed sources changed. Review and explicitly adopt this rules revision.",
    ],
    [
      "unavailable",
      "Compatible rules are unavailable. The saved character remains readable, printable and exportable.",
    ],
    [
      "too-large",
      "This character is 180001 bytes; the rules engine accepts at most 180000. Remove inventory entries or shorten item notes, then try again.",
    ],
  ] as const)
    assert.deepEqual(previewProblems({ status, message }), [message]);
  // A rules refusal lists what blocks it under the service's message.
  const evaluation = {
    guidance: {
      saveIssues: [
        { id: "unavailable-species", severity: "blocker", message: "Choose an available species." },
        { id: "note", severity: "warning", message: "Not a blocker." },
      ],
    },
    issues: [],
  } as unknown as Result;
  assert.deepEqual(
    previewProblems({
      status: "invalid",
      message: "This change is outside the character rules.",
      evaluation,
    }),
    ["This change is outside the character rules.", "Choose an available species."],
  );
  // Without a review token there is nothing to confirm.
  assert.deepEqual(previewProblems({ status: "ready", message: "" }), [
    "The import could not be reviewed.",
  ]);
});
