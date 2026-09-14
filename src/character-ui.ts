import type { Explanation, Reference } from "./character-model.js";
import { object } from "./character-client.js";
import { translator } from "./character-locale.js";

export type Child = Node | string | number | undefined;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const child of children) if (child !== undefined) node.append(child instanceof Node ? child : String(child));
  return node;
}
export function button(label: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement {
  const node = el("button", label); node.type = "button"; node.disabled = disabled; node.addEventListener("click", () => { void action(); }); return node;
}
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = `character-control-${crypto.randomUUID()}`; control.id = id;
  const title = el("label", label); title.htmlFor = id;
  const wrapper = el("div", title, control); wrapper.className = "character-field";
  if (help) { const hint = el("small", help); hint.id = `${id}-hint`; control.setAttribute("aria-describedby", hint.id); wrapper.append(hint); }
  return wrapper;
}
export function textInput(value: string, change: (value: string) => void, multiline = false): HTMLInputElement | HTMLTextAreaElement {
  const input = multiline ? el("textarea") : el("input"); input.value = value; input.maxLength = multiline ? 30000 : 300;
  input.addEventListener("input", () => change(input.value)); return input;
}
export function numberInput(value: number | undefined, change: (value: number | undefined) => void, min?: number, max?: number): HTMLInputElement {
  const input = el("input"); input.type = "number"; input.step = "1"; input.value = value === undefined ? "" : String(value);
  if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max);
  input.addEventListener("input", () => { if (input.validity.valid) change(input.value === "" ? undefined : input.valueAsNumber); }); return input;
}
export interface Option { id: string; label: string }
export function select(value: string, options: readonly Option[], change: (value: string) => void, t = translator("en")): HTMLSelectElement {
  const node = el("select"); const blank = el("option", t("Choose…")); blank.value = ""; node.append(blank);
  for (const option of options) { const row = el("option", option.label); row.value = option.id; node.append(row); }
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
export function label(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase()); }
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
export function tabStrip(name: string, options: readonly TabOption[], active: string, change: (id: string) => void, prefix: string): HTMLElement {
  const nav = styled("nav", "codex-tab-strip"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", name);
  options.forEach((option, index) => {
    const selected = option.id === active, item = button(option.label, () => change(option.id));
    item.className = `codex-tab${selected ? " is-active" : ""}`; item.id = `${prefix}-tab-${option.id}`;
    item.setAttribute("role", "tab"); item.setAttribute("aria-selected", String(selected)); item.setAttribute("aria-controls", `${prefix}-panel-${option.id}`); item.tabIndex = selected ? 0 : -1;
    item.addEventListener("keydown", event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowRight" ? (index + 1) % options.length : event.key === "ArrowLeft" ? (index + options.length - 1) % options.length : -1;
      if (next < 0) return; event.preventDefault(); const id = options[next]!.id; change(id); document.getElementById(`${prefix}-tab-${id}`)?.focus();
    }); nav.append(item);
  }); return nav;
}
