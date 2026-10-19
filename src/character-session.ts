import type { Difference, Inputs, Response, Result, State } from "./character-model.js";
import type { BuilderNavigation } from "./character-builder-nav.js";
import {
  blank,
  mergeCharacter,
  newId,
  object,
  reconcileCharacter,
  type CharacterRequest,
} from "./character-client.js";
import { previewProblems } from "./character-comparison.js";
import {
  commandBlocker,
  readCharacterPending,
  type CharacterPending,
  type CharacterTab,
  type CommandAttempt,
  type SaveAttempt,
} from "./character-pending.js";
import { saveBlockers, type RuleNote } from "./character-rule-notes.js";

/** Sends one request to the character worker. */
export type CharacterCall = (method: string, request: CharacterRequest) => Promise<Response>;

/** What the worker last reported about the saved character. */
export interface SavedCharacter {
  readonly actorId: string;
  readonly role: string;
  readonly revision: number;
  /** The saved sheet, or undefined when none is saved. */
  readonly state: State | undefined;
  /** The answer's status; "unavailable" means no compatible rules. */
  readonly status: string;
  /** The saved sheet was calculated with other rules than the current ones. */
  readonly rulesChanged: boolean;
}

/** Everything the session knows about one character view. */
export interface SessionState {
  /** The worker's latest report of the saved character; undefined until read. */
  saved: SavedCharacter | undefined;
  /** The page's inputs. Panels edit them in place and then call `changed()`. */
  input: Inputs;
  /** The saved inputs the page's edits started from, and their revision. */
  base: Inputs;
  baseRevision: number;
  /** The rules' results for the last evaluated inputs. */
  evaluation: Result | undefined;
  /** The rules' building options (standard array, ability dice) from the latest answer that carried them. */
  policy: Record<string, unknown>;
  /** The page has edits that are not saved yet. */
  dirty: boolean;
  /** Counts edits and commands, so an answer can tell whether newer edits arrived. */
  changeVersion: number;
  /** Automatic saving waits for Retry, another edit or a reload. */
  blocked: boolean;
  /** A read, review or command of this view is running. */
  busy: boolean;
  /** An automatic save is running. */
  saving: boolean;
  /** An automatic save without an answer yet; it is resent unchanged before newer edits. */
  attempt: SaveAttempt | undefined;
  /** A command that is running or whose outcome is not confirmed. */
  command: CommandAttempt | undefined;
  /** The save status, in English; the view translates it. */
  message: string;
  /** Why the rules refused the last automatic save. */
  saveIssues: readonly string[];
  /** Rules refusals shown next to what caused them. */
  ruleNotes: readonly RuleNote[];
  /** Saved selections the last save removed because the rules no longer allow them. */
  withdrawn: readonly Difference[];
}

/** How the session reaches the page that shows it. */
export interface SessionView {
  /** The host lets this viewer edit the character. */
  canEdit(): boolean;
  /** A text field has focus, so a saved answer must keep the objects it edits. */
  typing(): boolean;
  /** Draws the whole sheet again. */
  render(): void;
  /** Updates only the save status. */
  status(): void;
  /** Tells the host whether edits are pending or saving. */
  publish(): void;
  /** A request starts. The returned function runs when it ends in the same view. */
  busy(): () => void;
  /** Moves focus to the save status, where an uncertain action is resolved. */
  focusStatus(): void;
}

export interface SessionOptions {
  readonly call: CharacterCall;
  /** The add-on activation. Once it ends, failures are no longer reported. */
  readonly signal: AbortSignal;
  readonly view: SessionView;
}

/** A character read for a view, and the pending edits recovered for it. */
export interface Loaded {
  readonly saved: SavedCharacter;
  readonly recovered: CharacterPending | undefined;
}

/** One view of a character, from `begin()` until the next view or disconnection. */
export interface ViewHandle {
  /** The view is still the current one. */
  current(): boolean;
}

/** What the host keeps for this view. */
export interface HostEdits {
  /** Edits or an unconfirmed action would be lost by leaving. */
  readonly dirty: boolean;
  readonly saving: boolean;
  /** Pending edits for the next view of this character, in page memory. */
  readonly pending: unknown;
}

const viewChanged = "The character view changed before the request completed.";

/** The saved character as an answer reports it. A missing state means none is saved. */
function savedCharacter(response: Response): SavedCharacter {
  return {
    actorId: response.actorId,
    role: response.role,
    revision: response.revision,
    state: response.state,
    status: response.status,
    rulesChanged: response.rulesChanged,
  };
}

/**
 * The save session of a character element. It reads the saved character,
 * saves edits automatically, sends commands, and keeps every request whose
 * outcome is not confirmed until the user resolves it. The worker is the only
 * writer; conflict merging belongs to `character-client.ts`.
 */
export class CharacterSession {
  readonly #call: CharacterCall;
  readonly #signal: AbortSignal;
  readonly #view: SessionView;
  readonly #state: SessionState = {
    saved: undefined,
    input: blank(),
    base: blank(),
    baseRevision: 0,
    evaluation: undefined,
    policy: {},
    dirty: false,
    changeVersion: 0,
    blocked: false,
    busy: false,
    saving: false,
    attempt: undefined,
    command: undefined,
    message: "",
    saveIssues: [],
    ruleNotes: [],
    withdrawn: [],
  };
  #key = "";
  /** Pending edits the host handed over from an earlier view, until they are read. */
  #handoff: unknown;
  /** Grows when a view begins or ends; answers from an earlier view are ignored. */
  #epoch = 0;
  #connected = false;
  #saving: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor({ call, signal, view }: SessionOptions) {
    this.#call = call;
    this.#signal = signal;
    this.#view = view;
  }

  get state(): Readonly<SessionState> {
    return this.#state;
  }

  /** The element is on the page; `handoff` is what the host kept from an earlier view. */
  connect(handoff: unknown): void {
    this.#handoff = handoff;
    this.#state.busy = false;
    this.#connected = true;
  }

  /** The element left the page. Requests still running are ignored when they answer. */
  disconnect(): void {
    this.#leave();
    this.#connected = false;
  }

  /** The element shows another character: forget this one. */
  reset(): void {
    this.#leave();
    this.#handoff = undefined;
    this.#state.busy = false;
    this.#state.saved = undefined;
    this.#state.evaluation = undefined;
    this.#state.policy = {};
  }

  #leave(): void {
    this.#epoch++;
    this.#setSaving(undefined);
    this.#state.attempt = undefined;
    this.#state.command = undefined;
    this.#state.changeVersion++;
    clearTimeout(this.#timer);
  }

  /** Starts a new view of `key`; answers to requests of earlier views are ignored. */
  begin(key: string): ViewHandle {
    this.#key = key;
    clearTimeout(this.#timer);
    const epoch = ++this.#epoch;
    return { current: () => epoch === this.#epoch && this.#connected };
  }

  /** A new request for the current saved revision. */
  request(operation: string): CharacterRequest {
    return {
      key: this.#key,
      expectedRevision: this.#state.baseRevision,
      operation,
      operationId: newId(),
    };
  }

  /** Shows a message in the save status. */
  inform(message: string): void {
    this.#state.message = message;
    this.#view.status();
  }

  /**
   * Runs one read, review or command at a time. A failure becomes the status
   * message unless the view changed or the add-on stopped meanwhile.
   */
  async guard(action: () => Promise<void>): Promise<void> {
    if (this.#state.busy) return;
    const epoch = this.#epoch;
    this.#state.busy = true;
    const end = this.#view.busy();
    try {
      await action();
    } catch (error) {
      if (epoch === this.#epoch && !this.#signal.aborted && this.#connected)
        this.#state.message =
          error instanceof Error
            ? error.message
            : "The character request failed. Your edit has not been saved.";
    } finally {
      if (epoch === this.#epoch) {
        this.#state.busy = false;
        end();
      }
    }
  }

  async #send(method: string, request: CharacterRequest): Promise<Response> {
    const epoch = this.#epoch,
      response = await this.#call(method, request);
    if (epoch !== this.#epoch || !this.#connected) throw new Error(viewChanged);
    return response;
  }

  /** Takes the saved character and the rules' building options an answer reports. */
  #report(response: Response): SavedCharacter {
    const saved = savedCharacter(response);
    this.#state.saved = saved;
    if (response.policy) this.#state.policy = response.policy;
    return saved;
  }

  #setSaving(saving: Promise<void> | undefined): void {
    this.#saving = saving;
    this.#state.saving = saving !== undefined;
  }

  get #editable(): boolean {
    return this.#view.canEdit() && !this.#state.busy && !this.#state.command;
  }

  /**
   * Reads the saved character for the current view (inside `guard`), then
   * restores pending edits the host handed over for the same character and
   * editor. Unreadable pending edits stay with the host and fail the read.
   */
  async read(): Promise<Loaded> {
    const s = this.#state,
      response = await this.#send("load", { key: this.#key });
    if (response.status !== "ready" && response.status !== "unavailable")
      throw new Error(response.message);
    const pending = this.#handoff === undefined ? undefined : readCharacterPending(this.#handoff);
    const saved = this.#report(response);
    s.command = undefined;
    s.evaluation = response.evaluation;
    s.input = structuredClone(response.state?.inputs ?? blank());
    s.baseRevision = response.revision;
    s.base = structuredClone(s.input);
    s.dirty = false;
    s.attempt = undefined;
    s.saveIssues = [];
    s.withdrawn = [];
    s.message = response.message;
    s.blocked = false;
    const recovered =
      pending &&
      pending.key === this.#key &&
      pending.actorId === response.actorId &&
      pending.role === response.role
        ? pending
        : undefined;
    if (recovered) {
      s.input = recovered.inputs;
      s.base = recovered.base;
      s.baseRevision = recovered.revision;
      s.dirty = recovered.dirty;
      s.changeVersion = recovered.changeVersion;
      s.attempt = recovered.attempt;
      s.command = recovered.command;
      s.blocked = s.dirty;
      s.evaluation = undefined;
      s.message =
        "The character reconnected. Your pending changes are still on this page. Review them before retrying.";
    }
    this.#handoff = undefined;
    return { saved, recovered };
  }

  /**
   * Reads the saved character again while nothing is pending, for example
   * after another editor saved it. `force` takes the answer even when it
   * reports the same revision and rules.
   */
  async refresh(force = false): Promise<void> {
    const s = this.#state;
    if (s.busy || this.#saving || s.dirty || s.command || !s.saved) return;
    const version = s.changeVersion;
    try {
      const response = await this.#send("load", { key: this.#key });
      const saved = s.saved;
      if (
        !saved ||
        version !== s.changeVersion ||
        s.dirty ||
        s.command ||
        s.busy ||
        this.#saving ||
        (!force &&
          response.revision === saved.revision &&
          response.status === saved.status &&
          response.rulesChanged === saved.rulesChanged)
      )
        return;
      // A replay receipt confirms persistence before this guidance read.
      // Keep its acknowledgement when the read has no newer state or warning.
      const keepAcknowledgement =
        s.message === "Saved" &&
        response.revision === s.baseRevision &&
        response.status === "ready" &&
        !response.rulesChanged &&
        !response.message;
      this.#accept(response);
      if (keepAcknowledgement) s.message = "Saved";
      this.#view.render();
    } catch {
      /* The next change still uses optimistic revision checks. */
    }
  }

  /** Takes a read or saved character as the new starting point for edits. */
  #accept(response: Response): void {
    const s = this.#state;
    this.#report(response);
    s.baseRevision = response.revision;
    s.evaluation = response.evaluation;
    s.input = structuredClone(response.state?.inputs ?? blank());
    s.base = structuredClone(s.input);
    s.dirty = false;
    s.blocked = false;
    s.saveIssues = [];
    s.ruleNotes = [];
    s.withdrawn = [];
    s.attempt = undefined;
    s.message = response.message;
    this.#view.publish();
  }

  /** The page changed `state.input`; saves it shortly, coalescing further edits. */
  changed(): void {
    const s = this.#state;
    if (s.command) return;
    s.dirty = true;
    s.changeVersion++;
    s.blocked = false;
    s.saveIssues = [];
    s.ruleNotes = [];
    s.withdrawn = [];
    s.message = "Saving…";
    this.#view.publish();
    this.#view.status();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, 250);
  }

  /** Saves the pending edits again after a refusal or a lost answer. */
  retry(): Promise<void> {
    this.#state.blocked = false;
    return this.flush();
  }

  /** Saves pending edits, one request at a time, until they are saved or blocked. */
  async flush(): Promise<void> {
    const s = this.#state;
    if (this.#saving) return this.#saving;
    if (!s.dirty || s.blocked || s.command || !this.#connected) return;
    s.message = "Saving…";
    s.saveIssues = [];
    this.#view.status();
    const epoch = this.#epoch;
    const run = async (): Promise<void> => {
      while (s.dirty && !s.blocked && this.#connected && epoch === this.#epoch) {
        // Keep the exact request until a response establishes its outcome, even
        // when newer input arrives while an earlier reply is lost.
        const attempt = (s.attempt ??= {
          request: { ...this.request("build"), inputs: structuredClone(s.input) },
          base: structuredClone(s.base),
          version: s.changeVersion,
        });
        const { version, base, request } = attempt;
        this.#view.publish();
        const response = await this.#send("save", request);
        s.attempt = undefined;
        if (response.status === "conflict" && response.state) {
          const merged = mergeCharacter(base, s.input, response.state.inputs);
          if (merged) {
            this.#report(response);
            s.baseRevision = response.revision;
            s.base = structuredClone(response.state.inputs);
            s.input = merged;
            this.#view.render();
            continue;
          }
          s.blocked = true;
          s.message =
            "This character was edited elsewhere. Your pending input remains on this page. Reload the character before continuing.";
          this.#view.status();
          break;
        }
        if (response.evaluation) s.evaluation = response.evaluation;
        if (response.status !== "ready" || !response.state) {
          // A too-large request was never evaluated, so it carries no rules state.
          if (response.status !== "too-large") this.#report(response);
          s.blocked = true;
          s.message = response.message;
          if (
            (response.status === "invalid" || response.status === "too-large") &&
            version !== s.changeVersion
          ) {
            s.blocked = false;
            continue;
          }
          const blockers = response.status === "invalid" ? saveBlockers(response.evaluation) : [];
          s.saveIssues = blockers.map((issue) => String(issue["message"]));
          s.ruleNotes = blockers.map((issue) => ({
            message: String(issue["message"]),
            target: String(issue["target"]),
          }));
          this.#view.render();
          break;
        }
        this.#report(response);
        s.baseRevision = response.revision;
        s.base = structuredClone(response.state.inputs);
        s.evaluation = response.evaluation;
        reconcileCharacter(request.inputs, s.input, response.state.inputs);
        if (version === s.changeVersion) {
          s.dirty = false;
          s.withdrawn = response.withdrawn ?? [];
          s.message = "Saved";
          if (this.#view.typing()) {
            s.input.play.asOf = response.state.inputs.play.asOf;
            this.#view.status();
          } else {
            s.input = structuredClone(response.state.inputs);
            this.#view.render();
          }
        }
      }
    };
    this.#setSaving(
      run()
        .catch((error: unknown) => {
          if (epoch === this.#epoch && this.#connected) {
            s.blocked = true;
            s.message =
              error instanceof Error
                ? error.message
                : "Could not save. Check your connection and retry.";
            this.#view.render();
          }
        })
        .finally(() => {
          if (epoch === this.#epoch) {
            this.#setSaving(undefined);
            this.#view.publish();
            if (!s.dirty && !s.evaluation) void this.refresh(true);
          }
        }),
    );
    this.#view.publish();
    return this.#saving;
  }

  /**
   * Waits for pending saves, then answers why a command cannot start now, or
   * "" when it can.
   */
  async ready(request: CharacterRequest): Promise<string> {
    const s = this.#state,
      epoch = this.#epoch;
    // Explicit adoption saves the preserved input with new rules. A rejected
    // autosave cannot precede it, and an uncertain request must be resolved first.
    const adoptingRules =
      request.operation === "adopt-rules" &&
      request.adoptRules === true &&
      s.saved?.rulesChanged === true;
    const blocker = (): string =>
      epoch !== this.#epoch || request.key !== this.#key
        ? "The character view changed. Try again."
        : commandBlocker(
            {
              canEdit: this.#view.canEdit(),
              busy: s.busy,
              command: !!s.command,
              attempt: !!s.attempt,
              dirty: s.dirty,
            },
            adoptingRules,
          );
    if (!this.#editable) return blocker();
    await this.#saving;
    if (!this.#editable || epoch !== this.#epoch || request.key !== this.#key) return blocker();
    if (!adoptingRules) await this.flush();
    return blocker();
  }

  /** Sends a command that is ready; answers whether it was saved. */
  async send(request: CharacterRequest, focusKey?: string): Promise<boolean> {
    const s = this.#state;
    clearTimeout(this.#timer);
    request.expectedRevision = s.baseRevision;
    if (request.inputs) request.inputs = structuredClone(s.input);
    s.changeVersion++;
    s.ruleNotes = [];
    s.command = {
      method: "save",
      request: structuredClone(request),
      retry: true,
      ...(focusKey === undefined ? {} : { focusKey }),
    };
    return this.resend();
  }

  /**
   * Asks the worker to review an import. `show` presents a review that can be
   * confirmed; otherwise the answer says why not, so the import dialog keeps
   * its input.
   */
  async preview(request: CharacterRequest, show: (review: Response) => void): Promise<string[]> {
    const blocker = await this.ready(request);
    if (blocker) return [blocker];
    clearTimeout(this.#timer);
    request.expectedRevision = this.#state.baseRevision;
    let problems: string[] = [];
    await this.guard(async () => {
      let response: Response;
      try {
        response = await this.#send("preview", request);
      } catch (error) {
        problems = [error instanceof Error ? error.message : "The import could not be reviewed."];
        return;
      }
      problems = previewProblems(response);
      if (problems.length) return;
      this.#state.message = response.message;
      show(response);
    });
    return problems;
  }

  /** Replaces the character with an approved import review; answers whether it was saved. */
  async commit(request: CharacterRequest, review: Response): Promise<boolean> {
    if (!this.#editable) return false;
    // Keep the approved token and revision. Retrying must never create or
    // approve a new preview, even if another editor changes the character.
    this.#state.changeVersion++;
    this.#state.command = {
      method: "commit",
      request: {
        key: request.key,
        expectedRevision: review.revision,
        operationId: request.operationId!,
        token: review.token!,
      },
      retry: true,
    };
    return this.resend();
  }

  /** Sends the current command, or retries it unchanged; answers whether it was saved. */
  async resend(): Promise<boolean> {
    const s = this.#state,
      attempt = s.command,
      epoch = this.#epoch;
    let reread = false,
      saved = false;
    if (!attempt || s.busy) return false;
    s.message = "Saving…";
    await this.guard(async () => {
      try {
        const response = await this.#send(attempt.method, attempt.request);
        if (response.status === "ready" && response.state) {
          s.command = undefined;
          this.#accept(response);
          s.withdrawn = response.withdrawn ?? [];
          s.message = "Saved";
          saved = true;
        } else {
          // The worker answered without saving, so nothing waits on this action.
          // A changed revision is re-read rather than rebased onto newer inputs.
          // A too-large request was never evaluated, so it carries no rules state.
          s.command = undefined;
          if (response.status !== "too-large") this.#report(response);
          s.message = response.message;
          if (response.status === "invalid" || response.status === "too-large")
            s.ruleNotes = [
              {
                message: response.message,
                ...(attempt.focusKey === undefined ? {} : { focusKey: attempt.focusKey }),
              },
            ];
          if (response.status === "conflict") reread = true;
        }
      } catch (error) {
        if (epoch === this.#epoch && this.#connected) {
          const status = Number(object(error)["status"]);
          const expiredReview =
            attempt.method === "commit" && status === 409 && object(error)["code"] === "CONFLICT";
          // A client error other than timeout, conflict or rate limit is a
          // definite refusal: the service saved nothing. Anything else may
          // have been saved, so the action waits until it is resolved.
          const refused =
            expiredReview || (status >= 400 && status < 500 && ![408, 409, 429].includes(status));
          if (refused) s.command = undefined;
          else attempt.retry = true;
          s.message = expiredReview
            ? "This review is no longer valid. Check the saved character before reviewing another import."
            : refused
              ? status === 401 || status === 403
                ? "You are not allowed to make this change."
                : "The character service refused this action. Nothing was saved."
              : "The action's outcome could not be confirmed.";
        }
      }
    });
    if (epoch !== this.#epoch || !this.#connected) return saved;
    if (s.command) this.#view.focusStatus();
    else if (reread) {
      await this.refresh(true);
      if (epoch === this.#epoch) {
        s.message =
          "This character changed in another session. The sheet now shows the saved character; repeat the action if it is still needed.";
        this.#view.status();
      }
    } else if (!s.evaluation) {
      await this.refresh(true);
      if (epoch === this.#epoch && !s.command && !s.dirty) {
        s.message = "Saved";
        this.#view.status();
      }
    }
    return saved;
  }

  /** What the host keeps for this view: its navigation guard and the pending handoff. */
  checkpoint(tab: CharacterTab, builder: BuilderNavigation): HostEdits {
    const s = this.#state;
    const pending: CharacterPending | undefined =
      s.saved && (s.dirty || s.command)
        ? {
            version: "character-pending.v1",
            key: this.#key,
            actorId: s.saved.actorId,
            role: s.saved.role,
            inputs: s.input,
            base: s.base,
            revision: s.baseRevision,
            dirty: s.dirty,
            changeVersion: s.changeVersion,
            tab,
            builder,
            ...(s.attempt ? { attempt: s.attempt } : {}),
            ...(s.command ? { command: s.command } : {}),
          }
        : undefined;
    return {
      dirty: s.dirty || !!s.command || this.#handoff !== undefined,
      saving: s.busy || s.saving,
      pending: this.#handoff ?? pending,
    };
  }
}
