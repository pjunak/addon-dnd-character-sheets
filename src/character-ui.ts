import type { Explanation, Reference } from "./character-model.js";
import { object } from "./character-client.js";
import { translator } from "./character-locale.js";

export type Child = Node | string | number | undefined;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const child of children) if (child !== undefined) node.append(child instanceof Node ? child : String(child));
  return node;
}
export function builderTarget(id: string, node: HTMLElement): HTMLElement { node.dataset["builderTarget"] = id; return node; }
export function button(label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement {
  const node = el("button", label); node.type = "button"; node.disabled = disabled; node.addEventListener("click", () => { void action(); }); return node;
}
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = `character-control-${crypto.randomUUID()}`; const target = control.matches("input,select,textarea,button") ? control : control.querySelector<HTMLElement>("input,select,textarea,button") ?? control; target.id = id;
  const title = el("label", label); title.htmlFor = id;
  const wrapper = el("div", title, control); wrapper.className = "character-field"; wrapper.dataset["uiField"] = ""; wrapper.dataset["uiKey"] = label;
  if (help) { const hint = el("small", help); hint.id = `${id}-hint`; target.setAttribute("aria-describedby", hint.id); wrapper.append(hint); }
  return wrapper;
}
export function textInput(value: string, change: (value: string) => void, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const input = multiline ? el("textarea") : el("input"); input.value = value; input.maxLength = multiline ? 30000 : 300;
  input.addEventListener("input", () => change(input.value)); return input;
}
export function numberInput(value: number | undefined, change: (value: number | undefined) => void, min?: number, max?: number): HTMLInputElement {
  const input = el("input"); input.type = "number"; input.step = "1"; input.value = value === undefined ? "" : String(value);
  input.min = String(min ?? -1000000); input.max = String(max ?? 1000000);
  let accepted = input.value;
  input.addEventListener("input", () => { if (input.validity.valid) { accepted = input.value; change(input.value === "" ? undefined : input.valueAsNumber); } }); input.addEventListener("blur", () => { if (!input.validity.valid) input.value = accepted; }); return input;
}
// A completed edit may disable its own action. Keep keyboard position within
// the owning repeated row instead of dropping focus on the document body.
export function restoreControlFocus(target: HTMLElement | null | undefined): void {
  if (!target) return;
  target.focus({ preventScroll: true });
  if (document.activeElement === target || !target.matches(":disabled")) return;
  const controls = [...(target.closest("[data-focus-scope]")?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]") ?? [])];
  const index = controls.indexOf(target);
  for (const next of [...controls.slice(index + 1), ...controls.slice(0, index).reverse()]) {
    if (!next.getClientRects().length || next.matches(":disabled,[aria-disabled=true]") || next.closest("[inert]")) continue;
    next.focus({ preventScroll: true });
    if (document.activeElement === next) return;
  }
}
export interface Option { id: string; label: string; description?: string; disabled?: boolean }
export function select(value: string, options: readonly Option[], change: (value: string) => void, t = translator("en")): HTMLSelectElement {
  const node = el("select"); const blank = el("option", t("Choose…")); blank.value = ""; node.append(blank);
  for (const option of options) { const row = el("option", option.label); row.value = option.id; row.title = option.description ?? ""; row.disabled = option.disabled ?? false; node.append(row); }
  if (value && !options.some(option => option.id === value)) { const missing = el("option", t("{0} — unavailable; review required", [value])); missing.value = value; node.append(missing); }
  node.value = value; node.addEventListener("change", () => change(node.value)); return node;
}
export function checkbox(label: string, checked: boolean, change: (value: boolean) => void): HTMLElement {
  const input = el("input"); input.type = "checkbox"; input.checked = checked; input.addEventListener("change", () => change(input.checked)); return el("label", input, label);
}
export function panel(title: string, ...children: Child[]): HTMLElement { const node = el("section", el("h3", title), ...children); node.className = "character-panel"; return node; }
export function human(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(human).join(", ");
  return Object.entries(object(value)).map(([key, item]) => `${label(key)}: ${human(item)}`).join("; ");
}
export function label(value: string): string { return (value ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase()); }
export function rule(name: string, reference?: Reference, explanation?: Explanation, summary?: string): HTMLElement {
  const node = document.createElement("codex-addon-rule-details") as HTMLElement & { details: unknown };
  node.details = { label: name, ...(reference ? { reference } : {}), ...(explanation ? { explanation } : {}), ...(summary ? { summary } : {}) };
  // Readable text also provides a usable fallback before custom-element upgrade.
  node.textContent = name; return node;
}
export function download(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const link = el("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function styled<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = el(tag, ...children); node.className = className; return node;
}
export function signed(value: unknown): string { return typeof value === "number" ? `${value >= 0 ? "+" : ""}${value}` : "—"; }
export interface TabOption { id: string; label: string }
export function tabStrip(name: string, options: readonly TabOption[], active: string, change: (id: string) => void, prefix: string, orientation: "horizontal" | "vertical" = "horizontal"): HTMLElement {
  const nav = styled("nav", "codex-tab-strip"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", name); nav.setAttribute("aria-orientation", orientation);
  nav.dataset["uiTabs"] = "";
  options.forEach((option) => {
    const selected = option.id === active, item = button(option.label, () => change(option.id));
    item.className = `codex-tab${selected ? " is-active" : ""}`; item.id = `${prefix}-tab-${option.id}`;
    item.setAttribute("role", "tab"); item.setAttribute("aria-selected", String(selected)); item.setAttribute("aria-controls", `${prefix}-panel-${option.id}`); item.tabIndex = selected ? 0 : -1;
    nav.append(item);
  }); return nav;
}

const steppers = new WeakMap<HTMLElement, () => void>();
export function refreshSteppers(root: HTMLElement): void { for (const control of root.querySelectorAll<HTMLElement>("[data-stepper]")) steppers.get(control)?.(); }
export function stepper(value: () => number, change: (value: number) => void, min: number | (() => number), max: number | (() => number)): HTMLElement {
  const root = styled("div", "character-stepper"); root.dataset["stepper"] = "";
  const input = el("input"); input.type = "number"; input.readOnly = true;
  const low = (): number => typeof min === "function" ? min() : min, high = (): number => typeof max === "function" ? max() : max;
  const update = (amount: number): void => { const next = Math.max(low(), Math.min(high(), amount)); if (next !== value()) change(next); sync(); };
  const up = button("▴", () => update(value() + 1)), down = button("▾", () => update(value() - 1));
  up.setAttribute("aria-label", "Increase"); down.setAttribute("aria-label", "Decrease");
  const sync = (): void => { input.value = String(value()); input.min = String(low()); input.max = String(high()); up.disabled = value() >= high(); down.disabled = value() <= low(); };
  input.addEventListener("keydown", event => { if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return; event.preventDefault(); update(event.key === "Home" ? low() : event.key === "End" ? high() : value() + (event.key === "ArrowUp" ? 1 : -1)); });
  root.append(input, styled("div", "character-stepper-arrows", up, down)); steppers.set(root, sync); sync(); return root;
}

// The host owns combobox interaction; the native select owns the selected value.
export function combo(value: string, source: readonly Option[] | (() => readonly Option[]), change: (value: string) => void, t = translator("en")): HTMLElement {
  const options = (): readonly Option[] => typeof source === "function" ? source() : source;
  const root = styled("div", "character-combo"), control = select(value, options(), change, t);
  control.dataset["ui"] = "combobox"; root.append(control);
  if (typeof source === "function") root.addEventListener("focusin", () => {
    const selected = control.value, updated = select(selected, options(), () => undefined, t);
    control.replaceChildren(...updated.children); control.value = selected;
  });
  return root;
}
