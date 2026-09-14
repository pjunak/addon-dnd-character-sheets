import { grantForm } from "./character-grant.js";
import { comparisonView } from "./character-comparison.js";
import { translator } from "./character-locale.js";
import { playActions } from "./character-play.js";
import { abilityRail, backpack, combatDetails, equipmentSlot, preferredLayout, recordName, savedRule, vitals, type EquipmentSlot, type Layout, type SheetView } from "./character-sheet.js";
import { equipmentPicker } from "./character-equipment.js";
import { builderShell, type BuilderNavigation } from "./character-builder-nav.js";
import type { ContributionContext } from "./sdk.js";
import type { Grant, Inputs, Request, Response, Result, State } from "./character-model.js";
import { CharacterClient, blank, exportCharacter, mergeCharacter, newId, object, parseCharacter, rows, strings, type CatalogRecord } from "./character-client.js";
import { buildView, type BuildView } from "./character-build.js";
import { printCharacter } from "./character-projection.js";
import { button, checkbox, download, el, field, human, label, panel, rule, select, styled, tabStrip, textInput } from "./character-ui.js";

type Tab = "sheet" | "combat" | "spells" | "builder" | "tools";
export function defineCharacterElement(generation: string, client: CharacterClient): string {
  const tag = `dnd-character-${generation}`;
  if (customElements.get(tag)) return tag;
  class CharacterElement extends HTMLElement {
    #context: ContributionContext | undefined; #response: Response | undefined; #input: Inputs = blank(); #evaluation: Result | undefined;
    #baseRevision = 0; #dirty = false; #busy = false; #tab: Tab = "sheet"; #message = ""; #epoch = 0;
    #catalogs = new Map<string, CatalogRecord[]>(); #dialog: HTMLDialogElement | undefined; #timer: ReturnType<typeof setTimeout> | undefined;
    #saving: Promise<void> | undefined;
    #changeVersion = 0;
    #blocked = false;
    #layout: Layout = "compact";
    #builderNav: BuilderNavigation = { tab: "character", target: "", open: true };
    #t = (key: string, values?: readonly unknown[]): string => translator(this.#context?.host.locale ?? "en")(key, values);
    #unsubscribe: (() => void) | undefined;
    #refreshTimer: ReturnType<typeof setTimeout> | undefined;
    set codexContribution(value: ContributionContext) { const previous = this.#context; this.#context = value; if (this.isConnected && previous?.host.key !== value.host.key) { this.#epoch++; this.#saving = undefined; this.#changeVersion++; this.#busy = false; this.#response = undefined; this.#evaluation = undefined; this.#catalogs.clear(); this.#dialog?.close(); clearTimeout(this.#timer); void this.#load(); } else this.#render(); }
    connectedCallback(): void { this.classList.add("addon-dnd-character", "addon-dnd-sheets"); this.#busy = false; this.#unsubscribe = client.subscribe(() => { clearTimeout(this.#refreshTimer); this.#refreshTimer = setTimeout(() => { void this.#refreshSaved(); }, 250); }); void this.#load(); }
    disconnectedCallback(): void { this.#epoch++; this.#saving = undefined; this.#changeVersion++; this.#unsubscribe?.(); clearTimeout(this.#refreshTimer); clearTimeout(this.#timer); this.#dialog?.close(); this.#context?.edits.set({ dirty: false, saving: false }); }
    get #key(): string { return this.#context?.host.key ?? ""; }
    get #editable(): boolean { return this.#context?.host.canEdit === true && !this.#busy; }
    get #name(): string { return String(object(this.#context?.host.value)["name"] ?? "Character"); }
    #base(operation: string): Omit<Request, "contractVersion"> { return { key: this.#key, expectedRevision: this.#baseRevision, operation, operationId: newId(), summary: `Update character ${this.#t(label(operation)).toLowerCase()}` }; }
    async #call(method: string, request: Omit<Request, "contractVersion">): Promise<Response> {
      const epoch = this.#epoch, response = await client.call(method, request);
      if (epoch !== this.#epoch || !this.isConnected) throw new Error("The character view changed before the request completed.");
      return response;
    }
    async #guard(action: () => Promise<void>): Promise<void> {
      if (this.#busy) return; const epoch = this.#epoch; this.#busy = true; this.setAttribute("aria-busy", "true"); this.#publish(); this.#syncBusyButtons(); if (!this.#response) this.#render();
      try { await action(); } catch (error) { if (epoch === this.#epoch && !client.signal.aborted && this.isConnected) this.#message = error instanceof Error ? error.message : "The character request failed. Your edit has not been saved."; }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.removeAttribute("aria-busy"); this.#publish(); this.#syncBusyButtons(); this.#render(); } }
    }
    #syncBusyButtons(): void {
      for (const control of this.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("button,input,select,textarea")) {
        if (this.#busy && !control.disabled) { control.dataset["characterBusy"] = ""; control.disabled = true; }
        else if (!this.#busy && control.hasAttribute("data-character-busy")) { delete control.dataset["characterBusy"]; control.disabled = false; }
      }
    }
    async #load(): Promise<void> {
      if (!this.#key) return; const epoch = ++this.#epoch;
      await this.#guard(async () => {
        const response = await this.#call("load", { key: this.#key }); if (epoch !== this.#epoch || !this.isConnected) return;
        this.#response = response; this.#evaluation = response.evaluation; this.#input = structuredClone(response.state?.inputs ?? blank()); this.#baseRevision = response.revision; this.#dirty = false; this.#message = response.message;
        this.#layout = preferredLayout(localStorage, response.actorId, this.#key);
        this.#blocked = false;
        if (!response.state) this.#tab = "builder";
        const kinds = ["class", "species", "background", "subclass", "feat", "armor", "weapon", "magic-item", "gear", "spell"];
        this.#render();
        const results = await Promise.allSettled(kinds.map(kind => client.catalog(kind)));
        if (epoch !== this.#epoch || !this.isConnected) return;
        results.forEach((result, index) => { if (result.status === "fulfilled") this.#catalogs.set(kinds[index]!, result.value); });
        if (results.some(result => result.status === "rejected")) this.#message = "Some source catalogs could not be loaded. The saved character remains available; reload to retry.";
      });
    }
    #publish(): void { this.#context?.edits.set({ dirty: this.#dirty, saving: this.#busy || !!this.#saving }); }
    async #refreshSaved(): Promise<void> {
      if (this.#busy || this.#saving || this.#dirty || !this.#response) return;
      const version = this.#changeVersion;
      try {
        const response = await this.#call("load", { key: this.#key });
        if (version !== this.#changeVersion || this.#dirty || response.revision === this.#response.revision && response.status === this.#response.status && response.rulesChanged === this.#response.rulesChanged) return;
        this.#accept(response); this.#render();
      } catch { /* The next change still uses optimistic revision checks. */ }
    }
    #changed = (): void => {
      this.#dirty = true; this.#changeVersion++; this.#blocked = false; this.#message = "Saving…"; this.#publish(); this.#status();
      clearTimeout(this.#timer); this.#timer = setTimeout(() => { void this.#flush(); }, 250);
    };
    #status(): void { const node = this.querySelector<HTMLElement>("[data-character-status]"); if (node?.firstElementChild) node.firstElementChild.textContent = this.#t(this.#message); }
    #accept(response: Response): void {
      this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision;
      if (response.evaluation) this.#evaluation = response.evaluation;
      this.#input = structuredClone(response.state?.inputs ?? blank()); this.#dirty = false; this.#message = response.message; this.#publish();
    }
    async #flush(): Promise<void> {
      if (this.#saving) return this.#saving;
      if (!this.#dirty || this.#blocked || !this.isConnected) return;
      const epoch = this.#epoch;
      const run = async (): Promise<void> => {
        while (this.#dirty && !this.#blocked && this.isConnected && epoch === this.#epoch) {
          const version = this.#changeVersion, inputs = structuredClone(this.#input), base = this.#response?.state?.inputs ?? blank();
          const response = await this.#call("save", { ...this.#base("build"), inputs });
          if (response.status === "conflict" && response.state) {
            const merged = mergeCharacter(base, this.#input, response.state.inputs);
            if (merged) { this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision; this.#input = merged; this.#render(); continue; }
            this.#blocked = true; this.#message = "This character was edited elsewhere. Your pending input remains on this page. Reload the character before continuing."; this.#status(); break;
          }
          if (response.evaluation) this.#evaluation = response.evaluation;
          if (response.status !== "ready" || !response.state) {
            this.#blocked = true; this.#message = response.message;
            if (response.status === "invalid" && version === this.#changeVersion) {
              this.#input = structuredClone(this.#response?.state?.inputs ?? blank()); this.#dirty = false;
            }
            this.#render(); break;
          }
          this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision;
          // Incorporate server corrections without replacing objects bound to active fields.
          if (this.#input.play.asOf === inputs.play.asOf) this.#input.play.asOf = response.state.inputs.play.asOf;
          if (this.#input.play.hp === inputs.play.hp) this.#input.play.hp = response.state.inputs.play.hp;
          if (JSON.stringify(this.#input.build.choices) === JSON.stringify(inputs.build.choices)) this.#input.build.choices = structuredClone(response.state.inputs.build.choices);
          if (version === this.#changeVersion) {
            this.#dirty = false; this.#message = "Saved";
            const focused = document.activeElement;
            if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement && focused.type === "text" && focused.getAttribute("role") !== "combobox") {
              this.#input.play.asOf = response.state.inputs.play.asOf; this.#status();
            } else { this.#input = structuredClone(response.state.inputs); this.#render(); }
          }
        }
      };
      this.#saving = run().catch(error => {
        if (epoch === this.#epoch && this.isConnected) { this.#blocked = true; this.#message = error instanceof Error ? error.message : "Could not save. Check your connection and retry."; this.#render(); }
      }).finally(() => { if (epoch === this.#epoch) { this.#saving = undefined; this.#publish(); } });
      this.#publish(); return this.#saving;
    }
    async #evaluate(render: boolean): Promise<void> {
      if (this.#dirty) { await this.#flush(); return; }
      const response = await this.#call("evaluate", { ...this.#base("build"), inputs: structuredClone(this.#input) });
      this.#evaluation = response.evaluation; if (render) this.#render();
    }
    #view(): BuildView { return { locale: this.#context?.host.locale ?? "en", input: this.#input, evaluation: this.#evaluation, policy: this.#response?.policy ?? {}, catalogs: this.#catalogs, changed: this.#changed, navigate: tab => { this.#builderNav.tab = tab; }, refresh: () => this.#render() }; }
    #render(): void {
      if (!this.isConnected || !this.#context) return;
      const dialog = this.#dialog?.open ? this.#dialog : undefined;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      const focusKey = focused?.dataset["focusKey"], focusId = focused?.id;
      const root = styled("section", "dnd-sheet-shell dse-layout-" + this.#layout);
      this.dataset["layout"] = this.#layout;
      if (!this.#response) {
        const status = el("p", this.#t(this.#message || "Loading character…")); status.setAttribute("role", "status");
        root.append(status); if (!this.#busy) root.append(button(this.#t("Reload saved character"), () => this.#load()));
        for (const child of [...this.children]) if (child !== dialog) child.remove();
        this.prepend(root); return;
      }
      const view = this.#sheetView();
      const options = ["sheet", "combat", "spells", "builder", "tools"].map(id => ({ id, label: this.#t(({ sheet: "Sheet", combat: "Combat", spells: "Spells", builder: "Builder", tools: "Tools" } as Record<string,string>)[id]!) }));
      const nav = tabStrip(this.#t("Character views"), options, this.#tab, id => { this.#tab = id as Tab; this.#render(); }, "dnd", "vertical");
      nav.classList.add("dnd-sheet-tabs");
      const status = styled("div", "dnd-save-status", el("span", this.#t(this.#message))); status.dataset["characterStatus"] = ""; status.setAttribute("role", "status");
      if (this.#blocked && this.#dirty) status.append(button(this.#t("Retry"), () => { this.#blocked = false; return this.#flush(); }));
      const content = styled("div", "dnd-sheet-panel"); content.id = "dnd-panel-" + this.#tab; content.setAttribute("role", "tabpanel"); content.setAttribute("aria-labelledby", "dnd-tab-" + this.#tab);
      if (this.#tab === "builder") content.append(this.#builder());
      else if (this.#tab === "tools") content.append(this.#tools());
      else if (this.#tab === "spells") content.append(vitals(view), this.#spells());
      else {
        const main = styled("div", "dse-cols-main", vitals(view));
        if (!this.#response.state) main.append(panel(this.#t("Create your character"), el("p", this.#t("Choose your origin, abilities and first class to start building.")), button(this.#t("Open Builder"), () => { this.#tab = "builder"; this.#render(); })));
        main.append(this.#tab === "combat" ? this.#combat() : backpack(view));
        content.append(styled("div", "dse-cols", abilityRail(view), main));
      }
      root.append(nav, styled("div", "dnd-sheet-workspace", status, content));
      for (const child of [...this.children]) if (child !== dialog) child.remove();
      this.prepend(root); this.#syncBusyButtons();
      for (const field of root.querySelectorAll<HTMLElement>(".character-field")) {
        const scope = field.closest<HTMLElement>("[id^=character-choice-], [data-item], [data-builder-target]");
        const key = (scope?.id || scope?.dataset["item"] || scope?.dataset["builderTarget"] || "") + "/" + field.querySelector("label")?.textContent;
        for (const control of field.querySelectorAll<HTMLElement>("input,select,textarea,button")) control.dataset["focusKey"] = key + "/" + (control.getAttribute("aria-label") ?? control.tagName);
      }
      if (focusKey) root.querySelector<HTMLElement>('[data-focus-key="' + CSS.escape(focusKey) + '"]')?.focus({preventScroll:true});
      else if (focusId) root.querySelector<HTMLElement>("#" + CSS.escape(focusId))?.focus({preventScroll:true});
    }
    #sheetView(): SheetView {
      return { locale: this.#context?.host.locale ?? "en", layout: this.#layout, input: this.#input, projection: this.#response?.state?.projection, catalogs: this.#catalogs,
        equipment: object(this.#evaluation?.guidance["equipment"]),
        editing: this.#editable && this.#response?.status !== "unavailable" && !this.#response?.rulesChanged,
        canPlay: this.#editable && this.#evaluation?.ready === true && !!this.#response?.state && this.#response.status !== "unavailable" && !this.#response.rulesChanged,
        change: this.#changed, refresh: () => this.#render(), addItem: () => this.#equipment(), fillSlot: slot => this.#slot(slot),
        act: (change, summary) => this.#perform({ ...this.#base("play"), change, summary }) };
    }
    #equipment(): void {
      this.#open(this.#t("Add equipment"), [equipmentPicker(this.#catalogs, this.#context?.host.locale ?? "en", items => {
        this.#input.play.inventory.push(...items); this.#changed(); this.#dialog?.close(); this.#render();
      })]);
    }
    #slot(slot: EquipmentSlot): void {
      const choices = this.#input.play.inventory.filter(item => item.quantity > 0 && object(object(this.#evaluation?.guidance["equipment"])[item.id])[slot === "attuned" ? "canAttune" : "canEquip"] === true && (slot === "attuned" ? !item.attuned : equipmentSlot({ ...item, attuned: false }, this.#catalogs) === slot));
      this.#open(this.#t("Choose {0}", [this.#t(label(slot))]), [styled("div", "dnd-slot-picker", ...choices.map(item => button(item.name, () => {
        if (slot === "attuned") item.attuned = true;
        else { if (slot === "armor" || slot === "shield") for (const current of this.#input.play.inventory) if (current.location === "equipped" && equipmentSlot({ ...current, attuned: false }, this.#catalogs) === slot) current.location = "carried"; item.location = "equipped"; }
        this.#changed(); this.#dialog?.close(); this.#render();
      }))), ...(!choices.length ? [el("p", this.#t("Add an item to your backpack first."))] : []), button(this.#t("Add item"), () => this.#equipment())]);
    }
    #builder(): HTMLElement {
      const body = el("fieldset"); body.disabled = !this.#editable || this.#response?.status === "unavailable" || !!this.#response?.rulesChanged;
      const view = this.#view();
      if (!["character","levels","spells","add-class","dm-given", ...this.#input.build.levels.map(level => level.classId)].includes(this.#builderNav.tab)) this.#builderNav.tab = "character";
      if (this.#builderNav.tab === "dm-given") body.append(this.#grants());
      else if (this.#builderNav.tab === "spells") body.append(this.#spellChoices());
      else body.append(buildView(view, this.#builderNav.tab));
      return builderShell(view, this.#builderNav, body, (tab, target = "") => {
        this.#builderNav.tab = tab; this.#builderNav.target = target; this.#render();
        if (target) { const node = this.querySelector<HTMLElement>('[data-builder-target="' + CSS.escape(target) + '"]') ?? this.querySelector<HTMLElement>("#character-choice-" + CSS.escape(encodeURIComponent(target)));
          for (let parent = node?.parentElement; parent && parent !== this; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
          node?.scrollIntoView({ block: "center", behavior: "smooth" }); node?.querySelector<HTMLElement>("input,select,button")?.focus({ preventScroll: true }); }
      });
    }
    #combat(): HTMLElement {
      const view = this.#sheetView(), root = styled("div", "dse-combat"), rest = styled("div", "dnd-rest-controls");
      for (const value of ["short", "long"]) rest.append(button(this.#t("{0} rest", [this.#t(label(value))]), () => view.act({ operation: "rest", rest: value }, value + " rest"), !view.canPlay));
      root.append(rest, combatDetails(view));
      if (this.#evaluation) {
        const recovery = el("fieldset"); recovery.disabled = !view.canPlay;
        recovery.append(playActions(this.#input, this.#evaluation, this.#catalogs.get("spell") ?? [], view.act, view.locale, "recovery")); root.append(recovery);
      }
      return root;
    }
    #spells(): HTMLElement {
      const root = styled("div", "dnd-spell-browser"), view = this.#sheetView();
      const controls = el("fieldset"); controls.disabled = !view.canPlay;
      if (this.#evaluation) controls.append(playActions(this.#input, this.#evaluation, this.#catalogs.get("spell") ?? [], view.act, view.locale, "spells"));
      else {
        for (const [title, groups] of [["Cantrips", this.#input.build.spells.cantrips], ["Spellbook", this.#input.build.spells.spellbook], ["Prepared spells", this.#input.play.preparedSpells]] as const) {
          for (const [classId, ids] of Object.entries(groups)) controls.append(panel(this.#t(title) + " · " + recordName(view, "class", classId), ...ids.map(id => savedRule(view.projection, recordName(view, "spell", id), undefined, {kind:"spell", id}))));
        }
      }
      const choices = el("details", el("summary", this.#t("Manage spells"))), fields = el("fieldset"); fields.disabled = !this.#editable || this.#response?.status === "unavailable" || !!this.#response?.rulesChanged;
      fields.append(this.#spellChoices()); choices.append(fields);
      root.append(controls, choices);
      return root;
    }
    #tools(): HTMLElement {
      const tools = styled("div", "character-toolbar", field(this.#t("Sheet layout"), select(this.#layout, [{id:"compact",label:this.#t("Compact")},{id:"classic",label:this.#t("Classic")}], value => {
        if (!value) return; this.#layout = value as Layout; try { localStorage.setItem("dnd-character-layout:" + this.#response?.actorId + ":" + this.#key, value); } catch { /* Session-only preference. */ } this.#render();
      }, this.#t)));
      if (this.#response?.state) tools.append(button(this.#t("Export character"), () => download(this.#key + ".character.json", exportCharacter(this.#response!.state!))), button(this.#t("Print / PDF"), () => this.#print(this.#response!.state!, this.#response!.revision)));
      tools.append(button(this.#t("Import character"), () => this.#import(), !this.#editable), button(this.#t("Reload character"), () => this.#load(), this.#busy || !!this.#saving));
      const provider = panel(this.#t("Rules"), el("p", this.#t(this.#response?.status === "unavailable" ? "Compatible rules are unavailable. Saved values and notes remain accessible." : this.#response?.rulesChanged ? "The rules changed. Adopt them to continue editing." : "Rules are connected.")));
      if (this.#response?.rulesChanged) provider.append(button(this.#t("Adopt current rules"), () => this.#perform({ ...this.#base("adopt-rules"), inputs: structuredClone(this.#input), adoptRules: true }), !this.#editable));
      return el("div", tools, provider);
    }
    #spellChoices(): HTMLElement {
      const root = panel(this.#t("Spells")), options = this.#evaluation?.spellOptions ?? {}, casting = object(this.#evaluation?.sheet["spellcasting"]), spells = this.#catalogs.get("spell") ?? [];
      const picks = (title: string, ids: string[], current: string[], set: (ids: string[]) => void, maximum: number): HTMLElement => {
        const details = el("details", el("summary", this.#t("{0} ({1} selected)", [title, current.length]))), list = el("div"); let query = "";
        const render = (): void => { list.replaceChildren(); const shown = [...new Set([...current, ...ids])].filter(id => `${spells.find(record => record.id === id)?.value["name"] ?? id}`.toLowerCase().includes(query)).slice(0, 100); for (const id of shown) { const record = spells.find(record => record.id === id); list.append(el("div", checkbox(String(record?.value["name"] ?? id), current.includes(id), selected => { if (selected && (current.length >= maximum || !ids.includes(id))) return; current = selected ? [...current, id] : current.filter(item => item !== id); set(current); details.querySelector("summary")!.textContent = this.#t("{0} ({1} selected)", [title, current.length]); this.#changed(); render(); }), rule(this.#t("Details"), { kind: "spell", id }))); const control = list.lastElementChild?.querySelector<HTMLInputElement>("input"); if (control) control.disabled = !current.includes(id) && (current.length >= maximum || !ids.includes(id)); } };
        details.append(field(this.#t("Filter spells"), textInput("", value => { query = value.toLowerCase(); render(); })), list); render(); return details;
      };
      for (const classOptions of rows(options["classes"])) {
        const id = String(classOptions["classId"]), caster = rows(casting["perClass"]).find(row => row["classId"] === id) ?? {}, eligible = strings(classOptions["spellIds"]), zero = eligible.filter(id => Number(spells.find(record => record.id === id)?.value["level"]) === 0), leveled = eligible.filter(id => !zero.includes(id));
        root.append(picks(this.#t("{0} cantrips · {1} allowed", [this.#t(label(id)), human(caster["cantripsKnown"])]), zero, this.#input.build.spells.cantrips[id] ?? [], value => { this.#input.build.spells.cantrips[id] = value; }, Number(caster["cantripsKnown"])));
        if (caster["prepares"] === "spellbook") root.append(picks(this.#t("{0} spellbook · {1} gained from levels", [this.#t(label(id)), human(caster["spellbookKnown"])]), leveled, this.#input.build.spells.spellbook[id] ?? [], value => { this.#input.build.spells.spellbook[id] = value; }, Number(caster["spellbookKnown"]) + this.#input.build.spells.acquisitions.filter(row => row.classId === id).length));
        if (caster["prepares"] === "spellbook") {
          const order = el("details", el("summary", this.#t("Spellbook acquisition order")), el("p", this.#t("Level-granted spells use slots in this order. Copied spells keep their separate paid acquisition.")));
          const selected = this.#input.build.spells.spellbook[id] ?? [];
          for (const [index, spell] of selected.entries()) {
            const gain = rows(options["acquisitionLevels"]).find(row => row["classId"] === id && row["id"] === spell);
            const move = (offset: number): void => { const next = [...selected]; [next[index], next[index + offset]] = [next[index + offset]!, next[index]!]; this.#input.build.spells.spellbook[id] = next; this.#changed(); this.#render(); void this.#evaluate(true); };
            order.append(el("div", rule(String(spells.find(record => record.id === spell)?.value["name"] ?? spell), {kind:"spell", id:spell}), el("span", gain ? this.#t("Character level {0}", [gain["level"]]) : this.#t("Copied or awaiting evaluation")), button(this.#t("Move earlier"), () => move(-1), index === 0), button(this.#t("Move later"), () => move(1), index === selected.length-1)));
          }
          root.append(order);
        }
        root.append(picks(this.#t("{0} prepared spells · {1} allowed", [this.#t(label(id)), human(caster["preparedLimit"])]), caster["prepares"] === "spellbook" ? this.#input.build.spells.spellbook[id] ?? [] : leveled, this.#input.play.preparedSpells[id] ?? [], value => { this.#input.play.preparedSpells[id] = value; }, Number(caster["preparedLimit"])));
      }
      for (const choice of rows(options["pendingChoices"])) { const key = String(choice["key"]); root.append(picks(`Granted spells · choose ${human(choice["choose"])}`, strings(choice["eligibleSpellIds"]), this.#input.build.spells.grantChoices[key] ?? [], value => { this.#input.build.spells.grantChoices[key] = value; }, Number(choice["choose"]))); }
      for (const choice of rows(options["castingAbilityChoices"])) { const key = String(choice["key"]); root.append(field(this.#t("Granted spellcasting ability"), select(this.#input.build.spells.castingAbilities[key] ?? "", strings(choice["options"]).map(id => ({ id, label: id })), value => { this.#input.build.spells.castingAbilities[key] = value; this.#changed(); }, this.#t))); }
      return root;
    }
    #grants(): HTMLElement {
      const root = panel(this.#t("DM given"));
      for (const grant of this.#response?.state?.inputs.grants ?? []) { root.append(el("p", grant.name + " · " + grant.reason)); if (grant.active && this.#response?.role === "dm") root.append(button(this.#t("Amend {0}", [grant.name]), () => this.#grant(grant), !this.#editable), button(this.#t("Revoke {0}", [grant.name]), () => this.#perform({ ...this.#base("revoke-grant"), grantId: grant.id, inputs: structuredClone(this.#input), summary: `Revoke DM grant: ${grant.name}` }), !this.#editable)); }
      if (this.#response?.role === "dm") root.append(button(this.#t("Give a DM grant"), () => this.#grant(), !this.#editable)); return root;
    }
    #grant(previous?: Grant): void {
      this.#open(previous ? this.#t("Amend {0}", [previous.name]) : this.#t("DM given"), grantForm(this.#input, this.#evaluation, this.#catalogs.get("feat") ?? [], previous, grant => {
        this.#dialog?.close(); return this.#perform({ ...this.#base(previous ? "amend-grant" : "grant"), inputs: structuredClone(this.#input), grant, ...(previous ? { grantId: previous.id } : {}), summary: `DM given: ${grant.name} — ${grant.reason}` });
      }, this.#context?.host.locale));
    }
    async #perform(request: Omit<Request, "contractVersion">): Promise<void> {
      await this.#flush(); if (this.#dirty) return;
      request.expectedRevision = this.#baseRevision;
      if (request.inputs && request.operation !== "import") request.inputs = structuredClone(this.#input);
      await this.#guard(async () => {
        if (request.operation !== "import") {
          const response = await this.#call("save", request); this.#message = response.message;
          if (response.status === "ready" && response.state) this.#accept(response);
          return;
        }
        const response = await this.#call("preview", request); this.#message = response.message;
        const content: Node[] = [el("p", this.#t("Replace this character with the imported build and play state?")), comparisonView(response.changes ?? [], response.evaluation, this.#context?.host.locale)];
        if (response.token) content.push(button(this.#t("Replace character"), () => this.#guard(async () => {
          const saved = await this.#call("commit", { key: this.#key, expectedRevision: response.revision, operationId: request.operationId!, token: response.token! });
          this.#message = saved.message; if (saved.status === "ready" && saved.state) { this.#accept(saved); this.#dialog?.close(); }
        })));
        this.#open(this.#t("Import character"), content);
      });
    }
    #open(title: string, content: Node[]): void {
      this.#dialog?.close(); this.#dialog?.remove(); const dialog: HTMLDialogElement = el("dialog", el("h2", title), ...content, button(this.#t("Close"), () => dialog.close())); dialog.className = "character-dialog"; const id = `character-dialog-${newId()}`; dialog.querySelector("h2")!.id = id; dialog.setAttribute("aria-labelledby", id);
      const trigger = document.activeElement; dialog.addEventListener("close", () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); }); this.#dialog = dialog; this.append(dialog); dialog.showModal(); this.#syncBusyButtons();
    }
    #import(): void {
      let body = "", authorize = false; const area = textInput(body, value => { body = value; }, true), file = el("input"); file.type = "file"; file.accept = ".json,application/json";
      area.maxLength = 1000000;
      area.spellcheck = false; area.autocapitalize = "off"; area.autocomplete = "off";
      if (area instanceof HTMLTextAreaElement) area.wrap = "off";
      area.addEventListener("paste", event => {
        if (!(event instanceof ClipboardEvent)) return;
        const text = event.clipboardData?.getData("text/plain"); if (text === undefined) return;
        event.preventDefault();
        const start = area.selectionStart ?? 0, end = area.selectionEnd ?? start;
        const next = area.value.slice(0, start) + text + area.value.slice(end);
        if (new TextEncoder().encode(next).length > 1000000) { this.#message = "This character file exceeds the import limit."; this.#status(); return; }
        // Native multiline insertion can stall Chromium on large JSON archives.
        // One value update preserves selection semantics without partial input.
        area.value = next; body = next; area.setSelectionRange(start + text.length, start + text.length);
      });
      file.addEventListener("change", () => { const selected = file.files?.[0]; if (selected) void this.#guard(async () => { if (selected.size > 1000000) throw new Error("This character file exceeds the import limit."); body = await selected.text(); area.value = body; }); });
      this.#open(this.#t("Import character"), [field(this.#t("Choose a file"), file), field(this.#t("Or paste the export"), area), ...(this.#response?.role === "dm" ? [checkbox(this.#t("Authorize imported DM grants as the current DM"), false, value => { authorize = value; })] : []), button(this.#t("Review import"), async () => {
        try { const inputs = parseCharacter(body); this.#dialog?.close(); await this.#perform({ ...this.#base("import"), inputs, reauthorizeGrants: authorize }); }
        catch (error) { this.#message = error instanceof Error ? error.message : "Invalid character file."; this.#status(); }
      })]);
    }
    #print(state: State, revision: number): void {
      const options = { spells: true, equipment: true, provenance: false };
      this.#open(this.#t("Print / PDF"), [el("p", this.#t("Choose Save as PDF in the browser print dialog for a PDF copy.")), ...Object.entries(options).map(([key, value]) => checkbox(this.#t(label(key)), value, enabled => { options[key as keyof typeof options] = enabled; })), button(this.#t("Open print preview"), () => { try { printCharacter(state, revision, this.#name, options, this.#context?.host.locale); } catch (error) { this.#message = error instanceof Error ? error.message : "Printing failed."; this.#status(); } })]);
    }
  }
  customElements.define(tag, CharacterElement); return tag;
}
