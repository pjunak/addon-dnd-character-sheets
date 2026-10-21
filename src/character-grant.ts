import type {
  Effect,
  EffectMode,
  EffectTarget,
  Grant,
  GrantCondition,
  Inputs,
  Result,
} from "./character-model.js";
import { translator } from "./character-locale.js";
import { abilities, object, rows, text, type CatalogRecord } from "./character-client.js";
import {
  button,
  combo,
  el,
  field,
  label,
  numberInput,
  panel,
  select,
  textInput,
} from "./character-ui.js";

/**
 * Revokes (without `amended`) or amends an existing DM grant in pending input,
 * moving its item link as the worker's grant commands do. While changed rules
 * wait for adoption, this is how a DM repairs a grant: the adoption saves it,
 * and the worker records who amended it and when.
 */
export function changeGrant(input: Inputs, id: string, amended?: Grant): boolean {
  const index = input.grants.findIndex((grant) => grant.id === id);
  if (index < 0) return false;
  if (amended) input.grants[index] = { ...structuredClone(amended), id };
  else input.grants.splice(index, 1);
  for (const item of input.play.inventory) {
    if (item.grantId === id) delete item.grantId;
    if (amended?.itemId && item.id === amended.itemId) item.grantId = id;
  }
  return true;
}

/**
 * The same typed contribution editor creates and amends character exceptions.
 * `submit` answers why the grant could not be applied, or "" when it was; the
 * form keeps the DM's input and shows the reason.
 */
export function grantForm(
  input: Inputs,
  evaluation: Result | undefined,
  feats: readonly CatalogRecord[],
  previous: Grant | undefined,
  submit: (grant: Grant) => Promise<string>,
  locale = "en",
): Node[] {
  const t = translator(locale);
  const grant: Grant = previous
    ? structuredClone(previous)
    : {
        id: "",
        name: "",
        reason: "",
        actorId: "",
        grantedAt: "",
        active: true,
        effectiveLevel: input.build.levels.length || 1,
        condition: "always",
        effects: [],
        waivers: [],
      };
  const effects = panel(t("Mechanical effects")),
    list = el("div");
  const renameEffects = (): void => {
    [...list.children].forEach((row, index) => {
      row.querySelector("h3")!.textContent = t("Effect {0}: {1}", [
        index + 1,
        t(label(grant.effects[index]!.target)),
      ]);
    });
  };
  const appendEffect = (effect: Effect): HTMLSelectElement => {
    const row = panel(""),
      identity = "grant-effect-" + crypto.randomUUID(),
      keySlot = el("div");
    const heading = row.querySelector("h3")!;
    heading.id = identity;
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", identity);
    const ownedField = (key: string, name: string, control: HTMLElement): HTMLElement =>
      field(identity + "/" + key, t(name), control);
    // Keep existing controls mounted. Updating one target must not replace every
    // row, lose its keyboard position, or reuse a sibling's enhancement identity.
    const renderKey = (): void => {
      const keys =
        effect.target.startsWith("ability") || effect.target === "savingThrow"
          ? [...abilities]
          : effect.target === "proficiency"
            ? [...abilities, ...Object.keys(object(evaluation?.sheet["skills"]))]
            : effect.target === "resourceMax"
              ? rows(evaluation?.sheet["resources"]).map((row) => String(row["key"]))
              : effect.target === "sense"
                ? ["darkvision", "blindsight", "tremorsense", "truesight"]
                : [];
      keySlot.replaceChildren();
      if (
        [
          "abilityScore",
          "abilityCap",
          "savingThrow",
          "proficiency",
          "resourceMax",
          "sense",
        ].includes(effect.target)
      ) {
        const key = select(
          effect.key ?? "",
          keys.map((id) => ({ id, label: t(label(id)) })),
          (value) => {
            effect.key = value;
          },
          t,
        );
        key.required = true;
        keySlot.append(ownedField("key", "Applies to", key));
      }
    };
    const target = select(
      effect.target,
      [
        "abilityScore",
        "abilityCap",
        "armorClass",
        "savingThrow",
        "initiative",
        "speed",
        "maxHp",
        "attunementLimit",
        "sense",
        "resourceMax",
        "proficiency",
      ].map((id) => ({ id, label: t(label(id)) })),
      (value) => {
        effect.target = value as EffectTarget;
        delete effect.key;
        renderKey();
        renameEffects();
      },
      t,
    );
    const mode = select(
      effect.mode,
      ["add", "set", "minimum", "maximum"].map((id) => ({ id, label: t(label(id)) })),
      (value) => {
        effect.mode = value as EffectMode;
      },
      t,
    );
    const amount = numberInput(effect.value, (value) => {
      effect.value = value ?? 0;
    });
    target.required = true;
    mode.required = true;
    amount.required = true;
    row.append(
      ownedField("target", "Effect", target),
      keySlot,
      ownedField("mode", "Operation", mode),
      ownedField("amount", "Amount", amount),
      button(t("Remove effect"), () => {
        const index = grant.effects.indexOf(effect);
        grant.effects.splice(index, 1);
        row.remove();
        renameEffects();
        const next = list.children[index] ?? list.children[index - 1];
        (next?.querySelector("select") ?? add).focus();
      }),
    );
    renderKey();
    list.append(row);
    renameEffects();
    return target;
  };
  const add = button(t("Add effect"), () => {
    const effect: Effect = { target: "maxHp", mode: "add", value: 0 };
    grant.effects.push(effect);
    appendEffect(effect).focus();
  });
  effects.append(
    el(
      "p",
      t(
        "Leave empty for a narrative reward. Typed effects participate in calculation and can be reversed.",
      ),
    ),
    list,
    add,
  );
  for (const effect of grant.effects) appendEffect(effect);
  const name = textInput(grant.name, (value) => {
    grant.name = value;
  });
  name.required = true;
  const reason = textInput(
    previous ? "" : grant.reason,
    (value) => {
      grant.reason = value;
    },
    true,
  );
  reason.required = true;
  if (previous) grant.reason = "";
  const level = numberInput(
    grant.effectiveLevel,
    (value) => {
      grant.effectiveLevel = value ?? 1;
    },
    1,
  );
  level.required = true;
  const condition = select(
    grant.condition,
    ["always", "equipped", "attuned"].map((id) => ({ id, label: t(label(id)) })),
    (value) => {
      grant.condition = value as GrantCondition;
    },
    t,
  );
  condition.required = true;
  const apply = button(t("Apply DM grant"), () => undefined);
  apply.type = "submit";
  const notice = el("p");
  notice.hidden = true;
  notice.tabIndex = -1;
  notice.dataset["uiState"] = "error";
  notice.setAttribute("role", "alert");
  const form = el(
    "form",
    field("grant/name", t("Name"), name),
    field("grant/reason", t(previous ? "Reason for amendment" : "Reason"), reason),
    field("grant/level", t("Effective character level"), level),
    effects,
    field(
      "grant/feat",
      t("Granted feat (optional)"),
      combo(
        grant.feat?.id ?? "",
        feats.map((record) => ({
          id: record.id,
          label: text(record.value["name"], record.id),
        })),
        (value) => {
          if (value) grant.feat = { kind: "feat", id: value };
          else delete grant.feat;
        },
        t,
      ),
    ),
    field(
      "grant/waivers",
      t("Exact prerequisite issue IDs to waive (comma-separated, optional)"),
      textInput(grant.waivers.join(", "), (value) => {
        grant.waivers = value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      }),
    ),
    field("grant/condition", t("Condition"), condition),
    field(
      "grant/item",
      t("Item instance"),
      combo(
        grant.itemId ?? "",
        input.play.inventory.map((item) => ({ id: item.id, label: item.name })),
        (value) => {
          if (value) grant.itemId = value;
          else delete grant.itemId;
        },
        t,
      ),
    ),
    field(
      "grant/expires",
      t("Expires at (RFC 3339, optional)"),
      textInput(grant.expiresAt ?? "", (value) => {
        grant.expiresAt = value;
      }),
    ),
    notice,
    apply,
  );
  // Native form validation focuses the missing field and retains the draft.
  // Mechanical validity and authorization still belong to the worker/engine.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    notice.hidden = true;
    void submit(grant).then((problem) => {
      if (!problem) return;
      notice.textContent = problem;
      notice.hidden = false;
      notice.focus();
    });
  });
  return [form];
}
