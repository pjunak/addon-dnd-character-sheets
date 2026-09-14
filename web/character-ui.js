import { object } from "./character-client.js";
import { translator } from "./character-locale.js";
export function el(tag, ...children) {
    const node = document.createElement(tag);
    for (const child of children)
        if (child !== undefined)
            node.append(child instanceof Node ? child : String(child));
    return node;
}
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
export function tabStrip(name, options, active, change, prefix) {
    const nav = styled("nav", "codex-tab-strip");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", name);
    options.forEach((option, index) => {
        const selected = option.id === active, item = button(option.label, () => change(option.id));
        item.className = `codex-tab${selected ? " is-active" : ""}`;
        item.id = `${prefix}-tab-${option.id}`;
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(selected));
        item.setAttribute("aria-controls", `${prefix}-panel-${option.id}`);
        item.tabIndex = selected ? 0 : -1;
        item.addEventListener("keydown", event => {
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowRight" ? (index + 1) % options.length : event.key === "ArrowLeft" ? (index + options.length - 1) % options.length : -1;
            if (next < 0)
                return;
            event.preventDefault();
            const id = options[next].id;
            change(id);
            document.getElementById(`${prefix}-tab-${id}`)?.focus();
        });
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
// The text field filters options; only selecting an offered option changes data.
export function combo(value, source, change, t = translator("en")) {
    const root = styled("div", "character-combo"), input = el("input"), toggle = button("▾", () => show(""));
    const menu = styled("div", "character-combo-menu"), list = styled("div", "character-combo-options"), hint = styled("div", "character-option-hint");
    const options = () => typeof source === "function" ? source() : source;
    let selected = value, active = -1, shown = [];
    const id = `options-${newIdForControl()}`;
    list.id = id;
    list.setAttribute("role", "listbox");
    menu.hidden = true;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", id);
    input.autocomplete = "off";
    input.placeholder = t("Choose…");
    toggle.setAttribute("aria-label", t("Show options"));
    toggle.tabIndex = -1;
    hint.setAttribute("role", "tooltip");
    hint.id = id + "-hint";
    hint.hidden = true;
    const label = () => options().find(option => option.id === selected)?.label ?? selected;
    const close = () => { menu.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); input.value = label(); };
    const choose = (option) => { if (option.disabled)
        return; selected = option.id; close(); change(selected); input.focus(); };
    const highlight = (index) => {
        active = index;
        [...list.children].forEach((row, at) => { row.classList.toggle("is-active", at === active); });
        const option = shown[active], row = list.children[active];
        if (option && row) {
            input.setAttribute("aria-activedescendant", row.id);
            row.scrollIntoView({ block: "nearest" });
            hint.textContent = option.description ?? "";
            hint.hidden = !option.description;
        }
    };
    const show = (query) => {
        shown = options().filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        list.replaceChildren();
        hint.hidden = true;
        active = -1;
        shown.forEach((option, index) => {
            const row = el("div", option.label);
            row.id = id + "-" + index;
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(option.id === selected));
            row.setAttribute("aria-disabled", String(option.disabled ?? false));
            row.addEventListener("pointerdown", event => event.preventDefault());
            row.addEventListener("click", () => choose(option));
            row.addEventListener("pointerenter", () => highlight(index));
            if (option.description)
                row.setAttribute("aria-describedby", hint.id);
            list.append(row);
        });
        if (!shown.length)
            list.append(el("p", t("No available options")));
        menu.hidden = false;
        input.setAttribute("aria-expanded", "true");
    };
    input.value = label();
    input.addEventListener("input", () => show(input.value));
    input.addEventListener("click", () => { show(""); input.select(); });
    input.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            close();
            event.stopPropagation();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (menu.hidden)
                show("");
            highlight(Math.max(0, Math.min(shown.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter" && !menu.hidden) {
            event.preventDefault();
            const option = shown[active];
            if (option)
                choose(option);
        }
    });
    root.addEventListener("focusout", event => { if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget))
        close(); });
    menu.append(list, hint);
    root.append(input, toggle, menu);
    return root;
}
function newIdForControl() { return crypto.randomUUID(); }
