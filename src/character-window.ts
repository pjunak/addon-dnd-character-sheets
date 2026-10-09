// Compact editors open as non-modal floating windows: the sheet stays usable
// behind them, the header moves the window and the corner resizes it. Position
// and size are a view preference for the open character, never saved data.
export interface WindowGeometry {
  x: number;
  y: number;
  width?: string;
  height?: string;
}

const margin = 8;

function clamp(dialog: HTMLDialogElement, x: number, y: number): [number, number] {
  const box = dialog.getBoundingClientRect();
  // Keep enough of the header on screen to grab it again.
  return [
    Math.min(Math.max(x, margin - box.width + 96), innerWidth - 96),
    Math.min(Math.max(y, margin), innerHeight - 48),
  ];
}

function place(dialog: HTMLDialogElement, x: number, y: number): void {
  dialog.style.setProperty("--window-x", Math.round(x) + "px");
  dialog.style.setProperty("--window-y", Math.round(y) + "px");
}

export function floatWindow(
  dialog: HTMLDialogElement,
  handle: HTMLElement,
  memory: Map<string, WindowGeometry>,
  key: string,
): void {
  const saved = memory.get(key);
  if (saved?.width) dialog.style.width = saved.width;
  if (saved?.height) dialog.style.height = saved.height;
  // A non-modal dialog stays in page stacking, under the host's navigation.
  // As a manual popover it joins the top layer while the sheet stays usable.
  dialog.popover = "manual";
  dialog.show();
  dialog.showPopover();
  if (saved) place(dialog, ...clamp(dialog, saved.x, saved.y));
  else {
    const box = dialog.getBoundingClientRect();
    place(
      dialog,
      Math.max(margin, (innerWidth - box.width) / 2),
      Math.max(margin, innerHeight * 0.08),
    );
  }
  const remember = (): void => {
    const box = dialog.getBoundingClientRect();
    memory.set(key, {
      x: box.left,
      y: box.top,
      ...(dialog.style.width ? { width: dialog.style.width } : {}),
      ...(dialog.style.height ? { height: dialog.style.height } : {}),
    });
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button")))
      return;
    const box = dialog.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent): void =>
      place(
        dialog,
        ...clamp(dialog, box.left + next.clientX - startX, box.top + next.clientY - startY),
      );
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      remember();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    event.preventDefault();
  });
  // The native corner resize writes inline width and height on the dialog.
  dialog.addEventListener("pointerup", remember);
  dialog.addEventListener(
    "close",
    () => {
      remember();
      if (dialog.matches(":popover-open")) dialog.hidePopover();
    },
    { once: true },
  );
}
