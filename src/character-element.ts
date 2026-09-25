import { grantForm } from "./character-grant.js";
import { comparisonView } from "./character-comparison.js";
import { translator } from "./character-locale.js";
import { feedbackMessage } from "./character-feedback.js";
import { playActions } from "./character-play.js";
import { quickUse } from "./character-quick-use.js";
import { abilityRail, backpack, combatDetails, preferredLayout, vitals, type Layout, type SheetView } from "./character-sheet.js";
import { attuneEquipment, equipmentReason, equipmentSlot, moveEquipment, type EquipmentSlot } from "./character-inventory.js";
import { equipmentPicker } from "./character-equipment.js";
import { builderShell, focusBuilderTarget, type BuilderNavigation } from "./character-builder-nav.js";
import type { AddonContext, ContributionContext } from "./sdk.js";
import type { Grant, Inputs, Request, Response, Result, State } from "./character-model.js";
import { spellPicker, spellSourceLabel, unassignedSpellState, savedSpellBook, type SpellPickerState } from "./character-spells.js";
import { CharacterClient, blank, exportCharacter, mergeCharacter, reconcileCharacterChoices, reconcileCharacterMap, newId, object, parseCharacter, rows, strings, type CatalogRecord } from "./character-client.js";
import { buildView, type BuildView } from "./character-build.js";
import { printCharacter } from "./character-projection.js";
import { builderTarget, button, checkbox, download, el, field, human, label, panel, restoreControlFocus, rule, select, styled, tabStrip, textInput } from "./character-ui.js";
import { readCharacterPending, type CharacterPending, type CommandAttempt, type SaveAttempt, type CharacterTab as Tab } from "./character-pending.js";

const runtimes = new Map<string, { client: CharacterClient; enhance: AddonContext["ui"]["enhance"] }>();
export function defineCharacterElement(generation: string, client: CharacterClient, enhance: AddonContext["ui"]["enhance"]): string {
  const runtime = { client, enhance };
  runtimes.set(generation, runtime);
  client.signal.addEventListener("abort", () => { if (runtimes.get(generation) === runtime) runtimes.delete(generation); }, { once: true });
  const tag = `dnd-character-${generation}`;
  if (customElements.get(tag)) return tag;
  class CharacterElement extends HTMLElement {
    // A cached custom-element definition outlives an SDK activation. Each new
    // instance takes the current runtime; old instances keep their expired one.
    readonly #runtime = runtimes.get(generation)!;
    #pending: unknown;
    #baseInputs: Inputs = blank();
    #controls: ReturnType<AddonContext["ui"]["enhance"]> | undefined;
    #context: ContributionContext | undefined; #response: Response | undefined; #input: Inputs = blank(); #evaluation: Result | undefined;
    #baseRevision = 0; #dirty = false; #busy = false; #tab: Tab = "sheet"; #message = ""; #epoch = 0;
    #catalogs = new Map<string, CatalogRecord[]>(); #dialog: HTMLDialogElement | undefined; #timer: ReturnType<typeof setTimeout> | undefined;
    #saving: Promise<void> | undefined;
    #attempt: SaveAttempt | undefined;
    #command: CommandAttempt | undefined;
    #saveIssues: string[] = [];
    #changeVersion = 0;
    #blocked = false;
    #layout: Layout = "compact";
    #builderNav: BuilderNavigation = { tab: "character", target: "", open: true };
    #spellPickers = new Map<string, SpellPickerState>();
    #spellManagementOpen = false;
    #t = (key: string, values?: readonly unknown[]): string => translator(this.#context?.host.locale ?? "en")(key, values);
    #feedback = (message: string): string => feedbackMessage(message, this.#context?.host.locale ?? "en");
    #unsubscribe: (() => void) | undefined;
    #refreshTimer: ReturnType<typeof setTimeout> | undefined;
    set codexContribution(value: ContributionContext) { const previous = this.#context; this.#context = value; if (previous?.host.key !== value.host.key) { this.#spellPickers.clear(); this.#spellManagementOpen = false; } if (this.isConnected && previous?.host.key !== value.host.key) { this.#epoch++; this.#pending = undefined; this.#saving = undefined; this.#attempt = undefined; this.#command = undefined; this.#changeVersion++; this.#busy = false; this.#response = undefined; this.#evaluation = undefined; this.#catalogs.clear(); this.#dialog?.close(); clearTimeout(this.#timer); void this.#load(); } else this.#render(); }
    connectedCallback(): void { this.#controls = this.#runtime.enhance(this); this.#pending = this.#context?.edits.handoff?.take(); this.classList.add("addon-dnd-character", "addon-dnd-sheets"); this.#busy = false; this.#unsubscribe = this.#runtime.client.subscribe(() => { clearTimeout(this.#refreshTimer); this.#refreshTimer = setTimeout(() => { void this.#refreshSaved(); }, 250); }); void this.#load(); }
    disconnectedCallback(): void { this.#controls?.dispose(); this.#controls = undefined; this.#epoch++; this.#saving = undefined; this.#attempt = undefined; this.#command = undefined; this.#changeVersion++; this.#unsubscribe?.(); clearTimeout(this.#refreshTimer); clearTimeout(this.#timer); this.#dialog?.close(); this.#context?.edits.set({ dirty: false, saving: false }); }
    get #key(): string { return this.#context?.host.key ?? ""; }
    get #editable(): boolean { return this.#context?.host.canEdit === true && !this.#busy && !this.#command; }
    get #name(): string { return String(object(this.#context?.host.value)["name"] ?? "Character"); }
    #base(operation: string): Omit<Request, "contractVersion"> { return { key: this.#key, expectedRevision: this.#baseRevision, operation, operationId: newId(), summary: `Update character ${this.#t(label(operation)).toLowerCase()}` }; }
    async #call(method: string, request: Omit<Request, "contractVersion">): Promise<Response> {
      const epoch = this.#epoch, response = await this.#runtime.client.call(method, request);
      if (epoch !== this.#epoch || !this.isConnected) throw new Error("The character view changed before the request completed.");
      return response;
    }
    async #guard(action: () => Promise<void>): Promise<void> {
      if (this.#busy) return;
      const focused = document.activeElement instanceof HTMLElement && this.contains(document.activeElement) ? document.activeElement : undefined;
      const focusKey = focused?.dataset["focusKey"];
      const epoch = this.#epoch; this.#busy = true; this.setAttribute("aria-busy", "true"); this.#publish(); this.#status(); this.#syncBusyButtons(); if (!this.#response) this.#render();
      try { await action(); } catch (error) { if (epoch === this.#epoch && !this.#runtime.client.signal.aborted && this.isConnected) this.#message = error instanceof Error ? error.message : "The character request failed. Your edit has not been saved."; }
      finally { if (epoch === this.#epoch) {
        // Native disabling can blur the initiating control. Restore its stable
        // target only when focus was lost, never after the user moved elsewhere.
        const lostFocus = document.activeElement === document.body;
        this.#busy = false; this.removeAttribute("aria-busy"); this.#publish(); this.#syncBusyButtons(); this.#render();
        if (lostFocus && focusKey && !this.#command) restoreControlFocus(this.querySelector<HTMLElement>('[data-focus-key="' + CSS.escape(focusKey) + '"]') ?? undefined);
      } }
    }
    #syncBusyButtons(): void {
      for (const control of this.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("button,input,select,textarea")) {
        if (this.#busy && !control.disabled) { control.dataset["characterBusy"] = ""; control.disabled = true; }
        else if (!this.#busy && control.hasAttribute("data-character-busy")) { delete control.dataset["characterBusy"]; control.disabled = false; }
      }
    }
    async #load(): Promise<void> {
      if (!this.#key) return; const epoch = ++this.#epoch; let recovered = false;
      await this.#guard(async () => {
        const response = await this.#call("load", { key: this.#key }); if (epoch !== this.#epoch || !this.isConnected) return;
        if (response.status !== "ready" && response.status !== "unavailable") throw new Error(response.message);
        const pending = this.#pending === undefined ? undefined : readCharacterPending(this.#pending);
        this.#command = undefined;
        this.#response = response; this.#evaluation = response.evaluation; this.#input = structuredClone(response.state?.inputs ?? blank()); this.#baseRevision = response.revision; this.#baseInputs = structuredClone(this.#input); this.#dirty = false; this.#attempt = undefined; this.#saveIssues = []; this.#message = response.message;
        this.#layout = preferredLayout(localStorage, response.actorId, this.#key);
        this.#blocked = false;
        if (!response.state) this.#tab = "builder";
        if (pending && pending.key === this.#key && pending.actorId === response.actorId && pending.role === response.role) {
          recovered = true;
          this.#input = pending.inputs; this.#baseInputs = pending.base; this.#baseRevision = pending.revision;
          this.#dirty = pending.dirty; this.#changeVersion = pending.changeVersion;
          this.#attempt = pending.attempt; this.#command = pending.command; this.#tab = pending.tab; this.#builderNav = pending.builder;
          this.#blocked = this.#dirty; this.#evaluation = undefined;
          this.#message = "The character reconnected. Your pending changes are still on this page. Review them before retrying.";
        }
        this.#pending = undefined;
        // Unavailable rules leave the saved projection authoritative; catalog failures must not replace that explanation.
        if (response.status === "unavailable") { this.#catalogs.clear(); return; }
        const kinds = ["class", "species", "background", "subclass", "feat", "armor", "weapon", "magic-item", "gear", "spell"];
        this.#render();
        const results = await Promise.allSettled(kinds.map(kind => this.#runtime.client.catalog(kind)));
        if (epoch !== this.#epoch || !this.isConnected) return;
        results.forEach((result, index) => { if (result.status === "fulfilled") this.#catalogs.set(kinds[index]!, result.value); });
        if (results.some(result => result.status === "rejected") && !recovered) this.#message = "Some source catalogs could not be loaded. The saved character remains available; reload to retry.";
      });
      if (recovered && epoch === this.#epoch && this.isConnected) this.querySelector<HTMLElement>("[data-character-status]")?.focus();
    }
    #publish(): void {
      const edits = this.#context?.edits;
      edits?.set({ dirty: this.#dirty || !!this.#command || this.#pending !== undefined, saving: this.#busy || !!this.#saving });
      const pending: CharacterPending | undefined = this.#response && (this.#dirty || this.#command) ? {
        version: "character-pending.v1", key: this.#key, actorId: this.#response.actorId, role: this.#response.role,
        inputs: this.#input, base: this.#baseInputs, revision: this.#baseRevision, dirty: this.#dirty,
        changeVersion: this.#changeVersion, tab: this.#tab, builder: this.#builderNav,
        ...(this.#attempt ? { attempt: this.#attempt } : {}), ...(this.#command ? { command: this.#command } : {}),
      } : undefined;
      edits?.handoff?.checkpoint(this.#pending ?? pending);
    }
    async #refreshSaved(force = false): Promise<void> {
      if (this.#busy || this.#saving || this.#dirty || this.#command || !this.#response) return;
      const version = this.#changeVersion;
      try {
        const response = await this.#call("load", { key: this.#key });
        if (version !== this.#changeVersion || this.#dirty || this.#command || this.#busy || this.#saving || !force && response.revision === this.#response.revision && response.status === this.#response.status && response.rulesChanged === this.#response.rulesChanged) return;
        this.#accept(response); this.#render();
      } catch { /* The next change still uses optimistic revision checks. */ }
    }
    #changed = (): void => {
      if (this.#command) return;
      this.#dirty = true; this.#changeVersion++; this.#blocked = false; this.#saveIssues = []; this.#message = "Saving…"; this.#publish(); this.#status();
      clearTimeout(this.#timer); this.#timer = setTimeout(() => { void this.#flush(); }, 250);
    };
    #status(): void { const node = this.querySelector<HTMLElement>("[data-character-status]"); if (node) this.#saveFeedback(node); }
    #saveFeedback(node: HTMLElement): void {
      node.replaceChildren(el("span", this.#feedback(this.#message))); node.dataset["uiState"] = this.#command ? (this.#busy ? "loading" : "error") : this.#blocked ? "error" : this.#dirty ? "loading" : "success";
      if (this.#command && !this.#busy) {
        node.append(el("p", this.#t("The action may already be saved. Further changes are paused until its outcome is resolved.")));
        if (this.#command.request.grant) node.append(el("p", this.#command.request.grant.name + " · " + this.#command.request.grant.reason));
        if (this.#command.retry) node.append(button(this.#t("Retry"), () => this.#sendCommand()));
        node.append(el("p", this.#t(this.#command.retry ? "Retry sends the same action safely. Checking the saved character ends this retry and does not undo any saved action." : "Check the saved character before deciding whether to repeat the action.")),
          button(this.#t("Check saved character"), () => this.#reloadSaved()));
      } else if (this.#blocked && this.#dirty) {
        node.append(el("p", this.#t("Your changes are still on this page and have not been confirmed saved.")));
        if (this.#saveIssues.length) node.append(el("ul", ...this.#saveIssues.map(message => el("li", this.#feedback(message)))));
        if (this.#response?.rulesChanged && !this.#attempt) node.append(button(this.#t("Review changed rules"), () => {
          this.#tab = "tools"; this.#render(); this.querySelector<HTMLElement>('[data-focus-key="adopt-rules"]')?.focus();
        }));
        else node.append(button(this.#t("Retry"), () => { this.#blocked = false; return this.#flush(); }));
        node.append(button(this.#t("Reload saved character"), () => this.#reloadSaved()));
      }
    }
    async #reloadSaved(): Promise<void> {
      if (this.#busy || this.#saving) return;
      if (this.#command && !confirm(this.#t("Check the saved character and end this retry? Any action already saved will remain. Review the result before repeating it."))) return;
      if (this.#dirty && !confirm(this.#t("Discard the unsaved character changes and reload the saved character?"))) return;
      clearTimeout(this.#timer); await this.#load();
    }
    #accept(response: Response): void {
      this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision;
      this.#evaluation = response.evaluation;
      this.#input = structuredClone(response.state?.inputs ?? blank()); this.#baseInputs = structuredClone(this.#input); this.#dirty = false; this.#blocked = false; this.#saveIssues = []; this.#attempt = undefined; this.#message = response.message; this.#publish();
    }
    async #flush(): Promise<void> {
      if (this.#saving) return this.#saving;
      if (!this.#dirty || this.#blocked || this.#command || !this.isConnected) return;
      this.#message = "Saving…"; this.#saveIssues = []; this.#status();
      const epoch = this.#epoch;
      const run = async (): Promise<void> => {
        while (this.#dirty && !this.#blocked && this.isConnected && epoch === this.#epoch) {
          // Keep the exact request until a response establishes its outcome, even
          // when newer input arrives while an earlier reply is lost.
          const attempt = this.#attempt ??= { request: { ...this.#base("build"), inputs: structuredClone(this.#input) }, base: structuredClone(this.#baseInputs), version: this.#changeVersion };
          const { version, base, request } = attempt, inputs = request.inputs;
          this.#publish();
          const response = await this.#call("save", request); this.#attempt = undefined;
          if (response.status === "conflict" && response.state) {
            const merged = mergeCharacter(base, this.#input, response.state.inputs);
            if (merged) { this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision; this.#baseInputs = structuredClone(response.state.inputs); this.#input = merged; this.#render(); continue; }
            this.#blocked = true; this.#message = "This character was edited elsewhere. Your pending input remains on this page. Reload the character before continuing."; this.#status(); break;
          }
          if (response.evaluation) this.#evaluation = response.evaluation;
          if (response.status !== "ready" || !response.state) {
            this.#response = { ...this.#response, ...response };
            this.#blocked = true; this.#message = response.message;
            if (response.status === "invalid" && version !== this.#changeVersion) { this.#blocked = false; continue; }
            this.#saveIssues = response.status === "invalid" ? rows(response.evaluation?.guidance["saveIssues"] ?? response.evaluation?.issues).filter(issue => issue["severity"] === "blocker").map(issue => String(issue["message"])) : [];
            this.#render(); break;
          }
          this.#response = { ...this.#response, ...response }; this.#baseRevision = response.revision; this.#baseInputs = structuredClone(response.state.inputs); this.#evaluation = response.evaluation;
          // Incorporate server corrections without replacing objects bound to active fields.
          if (this.#input.play.asOf === inputs.play.asOf) this.#input.play.asOf = response.state.inputs.play.asOf;
          if (this.#input.play.hp === inputs.play.hp) this.#input.play.hp = response.state.inputs.play.hp;
          this.#input.build.choices = reconcileCharacterChoices(inputs.build.choices, this.#input.build.choices, response.state.inputs.build.choices);
          reconcileCharacterMap(inputs.build.spells.grantChoices,this.#input.build.spells.grantChoices,response.state.inputs.build.spells.grantChoices);
          reconcileCharacterMap(inputs.build.spells.castingAbilities,this.#input.build.spells.castingAbilities,response.state.inputs.build.spells.castingAbilities);
          reconcileCharacterMap(inputs.play.resourceUses,this.#input.play.resourceUses,response.state.inputs.play.resourceUses);
          reconcileCharacterMap(inputs.play.activeFeatures,this.#input.play.activeFeatures,response.state.inputs.play.activeFeatures);
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
      }).finally(() => { if (epoch === this.#epoch) { this.#saving = undefined; this.#publish(); if (!this.#dirty && !this.#evaluation) void this.#refreshSaved(true); } });
      this.#publish(); return this.#saving;
    }
    async #evaluate(render: boolean): Promise<void> {
      if (this.#command) return;
      if (this.#dirty) { await this.#flush(); return; }
      const response = await this.#call("evaluate", { ...this.#base("build"), inputs: structuredClone(this.#input) });
      this.#evaluation = response.evaluation; if (render) this.#render();
    }
    #view(): BuildView { return { locale: this.#context?.host.locale ?? "en", input: this.#input, evaluation: this.#evaluation, policy: this.#response?.policy ?? {}, catalogs: this.#catalogs, changed: this.#changed, navigate: tab => { this.#builderNav.tab = tab; }, refresh: () => this.#render() }; }
    #render(): void {
      this.lang = this.#context?.host.locale ?? "en";
      if (!this.isConnected || !this.#context) return;
      const dialog = this.#dialog?.open ? this.#dialog : undefined;
      for (const picker of this.querySelectorAll<HTMLDetailsElement>("[data-spell-picker]")) {
        const state = this.#spellPickers.get(picker.dataset["spellPicker"]!); if (state) state.open = picker.open;
      }
      const management = this.querySelector<HTMLDetailsElement>("[data-spell-management]"); if (management) this.#spellManagementOpen = management.open;
      const rail = this.querySelector<HTMLDetailsElement>(".dse-build-rail"); if (rail) this.#builderNav.open = rail.open;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      const focusKey = focused?.dataset["focusKey"], focusId = focused?.id;
      const selection = focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement ? { start: focused.selectionStart, end: focused.selectionEnd } : undefined;
      const root = styled("section", "dnd-sheet-shell dse-layout-" + this.#layout);
      this.dataset["layout"] = this.#layout;
      if (!this.#response) {
        const status = el("p", this.#feedback(this.#message || "Loading character…")); status.setAttribute("role", "status");
        root.append(status); if (!this.#busy) root.append(button(this.#t("Reload saved character"), () => this.#load()));
        for (const child of [...this.children]) if (child !== dialog) child.remove();
        this.prepend(root); return;
      }
      const view = this.#sheetView();
      const options = ["sheet", "combat", "spells", "builder", "tools"].map(id => ({ id, label: this.#t(({ sheet: "Sheet", combat: "Combat", spells: "Spells", builder: "Builder", tools: "Tools" } as Record<string,string>)[id]!) }));
      const nav = tabStrip(this.#t("Character views"), options, this.#tab, id => { this.#tab = id as Tab; this.#render(); }, "dnd", "vertical");
      nav.classList.add("dnd-sheet-tabs");
      const status = styled("div", "dnd-save-status"); status.dataset["characterStatus"] = ""; status.dataset["focusKey"] = "save-status"; status.setAttribute("role", "status"); status.tabIndex = -1; this.#saveFeedback(status);
      const content = styled("div", "dnd-sheet-panel"); content.id = "dnd-panel-" + this.#tab; content.setAttribute("role", "tabpanel"); content.setAttribute("aria-labelledby", "dnd-tab-" + this.#tab);
      if (this.#tab === "builder") content.append(this.#builder());
      else if (this.#tab === "tools") content.append(this.#tools());
      else if (this.#tab === "spells") content.append(vitals(view), this.#spells());
      else {
        const main = styled("div", "dse-cols-main", vitals(view));
        if (!this.#response.state) main.append(panel(this.#t("Create your character"), el("p", this.#t("Choose your origin, abilities and first class to start building.")), button(this.#t("Open Builder"), () => { this.#tab = "builder"; this.#render(); })));
        main.append(quickUse(view), this.#tab === "combat" ? this.#combat() : backpack(view));
        content.append(styled("div", "dse-cols", abilityRail(view), main));
      }
      root.append(nav, styled("div", "dnd-sheet-workspace", status, content));
      for (const field of root.querySelectorAll<HTMLElement>(".character-field")) {
        const scope = field.closest<HTMLElement>("[id^=character-choice-], [data-item], [data-builder-target]");
        // The shared controls restore focus during refresh, before local caret restoration.
        if (field.dataset["uiKey"] === field.querySelector("label")?.textContent) field.dataset["uiKey"] = (scope?.id || scope?.dataset["item"] || scope?.dataset["builderTarget"] || "") + "/" + field.querySelector("label")?.textContent;
      }
      for (const child of [...this.children]) if (child !== dialog) child.remove();
      this.prepend(root); this.#syncBusyButtons(); this.#controls?.refresh(); this.#publish();
      for (const field of root.querySelectorAll<HTMLElement>(".character-field")) {
        for (const control of field.querySelectorAll<HTMLElement>("input,select,textarea,button")) control.dataset["focusKey"] = field.dataset["uiKey"] + "/" + (control.getAttribute("aria-label") ?? control.tagName);
      }
      const restore = focusKey ? root.querySelector<HTMLElement>('[data-focus-key="' + CSS.escape(focusKey) + '"]') : focusId ? root.querySelector<HTMLElement>("#" + CSS.escape(focusId)) : undefined;
      for (let parent = restore?.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
      restoreControlFocus(restore);
      if (selection?.start !== null && selection?.start !== undefined && selection.end !== null && (restore instanceof HTMLTextAreaElement || restore instanceof HTMLInputElement)) restore.setSelectionRange(selection.start, selection.end);
    }
    #sheetView(): SheetView {
      const editing = this.#editable && this.#response?.status !== "unavailable" && !this.#response?.rulesChanged;
      const canPlay = editing && this.#evaluation?.ready === true && !!this.#response?.state;
      return { locale: this.#context?.host.locale ?? "en", layout: this.#layout, input: this.#input, projection: this.#response?.state?.projection, catalogs: this.#catalogs,
        equipment: this.#response?.rulesChanged || this.#response?.status === "unavailable" ? {} : object(this.#evaluation?.guidance["equipment"]),
        editing, canPlay,
        canEditInspiration: editing && object(this.#evaluation?.guidance["authoredPlay"])["inspiration"] === true,
        canEditQuickUse: editing && object(this.#evaluation?.guidance["authoredPlay"])["quickUse"] === true,
        quickUse: editing ? object(this.#evaluation?.guidance["quickUse"]) : {},
        // A rejected HP value must remain correctable while other play actions are blocked.
        canEditHP: editing && !!this.#response?.state && (canPlay || this.#dirty && rows(this.#evaluation?.guidance["saveIssues"]).some(issue => issue["target"] === "hp")),
        change: this.#changed, refresh: () => this.#render(), addItem: () => this.#equipment(), fillSlot: slot => this.#slot(slot),
        act: (change, summary) => this.#perform({ ...this.#base("play"), change, summary }) };
    }
    #equipment(): void {
      this.#open(this.#t("Add equipment"), [equipmentPicker(this.#catalogs, this.#context?.host.locale ?? "en", items => {
        this.#input.play.inventory.push(...items); this.#changed(); this.#dialog?.close(); this.#render();
      })]);
    }
    #slot(slot: EquipmentSlot): void {
      const view = this.#sheetView(), attuning = slot === "attuned";
      const choices = this.#input.play.inventory.filter(item => item.quantity > 0 && (attuning
        ? item.location === "equipped" && !item.attuned && object(view.equipment[item.id])["attuneReason"] !== "not-required"
        : item.location !== "equipped" && equipmentSlot(item, view.equipment, view.projection) === slot));
      const picker = styled("div", "dnd-slot-picker");
      for (const item of choices) {
        const guidance = object(view.equipment[item.id]), allowed = guidance[attuning ? "canAttune" : "canEquip"] === true;
        const action = button(item.name, () => {
          const changed = attuning ? attuneEquipment(item, true, view.equipment) : moveEquipment(this.#input.play.inventory, item.id, "equipped", view.equipment, view.projection);
          if (changed) { this.#changed(); this.#dialog?.close(); this.#render(); }
        }, !allowed);
        const row = styled("div", "dnd-equipment-choice", action), reason = equipmentReason(guidance[attuning ? "attuneReason" : "equipReason"], view.locale);
        if (!allowed && reason) {
          const description = el("p", reason); description.id = "equipment-reason-" + encodeURIComponent(item.id);
          action.setAttribute("aria-describedby", description.id); row.append(description);
        }
        picker.append(row);
      }
      this.#open(attuning ? this.#t("Attune an item") : this.#t("Choose {0}", [this.#t(label(slot))]), [picker,
        ...(attuning ? [el("p", this.#t("Equip an item before selecting it here. Moving an attuned item keeps its attunement until you explicitly end it."))] : []),
        ...(!choices.length ? [el("p", this.#t(this.#input.play.inventory.length ? "No other items are available for this slot." : "Add an item to your backpack first."))] : []),
        button(this.#t("Add item"), () => this.#equipment())], "heading");
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
        if (target) focusBuilderTarget(this, target);
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
        controls.disabled=false;
        controls.append(savedSpellBook(this.#input,view.projection,view.locale));
      }
      const choices = el("details", el("summary", this.#t("Manage spells"))), fields = el("fieldset"); fields.disabled = !this.#editable || this.#response?.status === "unavailable" || !!this.#response?.rulesChanged;
      choices.dataset["spellManagement"] = ""; choices.open = this.#spellManagementOpen;
      fields.append(this.#spellChoices()); choices.append(fields);
      root.append(controls, choices);
      return root;
    }
    #tools(): HTMLElement {
      const tools = styled("div", "character-toolbar", field(this.#t("Sheet layout"), select(this.#layout, [{id:"compact",label:this.#t("Compact")},{id:"classic",label:this.#t("Classic")}], value => {
        if (!value) return; this.#layout = value as Layout; try { localStorage.setItem("dnd-character-layout:" + this.#response?.actorId + ":" + this.#key, value); } catch { /* Session-only preference. */ } this.#render();
      }, this.#t)));
      if (this.#response?.state) tools.append(button(this.#t("Export character"), () => download(this.#key + ".character.json", exportCharacter(this.#response!.state!)), false, "export-character"), button(this.#t("Print / PDF"), () => this.#print(this.#response!.state!, this.#response!.revision), false, "print-character"));
      tools.append(button(this.#t("Import character"), () => this.#import(), !this.#editable, "import-character"), button(this.#t("Reload character"), () => this.#reloadSaved(), this.#busy || !!this.#saving, "reload-character"));
      const provider = panel(this.#t("Rules"), el("p", this.#t(this.#response?.status === "unavailable" ? "Compatible rules are unavailable. Saved values and notes remain accessible." : this.#response?.rulesChanged ? "The rules changed. Adopt them to continue editing." : "Rules are connected.")));
      if (this.#response?.rulesChanged) {
        if (this.#dirty) provider.append(el("p", this.#t("Adopting rules will also save your pending changes.")));
        const adopt = button(this.#t(this.#dirty ? "Adopt rules and save pending changes" : "Adopt current rules"), () => this.#perform({ ...this.#base("adopt-rules"), inputs: structuredClone(this.#input), adoptRules: true }), !this.#editable || !!this.#attempt);
        adopt.dataset["focusKey"] = "adopt-rules"; provider.append(adopt);
      }
      return el("div", tools, provider);
    }
    #spellChoices(): HTMLElement {
      const root = panel(this.#t("Spells")), options = this.#evaluation?.spellOptions ?? {}, casting = object(this.#evaluation?.sheet["spellcasting"]), spells = this.#catalogs.get("spell") ?? [];
      root.append(...unassignedSpellState(this.#input,this.#evaluation,()=>{this.#changed();this.#render();void this.#evaluate(true);},this.#context?.host.locale ?? "en"));
      const picks = (title: string, ids: string[], current: string[], set: (ids: string[]) => void, maximum: number, target: string): HTMLElement => {
        let state = this.#spellPickers.get(target);
        if (!state) { state = { open: false, query: "", level: "" }; this.#spellPickers.set(target, state); }
        return spellPicker(title, target, ids, current, maximum, spells, state, this.#context?.host.locale ?? "en", value => { set(value); this.#changed(); });
      };
      for (const classOptions of rows(options["classes"])) {
        const id = String(classOptions["classId"]), caster = rows(casting["perClass"]).find(row => row["classId"] === id) ?? {}, eligible = strings(classOptions["spellIds"]), zero = eligible.filter(id => Number(spells.find(record => record.id === id)?.value["level"]) === 0), leveled = eligible.filter(id => !zero.includes(id));
        root.append(picks(this.#t("{0} cantrips · {1} allowed", [this.#t(label(id)), human(caster["cantripsKnown"])]), zero, this.#input.build.spells.cantrips[id] ?? [], value => { this.#input.build.spells.cantrips[id] = value; }, Number(caster["cantripsKnown"]), "cantrips:" + id));
        if (caster["prepares"] === "spellbook") root.append(picks(this.#t("{0} spellbook · {1} gained from levels", [this.#t(label(id)), human(caster["spellbookKnown"])]), leveled, this.#input.build.spells.spellbook[id] ?? [], value => { this.#input.build.spells.spellbook[id] = value; }, Number(caster["spellbookKnown"]) + this.#input.build.spells.acquisitions.filter(row => row.classId === id).length, "spellbook:" + id));
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
        root.append(picks(this.#t("{0} prepared spells · {1} allowed", [this.#t(label(id)), human(caster["preparedLimit"])]), caster["prepares"] === "spellbook" ? this.#input.build.spells.spellbook[id] ?? [] : leveled, this.#input.play.preparedSpells[id] ?? [], value => { this.#input.play.preparedSpells[id] = value; }, Number(caster["preparedLimit"]), "prepared:"+id));
      }
      for (const choice of rows(options["pendingChoices"])) { const key = String(choice["key"]); root.append(picks(spellSourceLabel(choice["source"],this.#context?.host.locale)+" · "+this.#t("Granted spells · choose {0}", [choice["choose"]]), strings(choice["eligibleSpellIds"]), this.#input.build.spells.grantChoices[key] ?? [], value => { this.#input.build.spells.grantChoices[key] = value; }, Number(choice["choose"]), key)); }
      for (const choice of rows(options["castingAbilityChoices"])) { const key = String(choice["key"]); root.append(builderTarget(key, field(spellSourceLabel(choice["source"],this.#context?.host.locale)+" · "+this.#t("Granted spellcasting ability"), select(this.#input.build.spells.castingAbilities[key] ?? "", strings(choice["options"]).map(id => ({ id, label: id })), value => { this.#input.build.spells.castingAbilities[key] = value; this.#changed(); }, this.#t)))); }
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
      const epoch = this.#epoch;
      if (!this.#editable) return;
      await this.#saving;
      if (!this.#editable || epoch !== this.#epoch || request.key !== this.#key) return;
      // Explicit adoption saves the preserved input with new rules. A rejected
      // autosave cannot precede it, and an uncertain request must be resolved first.
      const adoptingRules = request.operation === "adopt-rules" && request.adoptRules === true && this.#response?.rulesChanged === true;
      if (!adoptingRules) await this.#flush();
      if (this.#dirty && !adoptingRules || this.#attempt || !this.#editable || epoch !== this.#epoch || request.key !== this.#key) return;
      clearTimeout(this.#timer);
      request.expectedRevision = this.#baseRevision;
      if (request.inputs && request.operation !== "import") request.inputs = structuredClone(this.#input);
      if (request.operation !== "import") {
        this.#changeVersion++;
        this.#command = { method: "save", request: structuredClone(request), retry: true };
        await this.#sendCommand(); return;
      }
      await this.#guard(async () => {
        const response = await this.#call("preview", request); this.#message = response.message;
        const content: Node[] = [el("p", this.#t("Replace this character with the imported build and play state?")), comparisonView(response.changes ?? [], response.evaluation, this.#context?.host.locale)];
        if (response.token) content.push(button(this.#t("Replace character"), async () => {
          if (!this.#editable) return;
          // Keep the approved token and revision. Retrying must never create or
          // approve a new preview, even if another editor changes the character.
          this.#changeVersion++;
          this.#command = { method: "commit", request: { key: request.key, expectedRevision: response.revision, operationId: request.operationId!, token: response.token! }, retry: true };
          this.#dialog?.close(); await this.#sendCommand();
        }));
        this.#open(this.#t("Import character"), content, "heading", "import-character");
      });
    }
    async #sendCommand(): Promise<void> {
      const attempt = this.#command, epoch = this.#epoch;
      if (!attempt || this.#busy) return;
      this.#message = "Saving…";
      await this.#guard(async () => {
        try {
          const response = await this.#call(attempt.method, attempt.request);
          if (response.status === "ready" && response.state) {
            this.#command = undefined; this.#accept(response); this.#message = "Saved";
          } else {
            // A changed revision or review requires an explicit read/decision;
            // never rebase a non-idempotent command onto newer saved inputs.
            attempt.retry = response.status === "unavailable";
            this.#message = response.message;
          }
        } catch (error) {
          if (epoch === this.#epoch && this.isConnected) {
            const expiredReview = attempt.method === "commit" && object(error)["status"] === 409 && object(error)["code"] === "CONFLICT";
            attempt.retry = !expiredReview; this.#message = expiredReview
              ? "This review is no longer valid. Check the saved character before reviewing another import."
              : "The action's outcome could not be confirmed.";
          }
        }
      });
      if (epoch !== this.#epoch || !this.isConnected) return;
      if (this.#command) this.querySelector<HTMLElement>("[data-character-status]")?.focus();
      else if (!this.#evaluation) {
        await this.#refreshSaved(true);
        if (epoch === this.#epoch && !this.#command && !this.#dirty) { this.#message = "Saved"; this.#status(); }
      }
    }
    #open(title: string, content: Node[], initialFocus: "control" | "heading" = "control", returnFocusKey?: string): void {
      this.#dialog?.close(); this.#dialog?.remove();
      const heading = el("h2", title), dialog: HTMLDialogElement = el("dialog", heading, ...content, button(this.#t("Close"), () => dialog.close()));
      dialog.className = "character-dialog"; dialog.dataset["uiDialog"] = ""; heading.id = `character-dialog-${newId()}`; dialog.setAttribute("aria-labelledby", heading.id);
      if (initialFocus === "heading") { heading.tabIndex = -1; heading.setAttribute("autofocus", ""); }
      const trigger = document.activeElement, focusKey = returnFocusKey ?? (trigger instanceof HTMLElement ? trigger.dataset["focusKey"] : undefined);
      dialog.addEventListener("close", () => {
        if (this.#dialog?.open && this.#dialog !== dialog) return;
        const target = focusKey ? this.querySelector<HTMLElement>('[data-focus-key="' + CSS.escape(focusKey) + '"]') : trigger instanceof HTMLElement && trigger.isConnected ? trigger : undefined;
        restoreControlFocus(target);
      });
      this.#dialog = dialog; this.append(dialog); dialog.showModal(); this.#syncBusyButtons();
    }
    #import(): void {
      let body = "", authorize = false; const area = textInput(body, value => { body = value; }, true), file = el("input"); file.type = "file"; file.accept = ".json,application/json";
      const notice = el("p"); notice.hidden = true; notice.tabIndex = -1; notice.dataset["uiState"] = "error"; notice.setAttribute("role", "alert");
      const clearError = (): void => { notice.hidden = true; notice.textContent = ""; };
      const showError = (error: unknown): void => { notice.textContent = this.#feedback(error instanceof Error ? error.message : "Invalid character file."); notice.hidden = false; notice.focus(); };
      area.addEventListener("input", clearError);
      area.maxLength = 1000000;
      area.spellcheck = false; area.autocapitalize = "off"; area.autocomplete = "off";
      if (area instanceof HTMLTextAreaElement) area.wrap = "off";
      area.addEventListener("paste", event => {
        if (!(event instanceof ClipboardEvent)) return;
        const text = event.clipboardData?.getData("text/plain"); if (text === undefined) return;
        event.preventDefault();
        const start = area.selectionStart ?? 0, end = area.selectionEnd ?? start;
        const next = area.value.slice(0, start) + text + area.value.slice(end);
        if (new TextEncoder().encode(next).length > 1000000) { showError(new Error("This character file exceeds the import limit.")); return; }
        // Native multiline insertion can stall Chromium on large JSON archives.
        // One value update preserves selection semantics without partial input.
        area.value = next; body = next; clearError(); area.setSelectionRange(start + text.length, start + text.length);
      });
      file.addEventListener("change", () => { const selected = file.files?.[0]; if (selected) void this.#guard(async () => {
        try { if (selected.size > 1000000) throw new Error("This character file exceeds the import limit."); body = await selected.text(); area.value = body; clearError(); }
        catch (error) { showError(error); }
      }); });
      this.#open(this.#t("Import character"), [field(this.#t("Choose a file"), file), field(this.#t("Or paste the export"), area), ...(this.#response?.role === "dm" ? [checkbox(this.#t("Authorize imported DM grants as the current DM"), false, value => { authorize = value; clearError(); })] : []), notice, button(this.#t("Review import"), async () => {
        try {
          clearError(); const inputs = parseCharacter(body);
          if (inputs.grants.length && (this.#response?.role !== "dm" || !authorize)) throw new Error("Imported DM grants must be reviewed and authorized by the current DM.");
          this.#dialog?.close(); await this.#perform({ ...this.#base("import"), inputs, reauthorizeGrants: authorize });
        } catch (error) { showError(error); }
      })], "control", "import-character");
    }
    #print(state: State, revision: number): void {
      const options = { spells: true, equipment: true, provenance: false };
      this.#open(this.#t("Print / PDF"), [el("p", this.#t("Choose Save as PDF in the browser print dialog for a PDF copy.")), ...Object.entries(options).map(([key, value]) => checkbox(this.#t(label(key)), value, enabled => { options[key as keyof typeof options] = enabled; })), button(this.#t("Open print preview"), () => { try { printCharacter(state, revision, this.#name, options, this.#context?.host.locale); } catch (error) { this.#message = error instanceof Error ? error.message : "Printing failed."; this.#status(); } })]);
    }
  }
  customElements.define(tag, CharacterElement); return tag;
}
