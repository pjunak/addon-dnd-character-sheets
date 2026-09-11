import { grantForm } from "./character-grant.js";
import { comparisonView } from "./character-comparison.js";
import { translator } from "./character-locale.js";
import { playActions } from "./character-play.js";
import { CharacterClient, DraftStore, TransferStore, blank, exportCharacter, externalHistory, newId, object, parseCharacter, rows, strings } from "./character-client.js";
import { buildView, inventoryView } from "./character-build.js";
import { projectionView, printCharacter } from "./character-projection.js";
import { button, checkbox, download, el, field, human, label, numberInput, panel, rule, select, textInput } from "./character-ui.js";
const navigation = { en: { play: "Play", build: "Build", history: "History" }, cs: { play: "Hra", build: "Tvorba", history: "Historie" } };
export function defineCharacterElement(generation, client) {
    const tag = `dnd-character-${generation}`;
    if (customElements.get(tag))
        return tag;
    class CharacterElement extends HTMLElement {
        #context;
        #response;
        #input = blank();
        #evaluation;
        #baseRevision = 0;
        #dirty = false;
        #busy = false;
        #tab = "play";
        #draft;
        #message = "";
        #epoch = 0;
        #catalogs = new Map();
        #dialog;
        #timer;
        #historyResponse;
        #historyFilter = "all";
        #transfer;
        #layout = "compact";
        #t = (key, values) => translator(this.#context?.host.locale ?? "en")(key, values);
        #unsubscribe;
        #refreshTimer;
        set codexContribution(value) { const previous = this.#context; this.#context = value; if (this.isConnected && previous?.host.key !== value.host.key) {
            this.#epoch++;
            this.#busy = false;
            this.#response = undefined;
            this.#historyResponse = undefined;
            this.#evaluation = undefined;
            this.#catalogs.clear();
            this.#dialog?.close();
            clearTimeout(this.#timer);
            void this.#load();
        }
        else
            this.#render(); }
        connectedCallback() { this.classList.add("addon-dnd-character"); this.#unsubscribe = client.subscribe(() => { clearTimeout(this.#refreshTimer); this.#refreshTimer = setTimeout(() => { void this.#refreshSaved(); }, 250); }); void this.#load(); }
        disconnectedCallback() { this.#epoch++; this.#unsubscribe?.(); clearTimeout(this.#refreshTimer); clearTimeout(this.#timer); this.#dialog?.close(); this.#context?.edits.set({ dirty: false, saving: false }); }
        get #key() { return this.#context?.host.key ?? ""; }
        get #editable() { return this.#context?.host.canEdit === true && !this.#busy; }
        get #name() { return String(object(this.#context?.host.value)["name"] ?? "Character"); }
        #base(operation) { return { key: this.#key, expectedRevision: this.#baseRevision, operation, operationId: newId(), summary: `Update character ${this.#t(label(operation)).toLowerCase()}` }; }
        async #call(method, request) {
            const epoch = this.#epoch, response = await client.call(method, request);
            if (epoch !== this.#epoch || !this.isConnected)
                throw new Error("The character view changed before the request completed.");
            return response;
        }
        async #guard(action) {
            if (this.#busy)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.setAttribute("aria-busy", "true");
            this.#publish();
            this.#syncBusyButtons();
            try {
                await action();
            }
            catch (error) {
                if (epoch === this.#epoch && !client.signal.aborted && this.isConnected)
                    this.#message = error instanceof Error ? error.message : "The character request failed. Your draft is preserved.";
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.removeAttribute("aria-busy");
                    this.#publish();
                    this.#syncBusyButtons();
                    this.#render();
                }
            }
        }
        #syncBusyButtons() {
            for (const control of this.querySelectorAll("button")) {
                if (this.#busy && !control.disabled) {
                    control.dataset["characterBusy"] = "";
                    control.disabled = true;
                }
                else if (!this.#busy && control.hasAttribute("data-character-busy")) {
                    delete control.dataset["characterBusy"];
                    control.disabled = false;
                }
            }
        }
        async #load() {
            if (!this.#key)
                return;
            const epoch = ++this.#epoch;
            await this.#guard(async () => {
                const response = await this.#call("load", { key: this.#key });
                if (epoch !== this.#epoch || !this.isConnected)
                    return;
                this.#response = response;
                this.#evaluation = response.evaluation;
                this.#input = structuredClone(response.state?.inputs ?? blank());
                this.#baseRevision = response.revision;
                this.#dirty = false;
                this.#message = response.message;
                this.#draft = new DraftStore(response.actorId, this.#key);
                this.#transfer = new TransferStore(response.actorId, this.#key);
                try {
                    this.#layout = localStorage.getItem(`dnd-character-layout:${response.actorId}`) === "classic" ? "classic" : "compact";
                }
                catch { /* The presentation remains usable without local storage. */ }
                const draft = this.#draft.read();
                if (draft) {
                    this.#input = draft.inputs;
                    this.#baseRevision = draft.baseRevision;
                    this.#dirty = true;
                    this.#tab = "build";
                    this.#message = draft.baseRevision === response.revision ? "Your unsaved draft was recovered. Review it before saving." : "Your draft was recovered, but the saved character has changed. Review the latest revision before rebasing.";
                }
                if (!response.state)
                    this.#tab = "build";
                const kinds = ["class", "species", "background", "subclass", "feat", "armor", "weapon", "magic-item", "gear", "spell"];
                const results = await Promise.allSettled(kinds.map(kind => client.catalog(kind)));
                if (epoch !== this.#epoch || !this.isConnected)
                    return;
                results.forEach((result, index) => { if (result.status === "fulfilled")
                    this.#catalogs.set(kinds[index], result.value); });
                if (results.some(result => result.status === "rejected"))
                    this.#message = "Some source catalogs could not be loaded. The saved character and draft remain available; reload to retry.";
            });
        }
        #publish() { this.#context?.edits.set({ dirty: this.#dirty, saving: this.#busy }); }
        async #refreshSaved() {
            if (this.#busy || !this.#response)
                return;
            try {
                const response = await this.#call("load", { key: this.#key });
                if (response.revision === this.#response.revision)
                    return;
                this.#response = response;
                if (this.#dirty) {
                    this.#message = "The saved character changed. Your draft is preserved; compare and rebase it before saving.";
                    this.#status();
                }
                else {
                    this.#input = structuredClone(response.state?.inputs ?? blank());
                    this.#baseRevision = response.revision;
                    this.#evaluation = response.evaluation;
                    this.#message = "The latest saved character revision was loaded.";
                    this.#render();
                }
            }
            catch {
                if (this.isConnected) {
                    this.#message = "Could not refresh the saved character. Your current view and draft remain available.";
                    this.#status();
                }
            }
        }
        #changed = () => {
            this.#dirty = true;
            this.#publish();
            try {
                this.#draft?.write(this.#input, this.#baseRevision);
                this.#message = "Draft saved on this device. Character history changes only after review and save.";
            }
            catch {
                this.#message = "This browser could not save your draft. Export the draft before leaving this page.";
            }
            this.#status();
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => { void this.#evaluate(false); }, 600);
        };
        #status() { const node = this.querySelector("[data-character-status]"); if (node)
            node.textContent = this.#t(this.#message); }
        async #evaluate(render) {
            if (this.#busy)
                return;
            const epoch = this.#epoch, inputs = structuredClone(this.#input);
            try {
                const response = await this.#call("evaluate", { ...this.#base("build"), inputs });
                if (epoch !== this.#epoch || !this.isConnected || JSON.stringify(inputs) !== JSON.stringify(this.#input))
                    return;
                this.#evaluation = response.evaluation;
                if (response.message)
                    this.#message = response.message;
                if (render)
                    this.#render();
                else {
                    this.#status();
                    this.#updateEvaluation();
                }
            }
            catch (error) {
                this.#message = error instanceof Error ? error.message : "Rules preview failed; the draft is retained.";
                this.#status();
            }
        }
        #view() { return { locale: this.#context?.host.locale ?? "en", input: this.#input, evaluation: this.#evaluation, policy: this.#response?.policy ?? {}, catalogs: this.#catalogs, changed: this.#changed, refresh: () => { this.#render(); void this.#evaluate(true); } }; }
        #updateEvaluation() { const node = this.querySelector("[data-character-evaluation]"); if (node)
            node.replaceChildren(this.#issues(), ...(this.#evaluation ? [projectionView(this.#evaluation, this.#context?.host.locale ?? "en")] : [])); }
        #issues() {
            const root = panel(this.#t("Rules review")), issues = this.#evaluation?.issues ?? [];
            if (this.#evaluation?.sheet["status"] === "needs-choices") {
                const list = el("ul");
                for (const message of [Object.keys(this.#input.build.baseScores).length !== 6 && "Assign the six base ability scores.", !this.#input.build.species && "Choose a species.", !this.#input.build.background && "Choose a background.", !this.#input.build.levels.length && "Add your first class level."])
                    if (message)
                        list.append(el("li", this.#t(message)));
                root.append(list);
                return root;
            }
            if (!issues.length)
                root.append(el("p", this.#t(this.#evaluation?.ready ? "All required choices and bounds are satisfied." : "Compatible rules are required to validate changes.")));
            const list = el("ul");
            for (const issue of issues) {
                const item = el("li", this.#t("{0}{1}", [issue.severity === "blocker" ? this.#t("Needs attention: ") : "", issue.message]));
                if (this.#response?.role === "dm")
                    item.append(el("details", el("summary", this.#t("Adjudication reference")), el("code", issue.id)));
                if (issue.reference)
                    item.append(rule(this.#t("Rule details"), issue.reference));
                list.append(item);
            }
            root.append(list);
            return root;
        }
        #render() {
            if (!this.isConnected || !this.#context)
                return;
            const heading = el("header", el("h2", this.#name), el("p", this.#response?.state ? this.#t("Saved revision {0}{1}", [this.#response.revision, this.#dirty ? this.#t(" · draft changes") : ""]) : this.#t("New character · unsaved draft")));
            const status = el("p", this.#t(this.#message));
            status.dataset["characterStatus"] = "";
            status.setAttribute("role", "status");
            const nav = el("nav");
            nav.setAttribute("aria-label", this.#t("Character views"));
            const names = navigation[this.#context.host.locale ?? "en"];
            for (const tab of ["play", "build", "history"]) {
                const control = button(names[tab], () => { this.#tab = tab; this.#render(); if (tab === "history")
                    void this.#history(); });
                control.setAttribute("aria-current", this.#tab === tab ? "page" : "false");
                nav.append(control);
            }
            const tools = el("div");
            tools.className = "character-toolbar";
            this.dataset["layout"] = this.#layout;
            tools.append(field(this.#t("Sheet layout"), select(this.#layout, [{ id: "compact", label: this.#t("Compact") }, { id: "classic", label: this.#t("Classic") }], value => { if (!value)
                return; this.#layout = value; try {
                localStorage.setItem(`dnd-character-layout:${this.#response?.actorId}`, value);
            }
            catch { /* Session-only preference. */ } this.#render(); }, this.#t)));
            if ((this.#response?.revision ?? 0) > 1)
                tools.append(button(this.#t("Undo last change"), () => this.#restore(this.#response.revision - 1, "complete"), !this.#editable || this.#dirty));
            if (this.#response?.state)
                tools.append(button(this.#t("Export saved revision"), () => download(`${this.#key}.character.json`, exportCharacter(this.#response.state))), button(this.#t("Print / PDF"), () => this.#print(this.#response.state, this.#response.revision)));
            if (this.#dirty)
                tools.append(button(this.#t("Export draft"), () => download(`${this.#key}.draft.json`, JSON.stringify({ format: "dnd-character.v1", schemaVersion: "4.0.0", inputs: this.#input }, null, 2))));
            tools.append(button(this.#t("Import character"), () => this.#import(), !this.#editable), button(this.#t("Reload saved character"), () => {
                if (!this.#dirty)
                    return this.#load();
                this.#open(this.#t("Discard this local draft?"), [el("p", this.#t("The saved character and its history will remain. Export this draft first if you want to keep it.")), button(this.#t("Discard draft and reload"), () => { this.#draft?.clear(); this.#dialog?.close(); return this.#load(); })]);
            }, this.#busy));
            const content = el("div");
            content.className = "character-content";
            if (this.#tab === "build") {
                const editor = el("fieldset");
                editor.disabled = !this.#editable;
                editor.append(buildView(this.#view()), this.#spellChoices(), inventoryView(this.#view()), field(this.#t("Character notes"), textInput(this.#input.notes, value => { this.#input.notes = value; this.#changed(); }, true)), button(this.#t("Refresh choices and preview"), () => this.#evaluate(true)), button(this.#t("Review build changes"), () => this.#review({ ...this.#base("build"), inputs: structuredClone(this.#input) })));
                const evaluation = el("aside");
                evaluation.dataset["characterEvaluation"] = "";
                evaluation.append(this.#issues());
                if (this.#evaluation)
                    evaluation.append(projectionView(this.#evaluation, this.#context?.host.locale ?? "en"));
                content.classList.add("character-columns");
                content.append(editor, evaluation);
                editor.append(this.#grants());
                if (this.#baseRevision !== this.#response?.revision)
                    editor.prepend(panel(this.#t("Concurrent changes"), el("p", this.#t("This draft started from an earlier saved revision. Open History to compare it with the current character.")), button(this.#t("Rebase this draft for a new review"), () => { this.#baseRevision = this.#response?.revision ?? 0; this.#changed(); void this.#evaluate(true); })));
            }
            else if (this.#tab === "play") {
                if (this.#response?.state)
                    content.append(this.#play(), projectionView(this.#response.state.projection, this.#context?.host.locale ?? "en"), this.#grants());
                else
                    content.append(el("p", this.#t("Finish the build and save its first revision to start playing.")));
            }
            else
                content.append(this.#historyView());
            const dialog = this.#dialog?.open ? this.#dialog : undefined;
            // Keep modal nodes mounted: removing an open native dialog closes it.
            for (const child of [...this.children])
                if (child !== dialog)
                    child.remove();
            this.prepend(heading, status, nav, tools, content);
        }
        #play() {
            const state = this.#response.state, play = state.inputs.play, root = panel(this.#t("Play state"), el("p", this.#t("HP {0} / {1} · Temporary HP {2}", [play.hp, human(object(state.projection.sheet["derived"])["maxHp"]), play.temporaryHp])));
            const controls = el("fieldset");
            controls.disabled = !this.#editable || this.#response?.status === "unavailable" || this.#response?.rulesChanged === true;
            let amount = 0;
            controls.append(field(this.#t("Amount"), numberInput(0, value => { amount = value ?? 0; }, 0)));
            for (const operation of ["damage", "heal", "set-hp", "set-temporary-hp"])
                controls.append(button(this.#t(label(operation)), () => this.#review({ ...this.#base("play"), change: { operation, amount }, summary: `${this.#t(label(operation))} ${amount}` }), this.#dirty));
            for (const rest of ["short", "long"])
                controls.append(button(this.#t("{0} rest", [this.#t(label(rest))]), () => this.#review({ ...this.#base("play"), change: { operation: "rest", rest }, summary: `${this.#t(label(rest))} rest` }), this.#dirty));
            for (const resource of rows(state.projection.sheet["resources"])) {
                const key = String(resource["key"]), maximum = Number(resource["max"]);
                controls.append(field(this.#t("{0} — spent / {1}", [human(resource["name"]), maximum]), numberInput(this.#input.play.resourceUses[key] ?? 0, value => { this.#input.play.resourceUses[key] = value ?? 0; this.#changed(); }, 0, maximum)));
            }
            for (const coin of ["cp", "sp", "ep", "gp", "pp"])
                controls.append(field(coin.toUpperCase(), numberInput(this.#input.play.currency[coin] ?? 0, value => { this.#input.play.currency[coin] = value ?? 0; this.#changed(); }, 0)));
            controls.append(button(this.#t("Review counter changes"), () => this.#review({ ...this.#base("inventory"), inputs: structuredClone(this.#input), summary: "Update resources and currency" })));
            for (const activation of rows(state.projection.sheet["activations"])) {
                const key = String(activation["key"]);
                controls.append(button(this.#t("{0} {1}", [this.#t(play.activeFeatures[key] ? "End" : "Activate"), human(activation["name"])]), () => this.#review({ ...this.#base("play"), change: { operation: "toggle-feature", key, enabled: !play.activeFeatures[key] }, summary: `Toggle ${human(activation["name"])}` }), this.#dirty));
            }
            if (this.#response?.rulesChanged)
                root.append(el("p", this.#t("The installed rules or allowed sources changed. Review and adopt them in Build before playing.")));
            if (this.#dirty)
                root.append(el("p", this.#t("Review your draft before applying other play actions.")));
            if (this.#evaluation)
                controls.append(playActions(this.#input, this.#evaluation, this.#catalogs.get("spell") ?? [], (change, summary) => this.#review({ ...this.#base("play"), change, summary }), this.#context?.host.locale));
            root.append(controls);
            const notes = textInput(this.#input.notes, value => { this.#input.notes = value; this.#changed(); }, true);
            notes.disabled = !this.#editable;
            root.append(field(this.#t("Character notes"), notes), button(this.#t("Save notes"), () => this.#review({ ...this.#base("notes"), inputs: structuredClone(this.#input), summary: "Update character notes" }), !this.#editable));
            return root;
        }
        #spellChoices() {
            const root = panel(this.#t("Spells")), options = this.#evaluation?.spellOptions ?? {}, casting = object(this.#evaluation?.sheet["spellcasting"]), spells = this.#catalogs.get("spell") ?? [];
            const picks = (title, ids, current, set) => {
                const details = el("details", el("summary", this.#t("{0} ({1} selected)", [title, current.length]))), list = el("div");
                let query = "";
                const render = () => { list.replaceChildren(); const shown = [...new Set([...current, ...ids])].filter(id => `${spells.find(record => record.id === id)?.value["name"] ?? id}`.toLowerCase().includes(query)).slice(0, 100); for (const id of shown) {
                    const record = spells.find(record => record.id === id);
                    list.append(el("div", checkbox(String(record?.value["name"] ?? id), current.includes(id), selected => { current = selected ? [...current, id] : current.filter(item => item !== id); set(current); this.#changed(); }), rule(this.#t("Details"), { kind: "spell", id })));
                } };
                details.append(field(this.#t("Filter spells"), textInput("", value => { query = value.toLowerCase(); render(); })), list);
                render();
                return details;
            };
            for (const classOptions of rows(options["classes"])) {
                const id = String(classOptions["classId"]), caster = rows(casting["perClass"]).find(row => row["classId"] === id) ?? {}, eligible = strings(classOptions["spellIds"]), zero = eligible.filter(id => Number(spells.find(record => record.id === id)?.value["level"]) === 0), leveled = eligible.filter(id => !zero.includes(id));
                root.append(picks(this.#t("{0} cantrips · {1} allowed", [this.#t(label(id)), human(caster["cantripsKnown"])]), zero, this.#input.build.spells.cantrips[id] ?? [], value => { this.#input.build.spells.cantrips[id] = value; }));
                if (caster["prepares"] === "spellbook")
                    root.append(picks(this.#t("{0} spellbook · {1} gained from levels", [this.#t(label(id)), human(caster["spellbookKnown"])]), leveled, this.#input.build.spells.spellbook[id] ?? [], value => { this.#input.build.spells.spellbook[id] = value; }));
                if (caster["prepares"] === "spellbook") {
                    const order = el("details", el("summary", this.#t("Spellbook acquisition order")), el("p", this.#t("Level-granted spells use slots in this order. Copied spells keep their separate paid acquisition.")));
                    const selected = this.#input.build.spells.spellbook[id] ?? [];
                    for (const [index, spell] of selected.entries()) {
                        const gain = rows(options["acquisitionLevels"]).find(row => row["classId"] === id && row["id"] === spell);
                        const move = (offset) => { const next = [...selected]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; this.#input.build.spells.spellbook[id] = next; this.#changed(); this.#render(); void this.#evaluate(true); };
                        order.append(el("div", rule(String(spells.find(record => record.id === spell)?.value["name"] ?? spell), { kind: "spell", id: spell }), el("span", gain ? this.#t("Character level {0}", [gain["level"]]) : this.#t("Copied or awaiting evaluation")), button(this.#t("Move earlier"), () => move(-1), index === 0), button(this.#t("Move later"), () => move(1), index === selected.length - 1)));
                    }
                    root.append(order);
                }
                root.append(picks(this.#t("{0} prepared spells · {1} allowed", [this.#t(label(id)), human(caster["preparedLimit"])]), caster["prepares"] === "spellbook" ? this.#input.build.spells.spellbook[id] ?? [] : leveled, this.#input.play.preparedSpells[id] ?? [], value => { this.#input.play.preparedSpells[id] = value; }));
            }
            for (const choice of rows(options["pendingChoices"])) {
                const key = String(choice["key"]);
                root.append(picks(`Granted spells · choose ${human(choice["choose"])}`, strings(choice["eligibleSpellIds"]), this.#input.build.spells.grantChoices[key] ?? [], value => { this.#input.build.spells.grantChoices[key] = value; }));
            }
            for (const choice of rows(options["castingAbilityChoices"])) {
                const key = String(choice["key"]);
                root.append(field(this.#t("Granted spellcasting ability"), select(this.#input.build.spells.castingAbilities[key] ?? "", strings(choice["options"]).map(id => ({ id, label: id })), value => { this.#input.build.spells.castingAbilities[key] = value; this.#changed(); }, this.#t)));
            }
            return root;
        }
        #grants() {
            const root = panel(this.#t("DM given"), el("p", this.#t("Reusable homebrew rules belong in a versioned source add-on. These grants record character-specific rewards and exceptions.")));
            for (const grant of this.#response?.state?.inputs.grants ?? []) {
                root.append(el("p", this.#t("{0} · {1} · {2} · {3} · {4}", [grant.name, this.#t(grant.active ? "active" : "revoked"), grant.reason, grant.actorId, grant.grantedAt])));
                if (grant.active && this.#response?.role === "dm")
                    root.append(button(this.#t("Amend {0}", [grant.name]), () => this.#grant(grant), !this.#editable), button(this.#t("Revoke {0}", [grant.name]), () => this.#review({ ...this.#base("revoke-grant"), grantId: grant.id, inputs: structuredClone(this.#input), summary: `Revoke DM grant: ${grant.name}` }), !this.#editable));
            }
            if (this.#response?.role === "dm")
                root.append(button(this.#t("Give a DM grant"), () => this.#grant(), !this.#editable));
            return root;
        }
        #grant(previous) {
            this.#open(previous ? this.#t("Amend {0}", [previous.name]) : this.#t("DM given"), grantForm(this.#input, this.#evaluation, this.#catalogs.get("feat") ?? [], previous, grant => {
                this.#dialog?.close();
                return this.#review({ ...this.#base(previous ? "amend-grant" : "grant"), inputs: structuredClone(this.#input), grant, ...(previous ? { grantId: previous.id } : {}), summary: `DM given: ${grant.name} — ${grant.reason}` });
            }, this.#context?.host.locale));
        }
        async #review(request) {
            const invalid = [...this.querySelectorAll("input,select,textarea")].find(input => !input.disabled && !input.validity.valid);
            if (invalid) {
                invalid.reportValidity();
                return;
            }
            await this.#guard(async () => {
                const response = await this.#call("preview", request);
                this.#evaluation = response.evaluation;
                this.#message = response.message;
                const content = [el("p", this.#t(response.message || "Review the exact changes below. Saving creates a new retained revision.")), this.#issues()];
                if (response.rulesChanged)
                    content.push(checkbox(this.#t("Adopt the displayed rules and source revision"), request.adoptRules === true, checked => { request.adoptRules = checked; }));
                if (this.#response?.role === "dm" && ["import", "restore"].includes(request.operation ?? ""))
                    content.push(checkbox(this.#t("I authorize the DM grants in this imported or restored character"), request.reauthorizeGrants === true, checked => { request.reauthorizeGrants = checked; }));
                content.push(comparisonView(response.changes ?? [], response.evaluation, this.#context?.host.locale));
                content.push(field(this.#t("History description"), textInput(request.summary ?? "", value => { request.summary = value; })), button(this.#t("Refresh this review"), () => { this.#dialog?.close(); return this.#review(request); }));
                if (response.token) {
                    const token = response.token, reviewedRequest = JSON.stringify(request);
                    content.push(button(this.#t("Save new revision"), () => this.#guard(async () => {
                        if (JSON.stringify(request) !== reviewedRequest) {
                            this.#message = "Refresh the review to include your changed description or authorization.";
                            return;
                        }
                        const saved = await this.#call("commit", { key: this.#key, expectedRevision: response.revision, operationId: request.operationId, token });
                        if (saved.status !== "ready") {
                            this.#message = saved.message;
                            return;
                        }
                        const frozen = request.operation === "notes" && this.#response?.status === "unavailable";
                        this.#response = { ...this.#response, ...saved, ...(frozen ? { status: "unavailable" } : {}) };
                        this.#input = structuredClone(saved.state.inputs);
                        this.#baseRevision = saved.revision;
                        this.#dirty = false;
                        this.#draft?.clear();
                        this.#dialog?.close();
                        this.#tab = "play";
                        this.#message = saved.message;
                    })));
                }
                this.#open(this.#t("Review character changes"), content);
            });
        }
        #open(title, content) {
            this.#dialog?.close();
            this.#dialog?.remove();
            const dialog = el("dialog", el("h2", title), ...content, button(this.#t("Close"), () => dialog.close()));
            dialog.className = "character-dialog";
            const id = `character-dialog-${newId()}`;
            dialog.querySelector("h2").id = id;
            dialog.setAttribute("aria-labelledby", id);
            const trigger = document.activeElement;
            dialog.addEventListener("close", () => { if (trigger instanceof HTMLElement && trigger.isConnected)
                trigger.focus(); });
            this.#dialog = dialog;
            this.append(dialog);
            dialog.showModal();
            this.#syncBusyButtons();
        }
        async #history(before) { await this.#guard(async () => { this.#historyResponse = await this.#call("history", { key: this.#key, ...(before ? { before } : {}) }); }); }
        #historyView() {
            const root = panel(this.#t("Character history"), el("p", this.#t("Every saved change retains its actor, reason and previous result. Restoring creates another revision.")));
            if (this.#response?.state)
                root.append(button(this.#t("Export with history"), () => this.#exportHistory()));
            root.append(field(this.#t("Show changes"), select(this.#historyFilter, [{ id: "all", label: this.#t("All changes") }, { id: "build", label: this.#t("Build") }, { id: "play", label: this.#t("Play and inventory") }, { id: "grant", label: this.#t("DM given") }, { id: "notes", label: this.#t("Notes") }], value => { this.#historyFilter = value || "all"; this.#render(); }, this.#t)));
            if ((this.#response?.revision ?? 0) > 1)
                root.append(button(this.#t("Compare saved revisions"), () => this.#compare()));
            const visible = (this.#historyResponse?.history ?? []).filter(entry => {
                if (this.#historyFilter === "all")
                    return true;
                if (this.#historyFilter === "grant")
                    return entry.operation.includes("grant");
                if (this.#historyFilter === "play")
                    return /play|inventory|spells/u.test(entry.operation);
                return entry.operation.endsWith(this.#historyFilter);
            });
            for (const entry of visible)
                root.append(panel(this.#t("Revision {0}", [entry.revision]), el("p", this.#t("{0} · {1} · {2}", [entry.summary, entry.actorId, new Date(entry.occurredAt).toLocaleString()])), button(this.#t("Inspect revision"), () => this.#guard(async () => {
                    const previous = await this.#call("revision", { key: this.#key, revision: entry.revision });
                    const state = previous.state;
                    this.#open(this.#t("Saved revision {0}", [entry.revision]), [projectionView(state.projection, this.#context?.host.locale ?? "en"), el("p", this.#t("Notes: {0}", [state.inputs.notes])), button(this.#t("Export this revision"), () => download(`${this.#key}.r${entry.revision}.json`, exportCharacter(state))), button(this.#t("Print this revision"), () => this.#print(state, entry.revision)), button(this.#t("Review restoration"), () => { this.#dialog?.close(); this.#restore(entry.revision); }, !this.#context?.host.canEdit || this.#dirty)]);
                }))));
            if (!this.#historyResponse?.history?.length)
                root.append(el("p", this.#t("No saved revisions yet.")));
            if (this.#historyResponse?.nextBefore)
                root.append(button(this.#t("Older revisions"), () => this.#history(this.#historyResponse.nextBefore)));
            return root;
        }
        #compare() {
            const maximum = this.#response?.revision ?? 1;
            let before = Math.max(1, maximum - 1), after = maximum;
            const from = numberInput(before, value => { before = value ?? 0; }, 1, maximum);
            const to = numberInput(after, value => { after = value ?? 0; }, 1, maximum);
            from.required = true;
            to.required = true;
            this.#open(this.#t("Compare saved revisions"), [field(this.#t("Earlier revision"), from), field(this.#t("Later revision"), to), button(this.#t("Show comparison"), () => {
                    if (!from.reportValidity() || !to.reportValidity())
                        return;
                    return this.#guard(async () => {
                        const response = await this.#call("compare", { key: this.#key, revision: before, compareRevision: after });
                        this.#open(this.#t("Revision {0} → {1}", [before, after]), [comparisonView(response.changes ?? [], response.state?.projection, this.#context?.host.locale), projectionView(response.state.projection, this.#context?.host.locale)]);
                    });
                })]);
        }
        #restore(revision, scope = "build") {
            let restoreScope = scope, reauthorizeGrants = false;
            this.#open(this.#t("Restore revision {0}", [revision]), [el("p", this.#t("Build restoration keeps current HP, resources, inventory and notes. Every restoration creates a new history entry.")), field(this.#t("Restore"), select(restoreScope, [{ id: "build", label: this.#t("Build decisions and grants") }, { id: "play", label: this.#t("Play state and inventory") }, { id: "complete", label: this.#t("Complete character, including notes") }], value => { restoreScope = value; }, this.#t)), ...(this.#response?.role === "dm" ? [checkbox(this.#t("Authorize differences in DM grants"), false, value => { reauthorizeGrants = value; })] : []), button(this.#t("Compare restoration"), () => { this.#dialog?.close(); return this.#review({ ...this.#base("restore"), revision, restoreScope, reauthorizeGrants, summary: `Restore ${restoreScope} from revision ${revision}` }); })]);
        }
        #import() {
            let body = this.#transfer?.read() ?? "", authorize = false;
            const area = textInput(body, value => { body = value; }, true), file = el("input");
            file.type = "file";
            file.accept = ".json,application/json";
            area.maxLength = 1000000;
            area.spellcheck = false;
            area.autocapitalize = "off";
            area.autocomplete = "off";
            if (area instanceof HTMLTextAreaElement)
                area.wrap = "off";
            area.addEventListener("paste", event => {
                if (!(event instanceof ClipboardEvent))
                    return;
                const text = event.clipboardData?.getData("text/plain");
                if (text === undefined)
                    return;
                event.preventDefault();
                const start = area.selectionStart ?? 0, end = area.selectionEnd ?? start;
                const next = area.value.slice(0, start) + text + area.value.slice(end);
                if (new TextEncoder().encode(next).length > 1000000) {
                    this.#message = "This character file exceeds the import limit.";
                    this.#status();
                    return;
                }
                // Native multiline insertion can stall Chromium on large JSON archives.
                // One value update preserves selection semantics without partial input.
                area.value = next;
                body = next;
                area.setSelectionRange(start + text.length, start + text.length);
            });
            file.addEventListener("change", () => { const selected = file.files?.[0]; if (selected)
                void this.#guard(async () => { if (selected.size > 1000000)
                    throw new Error("This character file exceeds the import limit."); body = await selected.text(); area.value = body; }); });
            this.#open(this.#t("Import current character"), [el("p", this.#t("File and paste use the same validation and replacement review. The current revision will remain in History.")), el("p", this.#t("Save a frozen import on this device when rules are unavailable. Its claimed calculations and external history cannot authorize play. The transfer remains here until you discard it; installation backups do not include device drafts.")), field(this.#t("Choose a file"), file), field(this.#t("Or paste the export"), area), ...(this.#response?.role === "dm" ? [checkbox(this.#t("Authorize imported DM grants as the current DM"), false, value => { authorize = value; })] : []), button(this.#t("Save frozen import on this device"), () => {
                    try {
                        this.#transfer?.write(body);
                        this.#message = "Frozen import saved on this device. Reopen Import character to review or export it.";
                        this.#status();
                    }
                    catch (error) {
                        this.#message = String(error);
                        this.#status();
                    }
                }), button(this.#t("Inspect external history"), () => {
                    try {
                        parseCharacter(body);
                        const archive = externalHistory(body);
                        this.#transfer?.write(body);
                        this.#open(this.#t("External history · unverified provenance"), [el("p", this.#t("These imported actor claims and snapshots are reference material. They never replace local History or grant DM authority.")), ...archive.map(entry => panel(this.#t("Revision {0}", [entry.revision]), el("p", `${entry.summary} · ${entry.actorId} · ${entry.occurredAt}`), el("details", el("summary", this.#t("Imported snapshot")), el("pre", JSON.stringify(entry.state, null, 2))))), button(this.#t("Export original transfer"), () => download(`${this.#key}.transfer.json`, body))]);
                    }
                    catch (error) {
                        this.#message = String(error);
                        this.#status();
                    }
                }), button(this.#t("Discard device transfer"), () => { this.#transfer?.clear(); body = ""; area.value = ""; }), button(this.#t("Review import"), async () => { try {
                    const inputs = parseCharacter(body);
                    this.#transfer?.write(body);
                    this.#dialog?.close();
                    await this.#review({ ...this.#base("import"), inputs, reauthorizeGrants: authorize, summary: "Import character replacement" });
                }
                catch (error) {
                    this.#message = error instanceof Error ? error.message : "Invalid character file.";
                    this.#status();
                } })]);
        }
        #exportHistory() {
            const state = this.#response.state, revision = this.#response.revision;
            let count = Math.min(3, revision);
            const input = numberInput(count, value => { count = value ?? 0; }, 1, Math.min(5, revision));
            input.required = true;
            this.#open(this.#t("Export with history"), [el("p", this.#t("Include up to five recent saved snapshots, within the 1 MB transfer limit. The archive is external provenance when imported; full backups retain all local history.")), field(this.#t("Recent revisions"), input), button(this.#t("Download history archive"), () => {
                    if (!input.reportValidity())
                        return;
                    return this.#guard(async () => {
                        const page = await this.#call("history", { key: this.#key, before: revision + 1 });
                        const archive = [];
                        for (const entry of (page.history ?? []).slice(0, count)) {
                            const saved = await this.#call("revision", { key: this.#key, revision: entry.revision });
                            archive.push({ revision: entry.revision, actorId: entry.actorId, occurredAt: entry.occurredAt, summary: entry.summary, state: saved.state });
                        }
                        download(`${this.#key}.history.json`, exportCharacter(state, archive));
                    });
                })]);
        }
        #print(state, revision) {
            const options = { spells: true, equipment: true, notes: true, provenance: false };
            this.#open(this.#t("Print / PDF"), [el("p", this.#t("Print saved revision {0}. Choose Save as PDF in the browser print dialog for a PDF copy.", [revision])), ...Object.entries(options).map(([key, value]) => checkbox(this.#t(label(key)), value, enabled => { options[key] = enabled; })), button(this.#t("Open print preview"), () => { try {
                    printCharacter(state, revision, this.#name, options, this.#context?.host.locale);
                }
                catch (error) {
                    this.#message = error instanceof Error ? error.message : "Printing failed.";
                    this.#status();
                } })]);
        }
    }
    customElements.define(tag, CharacterElement);
    return tag;
}
