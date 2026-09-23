import { object } from "./character-client.js";
import { translator } from "./character-locale.js";
export function el(tag, ...children) {
    const node = document.createElement(tag);
    for (const child of children)
        if (child !== undefined)
            node.append(child instanceof Node ? child : String(child));
    return node;
}
export function builderTarget(id, node) { node.dataset["builderTarget"] = id; return node; }
export function button(label, action, disabled = false) {
    const node = el("button", label);
    node.type = "button";
    node.disabled = disabled;
    node.addEventListener("click", () => { void action(); });
    return node;
}
export function field(label, control, help) {
    const id = `character-control-${crypto.randomUUID()}`;
    const target = control.matches("input,select,textarea,button") ? control : control.querySelector("input,select,textarea,button") ?? control;
    target.id = id;
    const title = el("label", label);
    title.htmlFor = id;
    const wrapper = el("div", title, control);
    wrapper.className = "character-field";
    wrapper.dataset["uiField"] = "";
    wrapper.dataset["uiKey"] = label;
    if (help) {
        const hint = el("small", help);
        hint.id = `${id}-hint`;
        target.setAttribute("aria-describedby", hint.id);
        wrapper.append(hint);
    }
    return wrapper;
}
export function textInput(value, change, multiline = false) {
    const input = multiline ? el("textarea") : el("input");
    input.value = value;
    input.maxLength = multiline ? 30000 : 300;
    input.addEventListener("input", () => change(input.value));
    return input;
}
export function numberInput(value, change, min, max) {
    const input = el("input");
    input.type = "number";
    input.step = "1";
    input.value = value === undefined ? "" : String(value);
    input.min = String(min ?? -1000000);
    input.max = String(max ?? 1000000);
    let accepted = input.value;
    input.addEventListener("input", () => { if (input.validity.valid) {
        accepted = input.value;
        change(input.value === "" ? undefined : input.valueAsNumber);
    } });
    input.addEventListener("blur", () => { if (!input.validity.valid)
        input.value = accepted; });
    return input;
}
// A completed edit may disable its own action. Keep keyboard position within
// the owning repeated row instead of dropping focus on the document body.
export function restoreControlFocus(target) {
    if (!target)
        return;
    target.focus({ preventScroll: true });
    if (document.activeElement === target || !target.matches(":disabled"))
        return;
    const controls = [...(target.closest("[data-focus-scope]")?.querySelectorAll("button,input,select,textarea,a[href],[tabindex]") ?? [])];
    const index = controls.indexOf(target);
    for (const next of [...controls.slice(index + 1), ...controls.slice(0, index).reverse()]) {
        if (!next.getClientRects().length || next.matches(":disabled,[aria-disabled=true]") || next.closest("[inert]"))
            continue;
        next.focus({ preventScroll: true });
        if (document.activeElement === next)
            return;
    }
}
export function select(value, options, change, t = translator("en")) {
    const node = el("select");
    const blank = el("option", t("Choose…"));
    blank.value = "";
    node.append(blank);
    for (const option of options) {
        const row = el("option", option.label);
        row.value = option.id;
        row.title = option.description ?? "";
        row.disabled = option.disabled ?? false;
        node.append(row);
    }
    if (value && !options.some(option => option.id === value)) {
        const missing = el("option", t("{0} — unavailable; review required", [value]));
        missing.value = value;
        node.append(missing);
    }
    node.value = value;
    node.addEventListener("change", () => change(node.value));
    return node;
}
export function checkbox(label, checked, change) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => change(input.checked));
    return el("label", input, label);
}
export function panel(title, ...children) { const node = el("section", el("h3", title), ...children); node.className = "character-panel"; return node; }
export function human(value) {
    if (value === undefined || value === null)
        return "—";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return String(value);
    if (Array.isArray(value))
        return value.map(human).join(", ");
    return Object.entries(object(value)).map(([key, item]) => `${label(key)}: ${human(item)}`).join("; ");
}
export function label(value) { return (value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase()); }
export function rule(name, reference, explanation, summary) {
    const node = document.createElement("codex-addon-rule-details");
    node.details = { label: name, ...(reference ? { reference } : {}), ...(explanation ? { explanation } : {}), ...(summary ? { summary } : {}) };
    // Readable text also provides a usable fallback before custom-element upgrade.
    node.textContent = name;
    return node;
}
export function download(name, body) {
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = el("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function styled(tag, className, ...children) {
    const node = el(tag, ...children);
    node.className = className;
    return node;
}
export function signed(value) { return typeof value === "number" ? `${value >= 0 ? "+" : ""}${value}` : "—"; }
export function tabStrip(name, options, active, change, prefix, orientation = "horizontal") {
    const nav = styled("nav", "codex-tab-strip");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", name);
    nav.setAttribute("aria-orientation", orientation);
    nav.dataset["uiTabs"] = "";
    options.forEach((option) => {
        const selected = option.id === active, item = button(option.label, () => change(option.id));
        item.className = `codex-tab${selected ? " is-active" : ""}`;
        item.id = `${prefix}-tab-${option.id}`;
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(selected));
        item.setAttribute("aria-controls", `${prefix}-panel-${option.id}`);
        item.tabIndex = selected ? 0 : -1;
        nav.append(item);
    });
    return nav;
}
const steppers = new WeakMap();
export function refreshSteppers(root) { for (const control of root.querySelectorAll("[data-stepper]"))
    steppers.get(control)?.(); }
export function stepper(value, change, min, max) {
    const root = styled("div", "character-stepper");
    root.dataset["stepper"] = "";
    const input = el("input");
    input.type = "number";
    input.readOnly = true;
    const low = () => typeof min === "function" ? min() : min, high = () => typeof max === "function" ? max() : max;
    const update = (amount) => { const next = Math.max(low(), Math.min(high(), amount)); if (next !== value())
        change(next); sync(); };
    const up = button("▴", () => update(value() + 1)), down = button("▾", () => update(value() - 1));
    up.setAttribute("aria-label", "Increase");
    down.setAttribute("aria-label", "Decrease");
    const sync = () => { input.value = String(value()); input.min = String(low()); input.max = String(high()); up.disabled = value() >= high(); down.disabled = value() <= low(); };
    input.addEventListener("keydown", event => { if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
        return; event.preventDefault(); update(event.key === "Home" ? low() : event.key === "End" ? high() : value() + (event.key === "ArrowUp" ? 1 : -1)); });
    root.append(input, styled("div", "character-stepper-arrows", up, down));
    steppers.set(root, sync);
    sync();
    return root;
}
// The host owns combobox interaction; the native select owns the selected value.
export function combo(value, source, change, t = translator("en")) {
    const options = () => typeof source === "function" ? source() : source;
    const root = styled("div", "character-combo"), control = select(value, options(), change, t);
    control.dataset["ui"] = "combobox";
    root.append(control);
    if (typeof source === "function")
        root.addEventListener("focusin", () => {
            const selected = control.value, updated = select(selected, options(), () => undefined, t);
            control.replaceChildren(...updated.children);
            control.value = selected;
        });
    return root;
}
