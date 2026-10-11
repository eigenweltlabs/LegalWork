import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading, IconTile } from "@/react-app/design-system/surface";
import { t } from "@/i18n";

/** The page owns toolbar positions; each library keeps its own actions and search state. */
export const IntegrationLibraryLayoutContext = createContext<{ actions: HTMLElement | null; search: HTMLElement | null } | null>(null);

export function useIntegrationLibraryLayout() {
  return useContext(IntegrationLibraryLayoutContext);
}

export function IntegrationLibraryActions({ children }: { children: ReactNode }) {
  const layout = useIntegrationLibraryLayout();
  if (layout) return layout.actions ? createPortal(children, layout.actions) : null;
  return children;
}

/** Shared structure for the three integration libraries; setup lives in dialogs. */
export function IntegrationLibraryHeader(props: { title: string; description: string; actions?: ReactNode }) {
  const layout = useIntegrationLibraryLayout();
  if (layout) return <IntegrationLibraryActions>{props.actions}</IntegrationLibraryActions>;
  return <div className="flex flex-wrap items-start justify-between gap-4">
    <SectionHeading className="min-w-0 flex-1 basis-64" title={props.title} description={props.description} />
    {props.actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{props.actions}</div> : null}
  </div>;
}

export function IntegrationSearch(props: { value: string; onChange: (value: string) => void; label: string; children?: ReactNode; toolbar?: boolean }) {
  const layout = useIntegrationLibraryLayout();
  const search = <div className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" className="ps-9 pe-9 [&::-webkit-search-cancel-button]:appearance-none" aria-label={props.label} placeholder={props.label} value={props.value} onChange={event => props.onChange(event.target.value)} />
      {props.value ? <Button variant="ghost" size="icon-sm" className="absolute end-1 top-1/2 -translate-y-1/2" aria-label={t("integrations.clear_search")} onClick={() => props.onChange("")}><X className="size-3.5" /></Button> : null}
    </div>;
  if (props.toolbar && layout) return <>{layout.search ? createPortal(search, layout.search) : null}{props.children}</>;
  return <div className="space-y-3">{search}{props.children}</div>;
}

export function IntegrationGroupHeading(props: { title: string; count: number; children?: ReactNode; hideInLibrary?: boolean }) {
  const layout = useIntegrationLibraryLayout();
  if (props.hideInLibrary && layout) return null;
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">{props.title}<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">{props.count}</span></h3>
    {props.children}
  </div>;
}

export function IntegrationEmptyState(props: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  const Icon = props.icon;
  return <div className="flex flex-col items-center rounded-2xl border border-border bg-muted/20 px-6 py-12 text-center">
    <IconTile className="mb-4"><Icon className="size-5 text-muted-foreground" /></IconTile>
    <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{props.description}</p>
    {props.action ? <div className="mt-5">{props.action}</div> : null}
  </div>;
}
