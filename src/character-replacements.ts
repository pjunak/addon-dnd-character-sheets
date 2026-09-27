import type { BuildView } from "./character-build.js";
import { object, rows } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, combo, el, field, panel, rule } from "./character-ui.js";

// One shared view gathers a command; budgets and eligible options belong to rules.
export function classReplacements(view: BuildView, classId: string): HTMLElement[] {
  if (!view.act) return [];
  const t = translator(view.locale);
  return rows(view.evaluation?.guidance["classReplacements"])
    .filter((row) => row["classId"] === classId)
    .map((row) => {
      const kind = String(row["kind"]),
        key = String(row["key"]),
        source = object(row["source"]);
      const root = panel(t("Class-level replacement"));
      root.id = "character-replacement-" + encodeURIComponent(kind + "/" + key);
      root.dataset["focusScope"] = "";
      root.dataset["builderTarget"] = "class:" + classId;
      root.append(
        rule(String(row["name"]), { kind: String(source["kind"]), id: String(source["id"]) }),
      );
      root.append(
        el(
          "p",
          t("Class level {0} · {1} replacement remaining", [row["classLevel"], row["remaining"]]),
        ),
      );
      root.append(
        el(
          "p",
          t(
            "This uses the current class level's allowance. Resting or changing rules does not restore it.",
          ),
        ),
      );
      const controls = el("fieldset");
      controls.setAttribute("aria-label", t("Replace class choice"));
      controls.disabled =
        Number(row["remaining"]) < 1 || view.evaluation?.guidance["canSave"] !== true;
      const picked = rows(row["picked"]),
        candidates = rows(row["options"]);
      let out = "",
        ref = "";
      const apply = button(
        t("Replace class choice"),
        async () => {
          if (out && ref && out !== ref)
            await view.act!(
              { operation: "replace-class-choice", kind, key, out, ref },
              `Replace class choice ${out} with ${ref}`,
            );
        },
        true,
      );
      apply.dataset["focusKey"] = root.id + "/apply";
      const refresh = (): void => {
        apply.disabled = !out || !ref || out === ref;
      };
      const current = combo(
        "",
        picked.map((value) => ({ id: String(value["id"]), label: String(value["label"]) })),
        (value) => {
          out = value;
          refresh();
        },
        t,
      );
      current.dataset["focusKey"] = root.id + "/out";
      const replacement = combo(
        "",
        candidates.map((value) => ({ id: String(value["id"]), label: String(value["label"]) })),
        (value) => {
          ref = value;
          refresh();
        },
        t,
      );
      replacement.dataset["focusKey"] = root.id + "/in";
      controls.append(
        field(t("Current choice"), current),
        field(t("New choice"), replacement),
        apply,
      );
      root.append(controls);
      if (Number(row["remaining"]) < 1) {
        const spent = el("p", t("The replacement for this class level has been used."));
        spent.tabIndex = -1;
        spent.dataset["focusKey"] = root.id + "/spent";
        root.append(spent);
      } else if (!picked.length)
        root.append(
          el("p", t("Choose the class feature's initial selections before replacing one.")),
        );
      else if (!candidates.length) root.append(el("p", t("No eligible replacement is available.")));
      return root;
    });
}
