import { useEffect, useRef } from "react";

export function LauncherRowMenu({ title, actions, onClose }: { title: string; actions: { id: string; title: string; run: () => void }[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    menu.current?.querySelector("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape" || event.key === "ArrowLeft") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const buttons = Array.from(menu.current?.querySelectorAll("button") ?? []);
      const index = buttons.findIndex(button => button === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: "nearest" });
    };
    const pointer = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) close.current(); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", pointer, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", pointer, true); };
  }, []);
  return <div ref={menu} className="launcher-actions-menu" role="menu" aria-label={title}>{actions.map(action => <button key={action.id} type="button" role="menuitem" onMouseMove={event => event.currentTarget.focus()} onClick={action.run}>{action.title}</button>)}</div>;
}
