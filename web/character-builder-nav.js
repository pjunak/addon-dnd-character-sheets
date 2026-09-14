import { rows } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, human, styled, tabStrip } from "./character-ui.js";
export function builderShell(view, state, body, navigate) {
    const t = translator(view.locale), guidance = view.evaluation?.guidance ?? {}, rail = styled("details", "dse-build-rail");
    rail.open = state.open;
    rail.setAttribute("aria-label", t("Builder progress"));
    rail.addEventListener("toggle", () => { state.open = rail.open; });
    const progress = styled("progress", "dse-build-meter");
    progress.max = Number(guidance["total"]) || 1;
    progress.value = Number(guidance["complete"]) || 0;
    progress.setAttribute("aria-label", t("Builder completion"));
    rail.append(styled("summary", "dse-build-progress-head", el("span", t("Builder progress")), progress, el("strong", view.evaluation?.ready ? t("Complete") : t("{0} of {1} choices complete", [guidance["complete"] ?? 0, guidance["total"] ?? 0]))));
    for (const section of rows(guidance["sections"])) {
        const step = styled("section", "dse-build-step" + (section["complete"] === section["total"] ? " is-complete" : ""));
        step.append(styled("div", "dse-build-step-head", el("strong", t(String(section["id"]) === "foundation" ? "Character" : String(section["id"]) === "spells" ? "Spells" : "Levels")), el("span", human(section["complete"]) + "/" + human(section["total"]))));
        for (const issue of rows(section["issues"]))
            step.append(button(String(issue["label"]) + " →", () => navigate(String(issue["tab"]), String(issue["id"]))));
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
    return styled("div", "dse-builder-shell", rail, styled("div", "dse-builder-main", nav, body));
}
