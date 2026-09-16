import { rows } from "./character-client.js";
import { builderLabel, translator } from "./character-locale.js";
import { button, el, human, styled, tabStrip } from "./character-ui.js";
export function builderShell(view, state, body, navigate) {
    const t = translator(view.locale), guidance = view.evaluation?.guidance ?? {}, rail = styled("details", "dse-build-rail");
    rail.open = state.open;
    rail.setAttribute("aria-label", t("Builder progress"));
    rail.addEventListener("toggle", () => { if (rail.isConnected)
        state.open = rail.open; });
    const progress = styled("progress", "dse-build-meter");
    progress.max = Number(guidance["total"]) || 1;
    progress.value = Number(guidance["complete"]) || 0;
    progress.setAttribute("aria-label", t("Builder completion"));
    rail.append(styled("summary", "dse-build-progress-head", el("span", t("Builder progress")), progress, el("strong", view.evaluation?.ready ? t("Complete") : t("{0} of {1} choices complete", [guidance["complete"] ?? 0, guidance["total"] ?? 0]))));
    for (const section of rows(guidance["sections"])) {
        const step = styled("section", "dse-build-step" + (section["complete"] === section["total"] ? " is-complete" : ""));
        step.append(styled("div", "dse-build-step-head", el("strong", t(String(section["id"]) === "foundation" ? "Character" : String(section["id"]) === "spells" ? "Spells" : "Levels")), el("span", human(section["complete"]) + "/" + human(section["total"]))));
        for (const issue of rows(section["issues"]))
            step.append(button((issue["repair"] ? t("Review choice: {0}", [builderLabel(issue, view.locale)]) : builderLabel(issue, view.locale)) + " →", () => navigate(String(issue["tab"]), String(issue["id"]))));
        rail.append(step);
    }
    if (!rows(guidance["sections"]).length)
        rail.append(styled("section", "dse-build-step", el("p", t("Choose your origin, abilities and first class to start building."))));
    const classes = [...new Set(view.input.build.levels.map(level => level.classId))], tabs = [{ id: "character", label: t("Character") }, { id: "levels", label: t("Levels") }, ...classes.map(id => ({ id, label: String(view.catalogs.get("class")?.find(record => record.id === id)?.value["name"] ?? id) + " " + view.input.build.levels.filter(level => level.classId === id).length })), { id: "add-class", label: "+" }, { id: "spells", label: t("Spells") }, { id: "dm-given", label: t("DM given") }];
    const nav = tabStrip(t("Builder sections"), tabs, state.tab, id => navigate(id), "dnd-builder");
    nav.classList.add("dnd-builder-tabs");
    nav.querySelector("#dnd-builder-tab-add-class")?.setAttribute("aria-label", t("Add class"));
    body.id = "dnd-builder-panel-" + state.tab;
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", "dnd-builder-tab-" + state.tab);
    const main = styled("div", "dse-builder-main"), issues = rows(guidance["sections"]).flatMap(section => rows(section["issues"]));
    const next = issues.find(issue => issue["repair"]) ?? issues[0];
    if (next) {
        const action = button(t(next["repair"] ? "Review choice: {0}" : "Next choice: {0}", [builderLabel(next, view.locale)]), () => navigate(String(next["tab"]), String(next["id"])));
        action.className = "dse-builder-next";
        main.append(action);
    }
    main.append(nav, body);
    return styled("div", "dse-builder-shell", rail, main);
}
// Refresh the host controls before calling this: enhanced selects keep a hidden
// native value control, while keyboard focus belongs to the visible combobox.
export function focusBuilderTarget(root, target) {
    const node = root.querySelector('[data-builder-target="' + CSS.escape(target) + '"]')
        ?? root.querySelector("#character-choice-" + CSS.escape(encodeURIComponent(target)));
    if (!node)
        return;
    root.querySelector(".dnd-builder-tabs [aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const pending = node.querySelector("[data-builder-pending]") ?? node;
    for (let parent = pending; parent && parent !== root; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement)
            parent.open = true;
    const control = [...pending.querySelectorAll("input,select,textarea,button")]
        .find(element => !element.matches(":disabled,[hidden]") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const focus = control ?? pending;
    if (!control)
        focus.tabIndex = -1;
    focus.focus({ preventScroll: true });
    focus.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}
