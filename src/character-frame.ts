/**
 * On desktop the Compact sheet fills the viewport below the host's header and
 * its tab content scrolls inside the frame (see character-compact.css), so
 * switching tabs never changes the page height. Every render replaces the
 * frame, so the scroll position of each tab is remembered here.
 */
export class CompactFrame {
  readonly #scroll = new Map<string, number>();
  #disconnect: (() => void) | undefined;

  reset(): void {
    this.disconnect();
    this.#scroll.clear();
  }

  disconnect(): void {
    this.#disconnect?.();
    this.#disconnect = undefined;
  }

  connect(root: HTMLElement, tab: string): void {
    this.disconnect();
    const workspace = root.querySelector<HTMLElement>(".dnd-sheet-workspace")!,
      navigation = root.querySelector<HTMLElement>(".dnd-sheet-tabs")!,
      scope = new AbortController(),
      signal = scope.signal;
    const place = (): void => {
      if (signal.aborted || !root.isConnected) return;
      navigation.setAttribute(
        "aria-orientation",
        getComputedStyle(navigation).flexDirection === "column" ? "vertical" : "horizontal",
      );
      // The frame's height is the viewport below wherever the host placed it.
      const top = Math.round(root.getBoundingClientRect().top + window.scrollY) + "px";
      if (root.style.getPropertyValue("--dsc-frame-top") !== top)
        root.style.setProperty("--dsc-frame-top", top);
    };
    const observer = new ResizeObserver(place);
    observer.observe(root);
    window.addEventListener("resize", place, { signal });
    workspace.addEventListener("scroll", () => this.#scroll.set(tab, workspace.scrollTop), {
      passive: true,
      signal,
    });
    this.#disconnect = () => {
      scope.abort();
      observer.disconnect();
    };
    place();
    // Rule details and shared controls finish rendering after this task, so a
    // position clamped by the shorter first layout is applied again next frame.
    const wanted = this.#scroll.get(tab) ?? 0;
    workspace.scrollTop = wanted;
    if (workspace.scrollTop < wanted)
      requestAnimationFrame(() => {
        if (!signal.aborted) workspace.scrollTop = wanted;
      });
  }
}
