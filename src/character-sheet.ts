import type { Inputs, Item, Projection, Reference } from "./character-model.js";
import type { CatalogRecord } from "./character-client.js";
import { abilities, object, rows } from "./character-client.js";
import { translator } from "./character-locale.js";
import { button, el, field, human, label, numberInput, panel, rule, select, signed, styled, textInput } from "./character-ui.js";

export type Layout = "compact" | "classic";
export type EquipmentSlot = "armor" | "shield" | "worn" | "attuned";
export interface SheetView {
  locale: string; layout: Layout; input: Inputs; projection: Projection | undefined; catalogs: Map<string, CatalogRecord[]>;
  editing: boolean; canPlay: boolean; equipment: Record<string, unknown>;
  change(): void; refresh(): void; addItem(): void; fillSlot(slot: EquipmentSlot): void;
  act(change: Record<string, unknown>, summary: string): Promise<void>;
}
function icon(path: string): SVGSVGElement { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), shape = document.createElementNS("http://www.w3.org/2000/svg", "path"); svg.setAttribute("viewBox","0 0 24 24"); svg.setAttribute("aria-hidden","true"); shape.setAttribute("d",path); svg.append(shape); return svg; }
const abilityNames: Record<string, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
export function preferredLayout(storage: Storage | undefined, actor: string, key: string): Layout {
  try {
    const value = storage?.getItem("dnd-character-layout:" + actor + ":" + key) ?? storage?.getItem("dse-ui:renderer:" + key) ?? storage?.getItem("dse-ui:layout:" + key) ?? storage?.getItem("dse-ui:layout") ?? storage?.getItem("dnd-character-layout:" + actor);
    return value === "classic" || value === "builtin:classic" ? "classic" : "compact";
  } catch { return "compact"; }
}
export function savedRule(projection: Projection | undefined, name: string, path?: string, reference?: Reference): HTMLElement {
  const explanation = path ? projection?.explanations[path] : undefined;
  const node = rule(name, reference, explanation) as HTMLElement & { details: Record<string, unknown> };
  const references = reference ? [reference] : explanation?.sources ?? [];
  const sources = projection?.evidence.filter(source => references.some(ref => ref.kind === source.reference.kind && ref.id === source.reference.id)) ?? [];
  if (sources.length) node.details["savedSources"] = sources.map(({ reference, name, summary, hash }) => ({ reference, name, summary, hash }));
  return node;
}
export function recordName(view: Pick<SheetView, "catalogs" | "projection">, kind: string, id: string): string {
  return String(view.catalogs.get(kind)?.find(record => record.id === id)?.value["name"] ?? view.projection?.evidence.find(source => source.reference.kind === kind && source.reference.id === id)?.name ?? id);
}
export function equipmentSlot(item: Item, catalogs: Map<string, CatalogRecord[]>): EquipmentSlot {
  if (item.attuned) return "attuned";
  const value = item.reference ? catalogs.get(item.reference.kind)?.find(record => record.id === item.reference!.id)?.value : undefined;
  if (item.reference?.kind === "armor") return value?.["category"] === "shield" || value?.["type"] === "shield" || item.reference.id === "shield" ? "shield" : "armor";
  return "worn";
}
export function abilityRail(view: SheetView): HTMLElement {
  const t = translator(view.locale), sheet = view.projection?.sheet ?? {}, rail = styled("div", "dse-cards");
  for (const ability of abilities) {
    const score = object(object(sheet["abilities"])[ability]), save = object(object(sheet["saves"])[ability]);
    const card = styled("section", "codex-surface dse-ability"), title = styled("div", "dse-ability-title");
    const dock = styled("span", "dse-dock-slot"), derived = object(sheet["derived"]);
    if (view.layout === "compact" && ability === "DEX") dock.append(styled("span", "dse-dock", t("Init {0}", [signed(derived["initiative"])])));
    if (view.layout === "compact" && ability === "WIS") dock.append(styled("span", "dse-dock", t("Passive {0}", [human(derived["passivePerception"])])));
    const proficiency = styled("span", "dse-dot dse-shield"); proficiency.append(icon("M12 2.4 19.3 5.3V11c0 4.8-3.3 8.6-7.3 10.5C8 19.6 4.7 15.8 4.7 11V5.3Z")); proficiency.dataset["proficient"] = String(save["proficient"] === true); proficiency.title = t("Saving throw");
    title.append(el("span", t(abilityNames[ability]!)), dock, proficiency, savedRule(view.projection, signed(save["total"]), "saves." + ability + ".total"));
    const tile = styled("div", "dse-score", el("strong", savedRule(view.projection, signed(score["mod"]), "abilities." + ability + ".mod")), styled("span", "dse-number", savedRule(view.projection, human(score["score"]), "abilities." + ability + ".score")));
    const details = styled("div", "dse-ability-details");
    if (view.layout === "classic") details.append(title);
    for (const [index, caster] of rows(object(sheet["spellcasting"])["perClass"]).entries()) if (view.layout === "compact" && caster["ability"] === ability) {
      card.classList.add("dse-caster");
      details.append(styled("div", "dse-dock dse-casting", savedRule(view.projection, t("DC {0} · Attack {1}", [human(caster["saveDC"]), signed(caster["spellAttack"])]), "spellcasting.perClass." + index + ".saveDC")));
    }
    const skills = Object.entries(object(sheet["skills"])).filter(([, raw]) => object(raw)["ability"] === ability);
    for (const [id, raw] of skills) {
      const skill = object(raw), dot = styled("span", "dse-dot", skill["expertise"] ? "◆" : skill["proficient"] ? "●" : "○");
      dot.title = t(skill["expertise"] ? "Expertise" : skill["proficient"] ? "Proficient" : "Untrained");
      details.append(styled("div", "dse-skill", dot, el("span", savedRule(view.projection, t(label(id)), "skills." + id + ".total", { kind: "skill", id })), styled("strong", "dse-total", signed(skill["total"]))));
    }
    if (!skills.length) details.append(styled("span", "dse-empty", "—"));
    if (view.layout === "compact") card.append(title);
    card.append(styled("div", "dse-ability-body", tile, details)); rail.append(card);
  }
  return rail;
}
export function vitals(view: SheetView): HTMLElement {
  const t = translator(view.locale), sheet = view.projection?.sheet ?? {}, derived = object(sheet["derived"]), band = styled("div", "dse-vitals");
  const hp = styled("div", "codex-tile dse-hp", styled("span", "dse-stat-label", t("Hit points")));
  const adjust = (operation: string, title: string, initial: number): void => {
    const area = styled("div", "dse-hp-adjust"), input = numberInput(initial, () => {}, 0, operation === "set-hp" ? Number(derived["maxHp"]) : 1000000);
    area.append(field(t("Amount"), input), button(title, async () => { if (input.reportValidity()) await view.act({ operation, amount: input.valueAsNumber }, title); }));
    hp.querySelector(".dse-hp-adjust")?.remove(); hp.append(area); input.focus(); input.select();
  };
  const current = numberInput(view.input.play.hp, value => { view.input.play.hp = value ?? 0; view.change(); }, 0, Number(derived["maxHp"] ?? 0)); current.disabled = !view.canPlay; current.className = "dse-hp-current dse-number"; current.setAttribute("aria-label", t("Current HP"));
  hp.append(styled("div", "dse-counter", current, el("span", "/"), savedRule(view.projection, human(derived["maxHp"]), "derived.maxHp")));
  hp.append(styled("span", "dse-temp", t("Temporary HP {0}", [view.input.play.temporaryHp])));
  const actions = styled("div", "dnd-workflow-controls");
  actions.append(button(t("Damage"), () => adjust("damage", t("Damage"), 1), !view.canPlay), button(t("Heal"), () => adjust("heal", t("Heal"), 1), !view.canPlay), button(t("Temporary HP"), () => adjust("set-temporary-hp", t("Set temporary hp"), view.input.play.temporaryHp), !view.canPlay));
  hp.append(actions); band.append(hp);
  const tile = (name: string, key: string, sign = false): HTMLElement => styled("div", "codex-tile", styled("span", "dse-stat-label", t(name)), el("strong", savedRule(view.projection, sign ? signed(derived[key]) : human(derived[key]), "derived." + key)));
  const ac = tile("Armor class", "armorClass"); ac.classList.add("dse-ac"); band.append(ac);
  const stats = styled("div", "dse-vitals-grid", tile("Speed", "speed"), tile("Proficiency", "proficiencyBonus", true));
  if (view.layout === "classic") stats.append(tile("Initiative", "initiative", true), tile("Passive perception", "passivePerception"));
  band.append(stats);
  const worn = styled("div", "dse-worn", styled("span", "dse-stat-label", t("Worn equipment")));
  for (const slot of ["armor", "shield", "worn", "attuned"] as const) {
    const group = styled("div", "dse-worn-group", styled("span", "dse-stat-label", t(label(slot))));
    const items = view.input.play.inventory.filter(item => item.quantity > 0 && (slot === "attuned" ? item.attuned : item.location === "equipped" && equipmentSlot({ ...item, attuned: false }, view.catalogs) === slot));
    for (const item of items) {
      const token = styled("span", "dse-equipment-slot", savedRule(view.projection, item.name, undefined, item.reference));
      if (view.editing) { const remove = button("×", () => { if (slot === "attuned") item.attuned = false; else item.location = "carried"; view.change(); view.refresh(); }); remove.setAttribute("aria-label", t("Remove {0}", [item.name])); token.append(remove); }
      group.append(token);
    }
    if (view.editing) group.append(button("+ " + t(label(slot)), () => view.fillSlot(slot)));
    else if (!items.length) group.append(styled("span", "dse-empty", "—"));
    worn.append(group);
  }
  band.append(worn); return band;
}
export function backpack(view: SheetView): HTMLElement {
  const t = translator(view.locale), pack = styled("section", "dse-backpack"), head = styled("div", "dse-bp-head", styled("h3", "dse-bp-title", t("Backpack")));
  head.querySelector("h3")!.prepend(icon("M8 6V4a4 4 0 0 1 8 0v2M5 6h14v15H5ZM5 10h14M9 10v3h6v-3"));
  if (view.editing) head.append(button(t("Add item"), view.addItem));
  pack.append(head);
  const split = styled("div", "dse-bp-split"), carried = styled("div", "dse-bp-col"), stored = styled("div", "dse-bp-col dse-bp-right");
  for (const location of ["equipped", "carried", "stored"]) {
    const items = view.input.play.inventory.filter(item => item.location === location), group = styled("div", "dse-bp-group", styled("h4", "dse-bp-label", t(label(location)) + " · " + items.length));
    for (const item of items) {
      const row = styled("div", "dse-item"); row.dataset["item"] = item.id;
      row.append(styled("span", "dse-item-name", savedRule(view.projection, item.name, undefined, item.reference)));
      if (view.editing) {
        const quantity = numberInput(item.quantity, value => { item.quantity = value ?? 0; if (item.quantity === 0) { item.attuned = false; if (item.location === "equipped") item.location = "carried"; } view.change(); }, 0); quantity.className = "dse-number"; quantity.setAttribute("aria-label", t("{0} quantity", [item.name]));
        const eligibility = object(view.equipment[item.id]);
        const attune = button(item.attuned ? "★" : "☆", () => { item.attuned = !item.attuned; view.change(); view.refresh(); }, !item.attuned && eligibility["canAttune"] !== true); attune.setAttribute("aria-label", t("Attune {0}", [item.name])); attune.setAttribute("aria-pressed", String(item.attuned));
        const move = select(item.location, ["equipped", "carried", "stored"].map(id => ({ id, label: t(label(id)), disabled: id === "equipped" && eligibility["canEquip"] !== true })), value => { if (value) { if (value === "equipped" && ["armor","shield"].includes(String(eligibility["slot"]))) for (const current of view.input.play.inventory) if (current.id !== item.id && object(view.equipment[current.id])["slot"] === eligibility["slot"]) current.location = "carried"; item.location = value; view.change(); view.refresh(); } }, t); move.className = "dse-item-location"; move.setAttribute("aria-label", t("Move {0}", [item.name]));
        const remove = button("×", () => { view.input.play.inventory = view.input.play.inventory.filter(row => row.id !== item.id); view.change(); view.refresh(); }); remove.setAttribute("aria-label", t("Remove {0}", [item.name]));
        row.append(quantity, attune, move, remove);
        const details = styled("details", "dse-item-notes", el("summary", t("Details")));
        details.append(field(t("Name"), textInput(item.name, value => { item.name = value; view.change(); })), field(t("Acquired from"), textInput(item.acquisition, value => { item.acquisition = value; view.change(); })), field(t("Notes"), textInput(item.notes, value => { item.notes = value; view.change(); }, true)),
          field(t("Scroll spell (optional)"), select(item.spellId ?? "", (view.catalogs.get("spell") ?? []).map(row => ({ id: row.id, label: String(row.value["name"] ?? row.id) })), value => { if (value) item.spellId = value; else delete item.spellId; view.change(); }, t)));
        row.append(details);
      } else { row.append(el("span", "× " + item.quantity + (item.attuned ? " ★" : ""))); if (item.notes) row.append(styled("details", "dse-item-notes", el("summary", t("Notes")), el("p", item.notes))); }
      group.append(row);
    }
    if (!items.length) group.append(styled("p", "dse-empty", t("Empty")));
    (location === "stored" ? stored : carried).append(group);
  }
  split.append(carried, stored); pack.append(split);
  const coins = styled("div", "dse-coins");
  for (const coin of ["cp", "sp", "ep", "gp", "pp"]) {
    const value = view.input.play.currency[coin] ?? 0;
    const control = view.editing ? numberInput(value, value => { view.input.play.currency[coin] = value ?? 0; view.change(); }, 0) : el("span", value);
    control.className = "dse-number"; control.setAttribute("aria-label", coin.toUpperCase()); coins.append(el("label", el("span", coin.toUpperCase()), control));
  }
  pack.append(coins);
  return pack;
}
export function combatDetails(view: SheetView): HTMLElement {
  const t = translator(view.locale), sheet = view.projection?.sheet ?? {}, root = styled("div", "dse-combat");
  const attacks = panel(t("Attacks")); attacks.className = "dse-section";
  rows(sheet["weapons"]).forEach((weapon, index) => attacks.append(styled("div", "dse-attack", savedRule(view.projection, String(weapon["name"] ?? weapon["ref"]), undefined, { kind: "weapon", id: String(weapon["ref"]) }), el("strong", savedRule(view.projection, signed(weapon["attackBonus"]), "weapons." + index + ".attackBonus")), el("span", human(weapon["damage"])))));
  if (attacks.children.length === 1) attacks.append(styled("p", "dse-empty", t("No attacks yet.")));
  const resources = panel(t("Resources")); resources.className = "dse-section";
  for (const resource of rows(sheet["resources"])) {
    const key = String(resource["key"]), name = String(resource["name"] ?? key);
    const row = styled("div", "dse-resource", el("span", savedRule(view.projection, name, "resources." + key + ".remaining")), el("strong", human(resource["remaining"]) + " / " + human(resource["max"])));
    if (view.editing) { const spent = numberInput(view.input.play.resourceUses[key] ?? 0, value => { view.input.play.resourceUses[key] = value ?? 0; view.change(); }, 0, Number(resource["max"])); spent.setAttribute("aria-label", t("{0} — spent / {1}", [name, resource["max"]])); row.append(spent); }
    resources.append(row);
  }
  for (const activation of rows(sheet["activations"])) { const key = String(activation["key"]), name = String(activation["name"]); resources.append(button(t("{0} {1}", [t(view.input.play.activeFeatures[key] ? "End" : "Activate"), name]), () => view.act({ operation: "toggle-feature", key, enabled: !view.input.play.activeFeatures[key] }, name), !view.canPlay)); }
  const traits = panel(t("Features and traits")); traits.className = "dse-section";
  for (const feature of rows(sheet["features"])) { const id = String(feature["id"]); traits.append(el("details", el("summary", savedRule(view.projection, String(feature["name"] ?? id), undefined, { kind: "feature", id })), el("p", view.projection?.evidence.find(row => row.reference.id === id)?.summary ?? ""))); }
  for (const key of ["languages", "resistances", "damageImmunities", "conditionImmunities", "senses", "proficiencies"]) if (sheet[key] !== undefined) traits.append(el("p", el("strong", t(label(key)) + ": "), human(sheet[key])));
  root.append(attacks, resources, traits); return root;
}
