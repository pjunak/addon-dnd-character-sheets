import type { AddonContext } from "./sdk.js";

/** Retain one desktop frame without keeping inactive, editable views mounted. */
export class CompactFrame {
  #height = 0;
  #width = 0;
  #font = "";
  #measured = "";
  #disconnect: (() => void) | undefined;

  reset(): void {
    this.disconnect();
    this.#height = 0;
    this.#width = 0;
    this.#font = "";
    this.#measured = "";
  }

  disconnect(): void {
    this.#disconnect?.();
    this.#disconnect = undefined;
  }

  restoreHeight(root: HTMLElement): void {
    root.style.setProperty("--dsc-content-height", this.#height + "px");
  }

  connect(
    root: HTMLElement,
    content: HTMLElement,
    revision: string,
    samples: () => Iterable<HTMLElement>,
    enhance: AddonContext["ui"]["enhance"],
  ): void {
    this.disconnect();
    const workspace = root.querySelector<HTMLElement>(".dnd-sheet-workspace")!,
      navigation = root.querySelector<HTMLElement>(".dnd-sheet-tabs")!,
      scope = new AbortController();
    let stage: HTMLElement | undefined,
      controls: ReturnType<typeof enhance> | undefined,
      running = false;
    const clearStage = (): void => {
      controls?.dispose();
      controls = undefined;
      stage?.remove();
      stage = undefined;
    };
    const apply = (): void => this.restoreHeight(root);
    const prime = async (signature: string): Promise<void> => {
      running = true;
      const surface = document.createElement("div");
      surface.className = "dnd-frame-measure";
      surface.inert = true;
      surface.setAttribute("aria-hidden", "true");
      stage = surface;
      workspace.append(surface);
      try {
        for (const sample of samples()) {
          // One view per idle moment keeps typing and scrolling responsive.
          // Nothing is mounted while waiting.
          await idle();
          if (scope.signal.aborted) return;
          isolateSample(sample);
          // Nested enhancement owns only this disposable sample. The visible
          // controls keep their focus history and native input values.
          controls = enhance(sample);
          surface.replaceChildren(sample);
          // Let custom controls render their labels before reading layout.
          // No animation frame or user interaction is interleaved with samples.
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          if (scope.signal.aborted) return;
          const offset =
            content.getBoundingClientRect().top - workspace.getBoundingClientRect().top;
          this.#height = Math.max(
            this.#height,
            Math.ceil(offset + sample.getBoundingClientRect().height),
          );
          controls.dispose();
          controls = undefined;
          sample.remove();
        }
        this.#measured = signature;
        apply();
      } catch (error) {
        // Sizing is supplementary. A failed inactive view must not break the
        // visible form or repeatedly retry from its ResizeObserver.
        if (!scope.signal.aborted) {
          this.#measured = signature;
          console.warn("Character frame measurement failed", error);
        }
      } finally {
        clearStage();
        running = false;
      }
    };
    const measure = (): void => {
      if (scope.signal.aborted || !root.isConnected) return;
      navigation.setAttribute(
        "aria-orientation",
        getComputedStyle(navigation).flexDirection === "column" ? "vertical" : "horizontal",
      );
      // The container query, not viewport width, owns natural phone flow.
      if (getComputedStyle(workspace).minHeight === "0px") {
        this.#measured = "";
        return;
      }
      const width = Math.round(workspace.getBoundingClientRect().width),
        style = getComputedStyle(root),
        font = [
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
        ].join("/");
      // Scrollbar appearance alone must not start a new width band.
      if (Math.abs(width - this.#width) > 24 || font !== this.#font) {
        this.#width = width;
        this.#font = font;
        this.#height = 0;
        this.#measured = "";
      }
      this.#height = Math.max(
        this.#height,
        Math.ceil(content.getBoundingClientRect().bottom - workspace.getBoundingClientRect().top),
      );
      apply();
      const signature = revision + "/" + width + "/" + font;
      if (!running && this.#measured !== signature) void prime(signature);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(workspace);
    const fontsChanged = (): void => {
      this.#measured = "";
      measure();
    };
    document.fonts.addEventListener("loadingdone", fontsChanged, { signal: scope.signal });
    this.#disconnect = () => {
      scope.abort();
      observer.disconnect();
      clearStage();
    };
    apply();
    measure();
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });
}

function isolateSample(sample: HTMLElement): void {
  const prefix = "measure-" + crypto.randomUUID() + "-",
    ids = new Map<string, string>();
  for (const node of sample.querySelectorAll<HTMLElement>("[id]")) {
    ids.set(node.id, prefix + node.id);
    node.id = prefix + node.id;
  }
  for (const node of sample.querySelectorAll<HTMLElement>(
    "[for],[aria-controls],[aria-labelledby],[aria-describedby]",
  ))
    for (const attribute of ["for", "aria-controls", "aria-labelledby", "aria-describedby"]) {
      const value = node.getAttribute(attribute);
      if (value)
        node.setAttribute(
          attribute,
          value
            .split(/\s+/)
            .map((id) => ids.get(id) ?? id)
            .join(" "),
        );
    }
  // Rule details have the same closed label geometry without a reference.
  // Ephemeral views must never subscribe to live links or request rule data.
  for (const node of sample.querySelectorAll<HTMLElement & { details: { label: string } }>(
    "codex-addon-rule-details",
  ))
    node.details = { label: node.details.label };
}
