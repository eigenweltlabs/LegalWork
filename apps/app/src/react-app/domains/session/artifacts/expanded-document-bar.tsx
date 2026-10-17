import { Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Keep a labeled way back visible, using the macOS window-control strip there. */
export function ExpandedDocumentBar({ label, onRestore }: { label: string; onRestore: () => void }) {
  return <div data-expanded-document-bar className="titlebar-drag z-50 flex h-11 shrink-0 items-center justify-center border-b border-border/70 bg-background px-4 windows:min-h-[env(titlebar-area-height,44px)] mac:fixed mac:inset-x-0 mac:top-0 mac:px-24">
    <Button variant="secondary" size="sm" className="titlebar-no-drag" onClick={onRestore}>
      <Minimize2 />{label}
    </Button>
  </div>;
}
