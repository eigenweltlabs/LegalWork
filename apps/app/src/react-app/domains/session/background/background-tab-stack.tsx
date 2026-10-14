import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown, FileText, Globe, Layers, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { usePanelTabStore, workspacePanelKey } from "../panel/panel-tab-store";
import { DocumentMiniPreview, useDocumentRuntime } from "../artifacts/document-runtime";
import { useTaskBrowserTabs } from "./task-browser-tabs";
import { openBackgroundTab } from "./open-background-tab";

const subscribeEmpty = () => () => {};
const zero = () => 0;

type MiniTab = { id: string; label: string; detail: string; browser: boolean; preview: ReactNode; open: () => void; close: () => void };

function BrowserMiniPreview({ id }: { id: string }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await window.__LEGALWORK_ELECTRON__?.browser?.previewTab?.(id);
        if (!cancelled && value) setImage(value);
      } catch { /* Navigation can temporarily make a preview unavailable. */ }
      if (!cancelled) timer = setTimeout(refresh, 2500);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  return image ? <img src={image} alt="" className="h-full w-full object-cover object-top" />
    : <div className="flex h-full items-center justify-center bg-gray-2"><Globe className="size-8 text-gray-7" /></div>;
}

function MiniCard({ tab, toggle }: { tab: MiniTab; toggle: () => void }) {
  return <div className="relative w-[220px] shrink-0 overflow-hidden rounded-xl border border-gray-5 bg-gray-1 shadow-lg" data-background-tab={tab.id}>
    <div className="flex h-8 items-center gap-0.5 border-b border-gray-4 px-1">
      <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={t("background_tabs.close", { name: tab.label })} title={t("background_tabs.close", { name: tab.label })} onClick={tab.close}><X className="size-3.5" /></Button>
      <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={t("background_tabs.open", { name: tab.label })} title={t("background_tabs.open", { name: tab.label })} onClick={tab.open}><ArrowUpRight className="size-3.5" /></Button>
      <span className="truncate px-1 text-[11px] font-medium" title={tab.label}>{tab.label}</span>
    </div>
    <div className="relative h-[143px] overflow-hidden bg-white">
      {tab.preview}
      <button type="button" className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-blue-8" onClick={toggle} aria-label={t("background_tabs.toggle")} />
    </div>
    <div className="flex h-7 items-center gap-1.5 border-t border-gray-4 px-2 text-[10px] text-gray-10">
      {tab.browser ? <Globe className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
      <span className="truncate">{tab.detail}</span>
    </div>
  </div>;
}

export function BackgroundTabStack({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
  const runtime = useDocumentRuntime();
  useSyncExternalStore(runtime?.subscribe ?? subscribeEmpty, runtime?.version ?? zero);
  const panels = usePanelTabStore(state => state.sessions);
  const browsers = useTaskBrowserTabs(state => state.tabs);
  const [expanded, setExpanded] = useState(false);
  const tabs: MiniTab[] = [];
  for (const entry of runtime?.entries.values() ?? []) {
    if (!entry.tasks.has(sessionId) || entry.dismissed.has(sessionId)) continue;
    if (panels[entry.props.sessionId]?.tabs.some(tab => tab.id === entry.props.tab.id)) continue;
    tabs.push({ id: entry.key, label: entry.props.tab.label, detail: entry.props.tab.value ?? entry.props.tab.label, browser: false,
      preview: <DocumentMiniPreview entry={entry} />, open: () => openBackgroundTab(entry.props.sessionId, sessionId, entry.props.tab), close: () => runtime?.dismiss(entry, sessionId) });
  }
  for (const tab of browsers) {
    if (tab.taskSessionId !== sessionId || !tab.background || tab.dismissed) continue;
    tabs.push({ id: tab.id, label: tab.label, detail: tab.url, browser: true, preview: <BrowserMiniPreview id={tab.id} />,
      open: () => openBackgroundTab(workspacePanelKey(workspaceId), sessionId, { ...tab, background: false }),
      close: () => { void window.__LEGALWORK_ELECTRON__?.browser?.dismissTab?.(tab.id); } });
  }
  if (!tabs.length) return null;
  const toggle = () => setExpanded(value => !value);
  return <section className="pointer-events-auto ml-auto w-fit max-w-full px-4 pb-2 pt-3" aria-label={t("background_tabs.label")}>
    <div className="mb-2 flex justify-end">
      <Button variant="ghost" size="sm" className="h-6 gap-1.5 px-1 text-xs text-gray-10" aria-expanded={expanded} onClick={toggle}>
        <Layers className="size-3.5" />{t("background_tabs.count", { count: tabs.length })}<ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </Button>
    </div>
    {expanded ? <div className="flex max-h-[350px] flex-wrap justify-end gap-3 overflow-auto p-1">{tabs.map(tab => <MiniCard key={tab.id} tab={tab} toggle={toggle} />)}</div>
      : <div className="relative pb-1 pr-3 pt-2">
        {tabs.length > 2 && <div aria-hidden="true" className="absolute inset-0 translate-x-2 -rotate-3 rounded-xl border border-gray-5 bg-gray-3" />}
        {tabs.length > 1 && <div aria-hidden="true" className="absolute inset-1 translate-x-1 rotate-2 rounded-xl border border-gray-5 bg-gray-2" />}
        <MiniCard tab={tabs[tabs.length - 1]} toggle={toggle} />
      </div>}
  </section>;
}
