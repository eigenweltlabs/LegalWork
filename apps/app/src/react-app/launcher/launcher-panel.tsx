import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Clipboard, Expand, FilePlus2, Filter, ListChecks, Loader2, Maximize2, Mic, MousePointerSquareDashed, Paperclip, Pin, PinOff, Plus, ScanLine, Send, Sparkles, Trash2, X } from "lucide-react";
import type { AssistantContextItem, AssistantSubmission, LauncherCatalogEntry, LauncherFileFilter, LauncherInvocation, LauncherResultAction, LauncherSearchKind, LauncherSearchResult, SavedSearch } from "@legalwork/types/launcher";
import { LAUNCHER_SEARCH_KINDS } from "@legalwork/types/launcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isMacPlatform } from "@/app/utils";
import { launcherApprovalReply, launcherAttentionSet, launcherStatus, launcherVoice, launcherWindowControl, listLocalSkills, openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import { t } from "@/i18n";
import { useLocal } from "@/react-app/kernel/local-provider";
import { AssistantAvatar } from "@/react-app/domains/session/sidebar/assistant-appearance";
import { appendDictatedText, useComposerDictation } from "@/react-app/domains/session/surface/composer/use-composer-dictation";
import { ComposerDictationBar } from "@/react-app/domains/session/surface/composer/composer-dictation";
import { workspaceProjectRoute, workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { appActionEntries, filterCatalog, invocationForAppAction, primaryResultAction } from "./action-catalog";
import { captureClipboard, captureScreen, captureSelection, fileReferenceItem, stageFiles } from "./context-capture";
import { LauncherApprovalCard } from "./launcher-approval";
import { LauncherContextBar } from "./launcher-context-bar";
import { LauncherConversation, useSubmissionStatus, type PendingOutput } from "./launcher-conversation";
import { enterTarget, escapeAction, footerVerb, isComposingKeyEvent, moveSelection, type SelectableItem } from "./launcher-keyboard";
import { activateCategoryAlias, normalizeLauncherAliases, parseLauncherEntry } from "./launcher-query";
import { isPinned, readPins, togglePin as togglePinnedResult } from "./launcher-pins";
import { LauncherPreviewPane } from "./launcher-preview";
import { LauncherActionMenu, LauncherResultList, actionLabel, type LauncherTransferAction } from "./launcher-results";
import { LauncherSearchSession, resultKey } from "./launcher-search-session";
import { useLauncherShell } from "./launcher-shell";
import { useLauncherStore } from "./launcher-store";
import { LauncherWork } from "./launcher-work";
import { createSubmissionIdentity } from "./submission-identity";
import { voiceCoordinator } from "./voice-coordinator";
import { emptyLauncherDraft } from "./draft-coordinator";
import "./launcher.css";

const KIND_HINT: Record<LauncherSearchKind, string> = { files: "launcher.kind.files", projects: "launcher.kind.projects", chats: "launcher.kind.chats", tasks: "launcher.kind.tasks", recordings: "launcher.kind.recordings" };
/** File finder filters: a few named groups of extensions and a modification floor, both shown as removable chips. */
const FILE_TYPE_PRESETS: Record<string, string[]> = { documents: ["docx", "doc", "pdf", "md", "txt", "rtf", "odt"], spreadsheets: ["xlsx", "xls", "csv"], presentations: ["pptx", "ppt"], images: ["png", "jpg", "jpeg", "gif", "tiff", "heic"], emails: ["eml", "msg"] };
const MODIFIED_PRESETS = ["today", "week", "month", "year"] as const;
function modifiedSince(preset: (typeof MODIFIED_PRESETS)[number], now = new Date()) {
  if (preset === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (preset === "week") return now.getTime() - 7 * 86_400_000;
  if (preset === "month") return now.getTime() - 30 * 86_400_000;
  return new Date(now.getFullYear(), 0, 1).getTime();
}
function fileFilterLabels(filter: LauncherFileFilter) {
  const type = filter.types ? Object.entries(FILE_TYPE_PRESETS).find(([, types]) => types.join() === filter.types?.join())?.[0] : null;
  const since = filter.modifiedAfter;
  const modified = since === null ? null : since >= modifiedSince("today") ? "today" : since >= modifiedSince("week") ? "week" : since >= modifiedSince("month") ? "month" : "year";
  return { type: filter.types ? (type ? t(`launcher.filter.type.${type}`) : filter.types.join(", ")) : null, modified: modified ? t(`launcher.filter.modified.${modified}`) : null };
}

export function LauncherPanel() {
  const shell = useLauncherShell();
  const { client, assistant, workspaces, drafts, owner, surface, desktop, openInApp, dismiss } = shell;
  const store = useLauncherStore();
  const local = useLocal();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mod = isMacPlatform() ? "⌘" : "Ctrl";
  const [pins, setPins] = useState(() => typeof window === "undefined" ? [] : readPins());
  const [submission, setSubmission] = useState<{ requestId: string; messageId: string; state: string; error?: string | null } | null>(null);
  const [pendingOutput, setPendingOutput] = useState<PendingOutput | null>(null);
  const [sending, setSending] = useState(false);
  const pastedText = useRef(false);
  const status = useQuery({ queryKey: ["launcher-desktop-status"], queryFn: () => launcherStatus(), enabled: desktop, refetchInterval: 15_000 });
  const aliases = useMemo(() => normalizeLauncherAliases(status.data?.aliases), [status.data?.aliases]);
  const entry = parseLauncherEntry(store.input);
  const mode: "search" | "command" | "ask" | "conversation" = store.view === "conversation" ? "conversation" : entry.mode;

  // Conversation binding: read-only lookup first; a conversation is only created by an explicit action.
  // Callbacks read the store imperatively: depending on the whole store object would re-run effects on every state change.
  const bindCurrent = useCallback(async () => {
    const bound = shell.conversationId ? (await client.assistantConversation(shell.conversationId)).conversation : (await client.assistantConversationCurrent()).conversation;
    useLauncherStore.getState().bindConversation(bound);
    return bound;
  }, [client, shell.conversationId]);
  useEffect(() => { void bindCurrent().catch(() => undefined); }, [bindCurrent]);
  const conversation = store.conversation;
  // Adopt the authoritative draft: on binding, and again on reopening or focus when another surface edited meanwhile. Context staged by an invocation stays.
  const adoptDraft = useCallback(async (conversationId: string, overwrite: boolean) => {
    const { draft } = await drafts.claim(conversationId, owner);
    const state = useLauncherStore.getState();
    if (state.conversation?.conversationId !== conversationId) return;
    state.replaceContext([...draft.context, ...state.context.filter(item => !draft.context.some(existing => existing.id === item.id))]);
    if (draft.target.kind === "project" || overwrite) state.setTarget(draft.target);
    if (draft.submission && draft.submission.state !== "completed") setSubmission({ ...draft.submission, state: draft.submission.state });
    if (draft.text && (overwrite || !state.input)) { if (draft.text !== state.input) state.setInput(draft.text); state.setView("conversation"); }
  }, [drafts, owner]);
  useEffect(() => { if (conversation) void adoptDraft(conversation.conversationId, false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conversation?.conversationId, adoptDraft]);
  useEffect(() => {
    if (!store.visible || !conversation || drafts.owns(conversation.conversationId, owner)) return;
    void adoptDraft(conversation.conversationId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.visible, conversation?.conversationId]);
  // While another surface holds the lease, this one only displays what it writes.
  useEffect(() => drafts.subscribe(id => {
    const state = useLauncherStore.getState();
    if (state.conversation?.conversationId !== id || drafts.owns(id, owner)) return;
    const draft = drafts.get(id);
    if (draft.text !== state.input) state.setInput(draft.text);
    state.replaceContext(draft.context);
  }), [drafts, owner]);
  // Persist the complete draft while this surface owns it.
  useEffect(() => {
    if (!conversation || !drafts.owns(conversation.conversationId, owner)) return;
    const timer = setTimeout(() => {
      const current = drafts.get(conversation.conversationId);
      const text = mode === "conversation" || mode === "ask" ? (mode === "ask" ? entry.text : store.input) : current.text;
      if (current.text === text && current.context === store.context && current.target === store.target && current.searchScope === (store.scope?.id ?? null)) return;
      void drafts.update(conversation.conversationId, owner, { text, context: store.context, target: store.target, searchScope: store.scope?.id ?? null, model: local.prefs.defaultModel, variant: local.prefs.modelVariant }).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [conversation, drafts, owner, store.input, store.context, store.target, store.scope, mode, entry.text, local.prefs.defaultModel, local.prefs.modelVariant]);

  // Search: two-phase session bound to the current category and scope.
  const session = useMemo(() => new LauncherSearchSession((input, signal) => client.launcherSearch({ query: input.query, kinds: input.kinds, projectId: input.projectId, content: input.content, fileTypes: input.fileTypes, modifiedAfter: input.modifiedAfter }, signal)), [client]);
  useEffect(() => session.subscribe(snapshot => useLauncherStore.getState().setResults(snapshot.items, snapshot.sources, snapshot.pending, snapshot.error)), [session]);
  const hasFileFilter = Boolean(store.fileFilter.types?.length || store.fileFilter.modifiedAfter);
  const runSearch = useCallback(() => {
    const state = useLauncherStore.getState();
    session.search({ query: parseLauncherEntry(state.input).text, kinds: state.category ? [state.category] : [...LAUNCHER_SEARCH_KINDS], projectId: state.scope?.id ?? null, fileTypes: state.fileFilter.types, modifiedAfter: state.fileFilter.modifiedAfter });
  }, [session]);
  useEffect(() => {
    if (mode !== "search" || !store.input.trim() && !store.category && !store.scope && !hasFileFilter) { if (mode !== "search") session.cancel(); return; }
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, mode, entry.text, store.category, store.scope, store.input, store.fileFilter, runSearch]);
  useEffect(() => {
    if (mode === "search" && (store.input.trim() || store.category || hasFileFilter)) store.setView("results");
    else if (mode === "command") store.setView("commands");
    else if (mode === "ask") store.setView("conversation");
    // An emptied field leaves a conversation that was never bound; a bound conversation keeps its view.
    else if (store.view === "results" || store.view === "commands" || (store.view === "conversation" && !store.input && !conversation)) store.setView(conversation && store.input ? "conversation" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, store.input, store.category, hasFileFilter]);

  // Catalog: engine commands and quick actions from the server, app actions and skills from this client.
  const catalogQuery = useQuery({ queryKey: ["launcher-catalog", client.baseUrl, store.scope?.id ?? ""], queryFn: () => client.launcherCatalog(store.scope?.id ?? null), staleTime: 30_000 });
  const skillsQuery = useQuery({ queryKey: ["launcher-skills"], queryFn: () => listLocalSkills(""), enabled: desktop, staleTime: 60_000 });
  const catalog = useMemo<LauncherCatalogEntry[]>(() => {
    const favorites = new Set((catalogQuery.data?.entries ?? []).filter(entry => entry.favorite).map(entry => entry.id));
    const skills = (skillsQuery.data?.items ?? []).map<LauncherCatalogEntry>(skill => ({ id: `skill:${skill.name}`, label: skill.name, description: skill.description ?? null, aliases: [skill.name.toLowerCase()], kind: "agent", source: "skill", requires: [], target: "assistant", outputs: ["preview"], workspaceId: null, shortcut: null, favorite: false, usedAt: null, command: null, quickAction: null }));
    return [...appActionEntries({ desktop, favorites, recent: new Map(), shortcuts: status.data?.actionShortcuts ?? {} }), ...(catalogQuery.data?.entries ?? []), ...skills];
  }, [catalogQuery.data, skillsQuery.data, desktop, status.data?.actionShortcuts]);
  const commandItems = useMemo(() => mode === "command" ? filterCatalog(catalog, entry.text) : [], [catalog, mode, entry.text]);
  // Saved searches keep their scope visible and apply it exactly: category, project and words.
  const savedSearches = useQuery({ queryKey: ["launcher-saved-searches", client.baseUrl], queryFn: () => client.savedSearches(), staleTime: 30_000 });
  const applySavedSearch = (search: SavedSearch) => {
    const state = useLauncherStore.getState();
    const workspace = search.projectId ? workspaces.find(workspace => workspace.id === search.projectId) : null;
    state.setScope(workspace ? { id: workspace.id, name: workspace.displayName || workspace.name } : null);
    state.setCategory(search.kind); state.setInput(search.query); state.setOverlay(null); state.setView("results");
    void client.recordSavedSearchUse(search.id).catch(() => undefined);
    inputRef.current?.focus();
  };
  const refreshSavedSearches = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["launcher-saved-searches"] }), queryClient.invalidateQueries({ queryKey: ["launcher-catalog"] })]);
  const saveCurrentSearch = async () => {
    if (mode !== "search" || (!entry.text.trim() && !store.category && !store.scope)) { store.notify({ tone: "info", text: t("launcher.saved.nothing") }); return; }
    const name = [store.category ? t(KIND_HINT[store.category]) : null, entry.text.trim() || null, store.scope?.name ?? null].filter(Boolean).join(" · ");
    try {
      const { search } = await client.createSavedSearch({ name, query: entry.text.trim(), kind: store.category, projectId: store.scope?.id ?? null });
      await refreshSavedSearches();
      store.notify({ tone: "info", text: t("launcher.saved.saved", { name: search.name }) });
    } catch (error) { store.notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
  };
  const deleteSavedSearch = async (id: string) => {
    try { await client.deleteSavedSearch(id); await refreshSavedSearches(); } catch (error) { store.notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
  };

  const selectable: SelectableItem[] = useMemo(() => mode === "command" ? commandItems.map(item => ({ id: item.id, primaryAction: item.kind === "agent" ? "run" : "open" as const }))
    : store.view === "results" ? store.results.map(item => ({ id: resultKey(item), primaryAction: primaryResultAction(item) })) : [], [mode, commandItems, store.view, store.results]);
  useEffect(() => { store.select({ id: selectable[0]?.id ?? null, source: "auto" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, store.view]);
  const selected = enterTarget(store.selection, selectable);

  const notify = store.notify;
  const absolutePath = (result: LauncherSearchResult) => { const workspace = workspaces.find(workspace => workspace.id === result.workspaceId); return workspace && result.path ? `${workspace.path.replace(/[\\/]+$/, "")}/${result.path}` : null; };

  // Conversation creation is explicit: the user's send or New conversation, never a refresh.
  const ensureConversation = useCallback(async () => {
    const current = useLauncherStore.getState().conversation;
    if (current && !current.archived) return current;
    const { conversation: created } = await client.createAssistantConversation({ origin: surface });
    useLauncherStore.getState().bindConversation(created);
    await drafts.claim(created.id, owner);
    return { conversationId: created.id, sessionId: created.sessionId, workspaceId: created.workspaceId, title: created.title, archived: false, pinned: false };
  }, [client, drafts, owner, surface]);
  const startNewConversation = useCallback(async () => {
    const state = useLauncherStore.getState();
    const { conversation: created } = await client.createAssistantConversation({ origin: surface });
    state.bindConversation(created);
    state.setInput(""); state.replaceContext([]); state.setTarget({ kind: "assistant" }); setSubmission(null);
    await drafts.claim(created.id, owner);
    state.setView("conversation");
    inputRef.current?.focus();
  }, [client, drafts, owner, surface]);

  const submitAsk = useCallback(async (text: string, reuse?: { requestId: string; messageId: string }, output?: PendingOutput["output"]) => {
    const trimmed = text.trim();
    // The live store, not this render's snapshot: a target chosen a moment ago must be the one that ships.
    const live = useLauncherStore.getState();
    if (sending || (!trimmed && !live.context.length)) return;
    setSending(true);
    try {
      const target = await ensureConversation();
      if (!drafts.owns(target.conversationId, owner)) await drafts.claim(target.conversationId, owner);
      const identity = reuse ?? createSubmissionIdentity();
      const context = { items: live.context, target: live.target, searchScope: live.scope?.id ?? null, capturedAt: Date.now() };
      await drafts.update(target.conversationId, owner, { text: trimmed, context: live.context, submission: { requestId: identity.requestId, messageId: identity.messageId, state: "sending" } });
      setSubmission({ requestId: identity.requestId, messageId: identity.messageId, state: "sending" });
      setPendingOutput(output ? { messageId: identity.messageId, output } : null);
      store.setView("conversation");
      let result: AssistantSubmission;
      try {
        result = (await client.submitAssistantMessage(target.conversationId, { requestId: identity.requestId, messageId: identity.messageId, text: trimmed, context, model: local.prefs.defaultModel ?? undefined, variant: local.prefs.modelVariant ?? undefined })).submission;
      } catch (error) {
        // Ambiguous: keep the identity and draft; the status poll and Retry reuse it.
        setSubmission({ ...identity, state: "unconfirmed", error: error instanceof Error ? error.message : String(error) });
        await drafts.update(target.conversationId, owner, { submission: { ...identity, state: "unconfirmed" } }).catch(() => undefined);
        notify({ tone: "error", text: t("launcher.submission.unconfirmed") });
        return;
      }
      setSubmission({ requestId: result.requestId, messageId: result.messageId, state: result.state, error: result.error });
      if (result.state === "failed") { notify({ tone: "error", text: result.error ?? t("launcher.submission.failed") }); await drafts.update(target.conversationId, owner, { submission: { ...identity, state: "failed" } }).catch(() => undefined); return; }
      store.setInput(""); store.replaceContext([]);
      await drafts.update(target.conversationId, owner, { ...emptyLauncherDraft(target.conversationId), model: local.prefs.defaultModel, variant: local.prefs.modelVariant, submission: { ...identity, state: result.state } }).catch(() => undefined);
    } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally { setSending(false); }
  }, [sending, store, ensureConversation, drafts, owner, client, local.prefs.defaultModel, local.prefs.modelVariant, notify]);
  // The panel stays open across its own dialogs: the file chooser and an active dictation are not a blur to hide on.
  // Menus restore focus to their trigger; the keyboard belongs to the entry once a choice is made.
  const refocusEntry = () => setTimeout(() => inputRef.current?.focus(), 60);
  const holdPanel = (hold: boolean) => { if (desktop && surface === "panel") void launcherWindowControl(hold ? "dialog-begin" : "dialog-end").catch(() => undefined); };
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const onCancel = () => holdPanel(false);
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, surface]);
  const retrySubmission = useCallback(() => {
    if (!submission || !conversation) return;
    const draft = drafts.get(conversation.conversationId);
    void submitAsk(draft.text || store.input, { requestId: submission.requestId, messageId: submission.messageId });
  }, [submission, conversation, drafts, submitAsk, store.input]);
  const onSubmissionChange = useCallback((next: AssistantSubmission) => {
    setSubmission(current => current && current.requestId === next.requestId ? { ...current, state: next.state, error: next.error } : current);
    if (conversation && drafts.owns(conversation.conversationId, owner)) void drafts.update(conversation.conversationId, owner, { submission: { requestId: next.requestId, messageId: next.messageId, state: next.state } }).catch(() => undefined);
  }, [conversation, drafts, owner]);
  useSubmissionStatus(submission && submission.state !== "completed" && submission.state !== "failed" ? submission.requestId : null, onSubmissionChange);

  // Speak to Assistant: one microphone owner; external dictation and meetings keep their destination.
  const dictation = useComposerDictation(conversation?.conversationId ?? "launcher", async (spoken, send) => {
    const next = appendDictatedText(mode === "ask" ? entry.text : store.input, spoken);
    store.setInput(mode === "search" ? `? ${next}` : next);
    store.setView("conversation");
    voiceCoordinator.release("panel");
    if (send) await submitAsk(next);
  }, store.visible);
  // The desktop pushes capture ownership as it changes; the polled status is the fallback.
  const voice = store.voice ?? status.data?.voice ?? null;
  const voiceBusy = Boolean(voice?.externalDictation || voice?.meeting || voice?.composer);
  const speak = async () => {
    if (voice && voiceBusy) { notify({ tone: "error", text: t(voice.meeting ? "launcher.voice.meeting_active" : voice.externalDictation ? "launcher.voice.dictation_active" : "launcher.voice.busy") }); return; }
    const decision = voiceCoordinator.request({ destination: "assistant", ownerId: "panel", conversationId: conversation?.conversationId });
    if (!decision.ok) { notify({ tone: "error", text: t("launcher.voice.busy") }); return; }
    store.setView("conversation");
    await dictation.start();
  };
  useEffect(() => { if (!dictation.active) voiceCoordinator.release("panel"); }, [dictation.active]);
  useEffect(() => { if (!dictation.active) return; holdPanel(true); return () => holdPanel(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dictation.active]);
  // Pending questions and approvals are counted whatever view is open; the companion shows the number.
  const ownAttention = useQuery({ queryKey: ["launcher-attention-own", client.baseUrl, conversation?.conversationId], queryFn: () => client.assistantConversationAttention(conversation?.conversationId ?? ""), enabled: Boolean(conversation), refetchInterval: store.visible ? 4000 : false });
  const delegatedAttention = useQuery({ queryKey: ["launcher-attention-delegated", client.baseUrl], queryFn: () => client.assistantAttentionAll(), refetchInterval: store.visible ? 5000 : false });
  const attentionCount = (ownAttention.data?.items.length ?? 0) + (delegatedAttention.data?.items ?? []).filter(item => item.kind !== "widget").length;
  useEffect(() => { useLauncherStore.getState().setAttentionCount(attentionCount); }, [attentionCount]);
  // The companion shows where the microphone is and how much needs attention.
  useEffect(() => {
    if (!desktop || surface !== "panel") return;
    void launcherAttentionSet({ count: store.attentionCount, recording: dictation.active }).catch(() => undefined);
  }, [desktop, surface, store.attentionCount, dictation.active]);
  useEffect(() => { if (store.view !== "results" && store.overlay) store.setOverlay(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [store.view]);
  // The entry grows with its text up to a few lines; a single search line stays a single line.
  useEffect(() => { const element = inputRef.current; if (!element) return; element.style.height = "auto"; element.style.height = `${Math.min(160, element.scrollHeight)}px`; }, [store.input]);

  // Context capture: explicit actions with visible provenance; failures leave the draft intact.
  const addItems = (items: AssistantContextItem[], previews: { id: string; dataUrl: string }[] = []) => { store.addContext(items, previews); if (store.view === "idle" || store.view === "results") store.setView("conversation"); };
  const captureActions = {
    selection: async () => { const outcome = await captureSelection(store.origin); if (outcome.ok) addItems([outcome.item]); else notify({ tone: "error", text: outcome.message }); },
    clipboard: async () => { const outcome = await captureClipboard(); if (outcome.ok) addItems([outcome.item]); else notify({ tone: "error", text: outcome.message }); },
    window: async () => { if (!assistant) return; const outcome = await captureScreen("window", client, assistant.workspaceId); if (outcome.ok) addItems([outcome.item], outcome.preview ? [{ id: outcome.item.id, dataUrl: outcome.preview }] : []); else if (!outcome.cancelled) notify({ tone: "error", text: outcome.message }); },
    region: async () => { if (!assistant) return; const outcome = await captureScreen("region", client, assistant.workspaceId); if (outcome.ok) addItems([outcome.item], outcome.preview ? [{ id: outcome.item.id, dataUrl: outcome.preview }] : []); else if (!outcome.cancelled) notify({ tone: "error", text: outcome.message }); },
    files: () => { holdPanel(true); fileInputRef.current?.click(); },
  };

  // Copy or move the selected files into another project: an explicit, approved action with its own audit trail.
  const transferFiles = async (result: LauncherSearchResult, action: LauncherTransferAction, targetWorkspaceId: string) => {
    const state = useLauncherStore.getState();
    const items = (state.multiSelect.size ? state.results.filter(item => state.multiSelect.has(resultKey(item))) : [result]).filter(item => item.kind === "files" && item.workspaceId && item.path);
    const project = workspaces.find(workspace => workspace.id === targetWorkspaceId);
    const mode = action === "move-to-project" ? "move" : "copy";
    let done = 0;
    for (const item of items) {
      try { await client.transferLauncherFile({ sourceWorkspaceId: item.workspaceId ?? "", targetWorkspaceId, path: item.path ?? "", mode }); done++; }
      catch (error) { notify({ tone: "error", text: error instanceof Error && /already exists/.test(error.message) ? t("launcher.transfer.exists", { project: project?.displayName || project?.name || targetWorkspaceId }) : error instanceof Error ? error.message : String(error) }); break; }
    }
    if (done) notify({ tone: "info", text: t(mode === "move" ? "launcher.transfer.moved" : "launcher.transfer.copied", { count: done, project: project?.displayName || project?.name || targetWorkspaceId }) });
    state.clearMultiSelect();
    setTimeout(runSearch, 400);
  };
  // One dispatcher for results, commands and app actions.
  const runResultAction = async (result: LauncherSearchResult, action: LauncherResultAction) => {
    const route = result.kind === "chats" ? workspaceSessionRoute(result.workspaceId ?? "", result.sessionId ?? result.id) : result.kind === "tasks" ? `/tasks?task=${encodeURIComponent(result.id)}` : result.kind === "recordings" ? `/recorder?recording=${encodeURIComponent(result.id)}` : result.workspaceId ? `${workspaceProjectRoute(result.workspaceId)}${result.kind === "files" ? `?file=${encodeURIComponent(result.path ?? result.id)}` : ""}` : "/home";
    const multi = store.multiSelect.size ? store.results.filter(item => store.multiSelect.has(resultKey(item))) : [result];
    if (result.kind === "chats" && result.sourceId === "assistant" && (action === "resume" || action === "open")) {
      try { const { conversation: found } = await client.assistantConversation(result.id); store.bindConversation(found); store.setInput(""); store.setView("conversation"); }
      catch { notify({ tone: "error", text: t("launcher.conversation.unavailable") }); }
      return;
    }
    switch (action) {
      case "open": case "resume": case "play": openInApp(route); if (surface === "panel" && !store.pinned) dismiss(); return;
      case "reveal": { const path = absolutePath(result); if (path) await revealDesktopItemInDir(path); return; }
      case "open-external": { const path = absolutePath(result); if (path) await openDesktopPath(path); return; }
      case "copy-path": await navigator.clipboard.writeText(result.path ?? result.title); notify({ tone: "info", text: t("launcher.notice.copied") }); return;
      case "copy-reference": await navigator.clipboard.writeText(`${result.subtitle ? `${result.subtitle}: ` : ""}${result.path ?? result.title}`); notify({ tone: "info", text: t("launcher.notice.copied") }); return;
      case "pin": setPins(togglePinnedResult(result)); return;
      case "copy-to-project": case "move-to-project": store.setOverlay({ kind: "actions", resultKey: resultKey(result) }); return;
      case "complete": try { await client.patchTask(result.workspaceId ?? "", result.id, { status: "done" }); notify({ tone: "info", text: t("launcher.notice.task_done", { title: result.title }) }); } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); } return;
      case "attach": case "ask": case "compare": case "summarize": case "hand-to-assistant": {
        const items: AssistantContextItem[] = [];
        for (const item of multi) {
          if (item.kind === "files") items.push(fileReferenceItem(item));
          else if (item.kind === "recordings") { try { const transcript = await client.recordingTranscript(item.id, { limit: 20000 }); items.push({ id: `rec_${item.id}`, type: "selection", text: `${item.title}\n\n${transcript.content}`, sourceApp: "LegalWork Recorder", sourceWindow: item.title, capturedAt: Date.now() }); } catch { notify({ tone: "error", text: t("launcher.notice.transcript_unavailable") }); } }
          else if (item.kind === "tasks") items.push({ id: `task_${item.id}`, type: "selection", text: `${item.title}\n${item.excerpt ?? ""}`.trim(), sourceApp: "LegalWork", sourceWindow: t("launcher.kind.tasks"), capturedAt: Date.now() });
          else if (item.kind === "chats") items.push({ id: `chat_${item.id}`, type: "selection", text: `${item.subtitle ?? ""} / ${item.title}${item.excerpt ? `\n${item.excerpt}` : ""}`.trim(), sourceApp: "LegalWork", sourceWindow: t("launcher.kind.chats"), capturedAt: Date.now() });
        }
        if (result.kind === "projects" && result.workspaceId) { store.setScope({ id: result.workspaceId, name: result.title }); if (action === "ask") store.setTarget({ kind: "project", workspaceId: result.workspaceId }); }
        else if ((action === "compare" || action === "summarize") && multi.every(item => item.workspaceId && item.workspaceId === multi[0]?.workspaceId) && multi[0]?.workspaceId) store.setTarget({ kind: "project", workspaceId: multi[0].workspaceId });
        addItems(items);
        store.clearMultiSelect();
        const prompt = action === "compare" ? t("launcher.prompt.compare", { count: multi.length }) : action === "summarize" ? t("launcher.prompt.summarize", { count: multi.length }) : action === "hand-to-assistant" ? t("launcher.prompt.task", { title: result.title }) : "";
        store.setInput(prompt);
        store.setView("conversation");
        inputRef.current?.focus();
        return;
      }
    }
  };
  const runCatalogEntry = async (item: LauncherCatalogEntry, args = "") => {
    if (item.source === "app") {
      const invocation = invocationForAppAction(item.id);
      if (item.id === "app.add-selection") return captureActions.selection();
      if (item.id === "app.paste-clipboard") return captureActions.clipboard();
      if (item.id === "app.attach-file") return captureActions.files();
      if (item.id === "app.open-settings") { openInApp("/settings/launcher"); return; }
      if (item.id === "app.new-project") { openInApp("/projects"); return; }
      if (invocation) applyInvocation({ id: `local_${crypto.randomUUID()}`, action: invocation, source: surface === "panel" ? "shortcut" : "home" });
      return;
    }
    if (item.source === "saved-search" && item.savedSearch) { applySavedSearch(item.savedSearch); return; }
    if (item.source === "quick-action" && item.quickAction) {
      const selection = store.context.find((entry): entry is Extract<AssistantContextItem, { type: "selection" }> => entry.type === "selection")?.text;
      const clipboard = store.context.find((entry): entry is Extract<AssistantContextItem, { type: "clipboard" }> => entry.type === "clipboard")?.text;
      const files = store.context.flatMap(entry => entry.type === "file" ? [entry.path] : []);
      try {
        const rendered = await client.renderQuickAction(item.quickAction.id, { selection, clipboard, files, arguments: args });
        if (item.quickAction.target === "project" && item.quickAction.projectId) useLauncherStore.getState().setTarget({ kind: "project", workspaceId: item.quickAction.projectId });
        else if (item.quickAction.target === "project" && useLauncherStore.getState().target.kind !== "project") { notify({ tone: "error", text: t("launcher.notice.needs_project") }); return; }
        void client.recordQuickActionUse(item.quickAction.id).catch(() => undefined);
        await submitAsk(rendered.prompt, undefined, item.quickAction.output === "copy" || item.quickAction.output === "insert" ? item.quickAction.output : undefined);
      } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (item.source === "skill") { store.setInput(`${item.label} ${args}`.trim()); store.setView("conversation"); return; }
    // Slash commands run through the engine as agent work; a project's own command binds that project.
    if (item.workspaceId) useLauncherStore.getState().setTarget({ kind: "project", workspaceId: item.workspaceId });
    await submitAsk(`/${item.command?.name ?? item.label.replace(/^\//, "")}${args ? ` ${args}` : ""}`);
  };
  const applyInvocation = useCallback((invocation: LauncherInvocation) => {
    const aliasKinds: Partial<Record<LauncherInvocation["action"], LauncherSearchKind>> = { files: "files", projects: "projects", chats: "chats", tasks: "tasks", recordings: "recordings" };
    const kind = aliasKinds[invocation.action];
    if (invocation.projectId) { const workspace = workspaces.find(workspace => workspace.id === invocation.projectId); if (workspace) store.setScope({ id: workspace.id, name: workspace.displayName || workspace.name }); }
    if (invocation.contextId) void client.consumeLauncherContext(invocation.contextId).then(staged => addItems(staged.items)).catch(() => notify({ tone: "error", text: t("launcher.notice.context_expired") }));
    if (kind) { store.setCategory(kind); store.setInput(invocation.query ?? ""); store.setView("results"); }
    else if (invocation.action === "search") { store.setCategory(null); store.setInput(invocation.query ?? ""); }
    else if (invocation.action === "ask") { store.setInput(invocation.query ?? ""); store.setView("conversation"); }
    else if (invocation.action === "new-conversation") void startNewConversation();
    else if (invocation.action === "resume") { void bindCurrent(); store.setView("conversation"); }
    else if (invocation.action === "work") store.setView("work");
    else if (invocation.action === "speak") void speak();
    else if (invocation.action === "capture-region") void captureActions.region();
    else if (invocation.action === "capture-window") void captureActions.window();
    else if (invocation.action === "quick-action" && invocation.actionId) { const item = catalog.find(entry => entry.id === invocation.actionId); if (item) void runCatalogEntry(item, invocation.query ?? ""); else notify({ tone: "error", text: t("launcher.notice.action_unknown") }); }
    else if (invocation.action === "dictate" || invocation.action === "record") {
      if (!desktop) openInApp("/recorder");
      else { if (invocation.action === "dictate" && surface === "panel") dismiss(); void launcherVoice(invocation.action).catch(() => openInApp("/recorder")); }
    }
    if (invocation.conversationId) void client.assistantConversation(invocation.conversationId).then(({ conversation }) => { store.bindConversation(conversation); store.setView("conversation"); }).catch(() => undefined);
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, client, catalog, startNewConversation, bindCurrent]);
  useEffect(() => {
    if (!store.invocation) return;
    const invocation = store.invocation;
    useLauncherStore.getState().setInvocation(null);
    applyInvocation(invocation);
  }, [store.invocation, applyInvocation]);

  // Keyboard contract. The footer says what Enter does.
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKeyEvent(event)) return;
    const input = event.currentTarget;
    const key = event.key;
    const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
    if (modifier && key === "Enter") { event.preventDefault(); void submitAsk(mode === "ask" ? entry.text : store.input); return; }
    if (modifier && key.toLowerCase() === "k") { event.preventDefault(); if (selected && store.view === "results") store.setOverlay({ kind: "actions", resultKey: selected.id }); return; }
    if (modifier && key.toLowerCase() === "y") { event.preventDefault(); event.stopPropagation(); if (selected && store.view === "results") store.setOverlay(store.overlay?.kind === "preview" ? null : { kind: "preview", resultKey: selected.id }); return; }
    if (modifier && key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void saveCurrentSearch(); return; }
    if (key === "ArrowDown" || key === "ArrowUp") { if (!selectable.length) return; event.preventDefault(); store.select(moveSelection(store.selection, selectable, key === "ArrowDown" ? 1 : -1)); return; }
    if (key === "Tab" && !event.shiftKey && !store.category) {
      const activated = activateCategoryAlias(store.input, aliases, "tab");
      if (activated) { event.preventDefault(); store.setCategory(activated.category); store.setInput(activated.rest); }
      return;
    }
    if (key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0) {
      if (store.category) { event.preventDefault(); store.setCategory(null); }
      return;
    }
    if (key === "Escape") {
      const layer = escapeAction({ overlayOpen: store.overlay !== null, category: store.category !== null || hasFileFilter, pinned: store.pinned });
      event.preventDefault();
      if (layer === "overlay") store.setOverlay(null);
      else if (layer === "filter") { store.setCategory(null); store.setFileFilter({ types: null, modifiedAfter: null }); }
      else if (layer === "panel") dismiss();
      return;
    }
    if (key === "Enter") {
      // Like the composer: Enter sends, Shift+Enter is a newline while writing; a search never takes a newline.
      if (event.shiftKey && (mode === "ask" || mode === "conversation")) return;
      event.preventDefault();
      if (event.shiftKey) return;
      if (mode === "ask" || mode === "conversation") { void submitAsk(mode === "ask" ? entry.text : store.input); return; }
      if (mode === "command") { const item = commandItems.find(entry => entry.id === store.selection.id); if (item) void runCatalogEntry(item); return; }
      const result = store.results.find(item => resultKey(item) === store.selection.id);
      if (result) void runResultAction(result, primaryResultAction(result));
    }
  };
  const onInputChange = (value: string) => {
    if (pastedText.current) { pastedText.current = false; store.setInput(value); return; }
    if (!store.category && mode === "search") {
      const activated = activateCategoryAlias(value, aliases);
      if (activated) { store.setCategory(activated.category); store.setInput(activated.rest); return; }
    }
    store.setInput(value);
  };

  const selectedResult = store.view === "results" ? store.results.find(item => resultKey(item) === store.selection.id) ?? null : null;
  const verb = footerVerb(selected, mode);
  const pinnedKeys = useMemo(() => new Set(pins.map(pin => `${pin.kind}\u0000${pin.sourceId}\u0000${pin.id}`)), [pins]);
  const conversations = useQuery({ queryKey: ["launcher-conversations", client.baseUrl], queryFn: () => client.assistantConversations({ limit: 6 }), enabled: store.view === "idle", staleTime: 10_000 });
  const placeholder = mode === "conversation" ? t("launcher.placeholder.conversation", { name: assistant?.profile.name ?? t("assistant.title") }) : store.category ? t("launcher.placeholder.category", { kind: t(KIND_HINT[store.category]) }) : t("launcher.placeholder.search");

  return <div className="launcher-root" data-surface={surface} data-view={store.view}>
    <div className="launcher-panel" role="dialog" aria-label={t("launcher.title")}>
      <div className="launcher-entry">
        <AssistantAvatar icon={assistant?.profile.icon} className="size-6" motion={sending ? "thinking" : undefined} />
        {store.category && <span className="launcher-chip" data-kind="category">{t(KIND_HINT[store.category])}<button type="button" aria-label={t("launcher.chip.remove_category")} onClick={() => { store.setCategory(null); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        {store.scope && <span className="launcher-chip" data-kind="scope" title={t("launcher.chip.scope_hint")}>{store.scope.name}<button type="button" aria-label={t("launcher.chip.remove_scope")} onClick={() => { store.setScope(null); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        {store.target.kind === "project" && <span className="launcher-chip" data-kind="target" title={t("launcher.chip.target_hint")}>{t("launcher.chip.target", { name: (workspace => workspace ? workspace.displayName || workspace.name : store.target.kind === "project" ? store.target.workspaceId : "")(workspaces.find(workspace => workspace.id === (store.target.kind === "project" ? store.target.workspaceId : ""))) })}<button type="button" aria-label={t("launcher.chip.remove_target")} onClick={() => store.setTarget({ kind: "assistant" })}><X className="size-3" /></button></span>}
        {(() => { const labels = fileFilterLabels(store.fileFilter); return <>
          {labels.type && <span className="launcher-chip" data-kind="filter">{labels.type}<button type="button" aria-label={t("launcher.filter.types_any")} onClick={() => { store.setFileFilter({ types: null }); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
          {labels.modified && <span className="launcher-chip" data-kind="filter">{labels.modified}<button type="button" aria-label={t("launcher.filter.modified_any")} onClick={() => { store.setFileFilter({ modifiedAfter: null }); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        </>; })()}
        <textarea ref={inputRef} className="launcher-input" rows={1} value={store.input} placeholder={placeholder} aria-label={t("launcher.title")} autoFocus autoComplete="off" spellCheck={false} onChange={event => onInputChange(event.target.value)} onKeyDown={onKeyDown}
          onFocus={() => { if (conversation && !drafts.owns(conversation.conversationId, owner)) void adoptDraft(conversation.conversationId, true); }}
          onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length && assistant) { event.preventDefault(); void stageFiles(client, assistant.workspaceId, files).then(addItems).catch(error => notify({ tone: "error", text: error instanceof Error ? error.message : String(error) })); } else if (event.clipboardData.getData("text")) pastedText.current = true; }} />
        <div className="launcher-entry-actions">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("launcher.context.add")} title={t("launcher.context.add")} />}><Plus className="size-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {desktop && <DropdownMenuItem disabled={!store.origin?.supportsSelection} title={store.origin?.platform === "windows" && !store.origin.supportsSelection ? t("launcher.context.selection_windows_hint") : undefined} onClick={() => void captureActions.selection()}><MousePointerSquareDashed className="size-4" />{t("launcher.context.add_selection")}{store.origin?.app ? ` (${store.origin.app})` : ""}</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => void captureActions.clipboard()}><Clipboard className="size-4" />{t("launcher.context.paste_clipboard")}</DropdownMenuItem>
              <DropdownMenuItem onClick={captureActions.files}><Paperclip className="size-4" />{t("launcher.context.attach_file")}</DropdownMenuItem>
              {desktop && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void captureActions.window()}><FilePlus2 className="size-4" />{t("launcher.context.capture_window")}</DropdownMenuItem><DropdownMenuItem onClick={() => void captureActions.region()}><ScanLine className="size-4" />{t("launcher.context.capture_region")}</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("launcher.picker.title")} title={t("launcher.picker.title")} />}><Filter className="size-4" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("launcher.picker.scope")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { store.setScope(null); refocusEntry(); }}>{t("launcher.picker.scope_all")}{!store.scope ? " ✓" : ""}</DropdownMenuItem>
                {workspaces.map(workspace => <DropdownMenuItem key={`scope:${workspace.id}`} onClick={() => { store.setScope({ id: workspace.id, name: workspace.displayName || workspace.name }); refocusEntry(); }}>{workspace.displayName || workspace.name}{store.scope?.id === workspace.id ? " ✓" : ""}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("launcher.filter.types")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { store.setFileFilter({ types: null }); refocusEntry(); }}>{t("launcher.filter.types_any")}{!store.fileFilter.types ? " ✓" : ""}</DropdownMenuItem>
                {Object.entries(FILE_TYPE_PRESETS).map(([preset, types]) => <DropdownMenuItem key={preset} onClick={() => { store.setFileFilter({ types }); store.setCategory("files"); store.setView("results"); refocusEntry(); }}>{t(`launcher.filter.type.${preset}`)}{store.fileFilter.types?.join() === types.join() ? " ✓" : ""}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("launcher.filter.modified")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { store.setFileFilter({ modifiedAfter: null }); refocusEntry(); }}>{t("launcher.filter.modified_any")}{store.fileFilter.modifiedAfter === null ? " ✓" : ""}</DropdownMenuItem>
                {MODIFIED_PRESETS.map(preset => <DropdownMenuItem key={preset} onClick={() => { store.setFileFilter({ modifiedAfter: modifiedSince(preset) }); store.setCategory("files"); store.setView("results"); refocusEntry(); }}>{t(`launcher.filter.modified.${preset}`)}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("launcher.picker.target")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { store.setTarget({ kind: "assistant" }); refocusEntry(); }}>{t("launcher.picker.target_assistant")}{store.target.kind === "assistant" ? " ✓" : ""}</DropdownMenuItem>
                {workspaces.map(workspace => <DropdownMenuItem key={`target:${workspace.id}`} onClick={() => { store.setTarget({ kind: "project", workspaceId: workspace.id }); refocusEntry(); }}>{workspace.displayName || workspace.name}{store.target.kind === "project" && store.target.workspaceId === workspace.id ? " ✓" : ""}</DropdownMenuItem>)}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" aria-label={t("launcher.voice.speak")} title={t("launcher.voice.speak")} disabled={!dictation.supported || dictation.blocked || voiceBusy} onClick={() => void speak()}><Mic className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("launcher.work.title")} title={t("launcher.work.title")} onClick={() => store.setView(store.view === "work" ? (conversation ? "conversation" : "idle") : "work")}><ListChecks className="size-4" />{store.attentionCount > 0 && <span className="ml-0.5 rounded-full bg-blue-9 px-1 text-[10px] text-white">{store.attentionCount}</span>}</Button>
          {surface === "panel" && shell.togglePin && <Button variant="ghost" size="icon-sm" aria-label={t(store.pinned ? "launcher.unpin" : "launcher.pin")} title={t(store.pinned ? "launcher.unpin" : "launcher.pin")} onClick={shell.togglePin}>{store.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</Button>}
          {surface === "panel" && <Button variant="ghost" size="icon-sm" aria-label={t("launcher.expand")} title={t("launcher.expand")} onClick={() => { if (conversation) { void drafts.release(conversation.conversationId, owner); openInApp(workspaceSessionRoute(conversation.workspaceId, conversation.sessionId)); } else openInApp("/home"); }}><Maximize2 className="size-4" /></Button>}
          {surface === "embedded" && <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={dismiss}><X className="size-4" /></Button>}
        </div>
      </div>
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => { holdPanel(false); const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length && assistant) void stageFiles(client, assistant.workspaceId, files).then(addItems).catch(error => notify({ tone: "error", text: error instanceof Error ? error.message : String(error) })); }} />
      {store.notice && <div className="launcher-notice" data-tone={store.notice.tone} role={store.notice.tone === "error" ? "alert" : "status"}>{store.notice.text}<button type="button" className="float-right" aria-label={t("common.close")} onClick={() => notify(null)}><X className="size-3.5" /></button></div>}
      {store.approval && surface === "panel" && <LauncherApprovalCard request={store.approval} onReply={async (id, decision) => { try { await launcherApprovalReply(id, decision); } finally { useLauncherStore.getState().setApproval(null); } }} />}
      {dictation.active && <div className="px-3 pt-2"><ComposerDictationBar dictation={dictation} sendDisabled={sending} /></div>}
      <LauncherContextBar />
      <div className="launcher-body" style={{ position: "relative" }}>
        {store.view === "results" && <>
          <LauncherResultList items={store.results} sources={store.sources} query={entry.text} selectedKey={store.selection.id} multiSelect={store.multiSelect} pins={pinnedKeys} pending={store.searchPending}
            onSelect={key => store.select({ id: key, source: "user" })} onRun={(result, action) => void runResultAction(result, action)} onToggleMulti={store.toggleMultiSelect} onOpenActions={key => store.setOverlay({ kind: "actions", resultKey: key })} />
          {store.overlay?.kind === "actions" && selectedResult && <LauncherActionMenu result={selectedResult} multiSelected={store.multiSelect.size} pinned={isPinned(pins, selectedResult)} extra={["preview", ...(entry.text.trim() || store.category ? ["save-search" as const] : [])]} projects={workspaces.filter(workspace => workspace.id !== selectedResult.workspaceId).map(workspace => ({ id: workspace.id, name: workspace.displayName || workspace.name }))}
            onTransfer={(action, projectId) => { store.setOverlay(null); void transferFiles(selectedResult, action, projectId); inputRef.current?.focus(); }}
            onRun={action => { store.setOverlay(null); void runResultAction(selectedResult, action); inputRef.current?.focus(); }} onExtra={action => { store.setOverlay(action === "preview" ? { kind: "preview", resultKey: resultKey(selectedResult) } : null); if (action === "save-search") void saveCurrentSearch(); inputRef.current?.focus(); }} onClose={() => { store.setOverlay(null); inputRef.current?.focus(); }} />}
          {store.searchError && <p className="launcher-notice" data-tone="error">{store.searchError}</p>}
        </>}
        {store.view === "commands" && (commandItems.length ? <div role="listbox">{commandItems.map(item => <div key={item.id} role="option" aria-selected={store.selection.id === item.id} data-selected={store.selection.id === item.id} className="launcher-row" onMouseEnter={() => store.select({ id: item.id, source: "user" })} onClick={() => void runCatalogEntry(item)}>
          <span className="launcher-row-icon"><Sparkles className="size-4" /></span>
          <div className="launcher-row-main"><div className="launcher-row-title">{item.label}{item.favorite ? " ★" : ""}</div><div className="launcher-row-meta">{[t(`launcher.action_kind.${item.kind}`), item.source === "quick-action" ? t("launcher.source.quick_action") : item.source === "command" ? t("launcher.source.command") : item.source === "skill" ? t("launcher.source.skill") : null, item.requires.length ? t("launcher.requires", { inputs: item.requires.map(input => t(`launcher.input.${input}`)).join(", ") }) : null, item.description].filter(Boolean).join(" · ")}</div></div>
          <span className="launcher-row-hint">{store.selection.id === item.id ? `↵ ${actionLabel(item.kind === "agent" ? "run" : "open")}` : item.shortcut}</span>
        </div>)}</div> : <div className="launcher-empty">{t("launcher.commands_empty")}</div>)}
        {store.view === "conversation" && conversation && <LauncherConversation conversation={conversation} submission={submission} pendingOutput={pendingOutput} onRetry={retrySubmission} onOutputApplied={() => setPendingOutput(null)}
          onArchived={() => { const state = useLauncherStore.getState(); state.bindConversation(null); state.setInput(""); state.replaceContext([]); setSubmission(null); state.setView("idle"); void bindCurrent().catch(() => undefined); }} />}
        {store.view === "conversation" && !conversation && <div className="launcher-empty">{t("launcher.conversation.new_hint")}</div>}
        {store.view === "work" && <LauncherWork onOpenConversation={id => void client.assistantConversation(id).then(({ conversation: found }) => { store.bindConversation(found); store.setView("conversation"); }).catch(() => notify({ tone: "error", text: t("launcher.conversation.unavailable") }))} />}
        {store.view === "idle" && <div className="launcher-idle">
          {conversation && <button type="button" className="launcher-row" onClick={() => store.setView("conversation")}><span className="launcher-row-icon"><Expand className="size-4" /></span><div className="launcher-row-main"><div className="launcher-row-title">{t("launcher.idle.resume", { title: conversation.title })}</div><div className="launcher-row-meta">{store.attentionCount ? t("launcher.idle.attention", { count: store.attentionCount }) : t("launcher.idle.resume_hint")}</div></div></button>}
          <button type="button" className="launcher-row" onClick={() => void startNewConversation()}><span className="launcher-row-icon"><Plus className="size-4" /></span><div className="launcher-row-main"><div className="launcher-row-title">{t("launcher.action.new-conversation")}</div><div className="launcher-row-meta">{t("launcher.idle.new_hint")}</div></div></button>
          {catalog.filter(item => item.favorite).slice(0, 5).map(item => <button key={item.id} type="button" className="launcher-row" onClick={() => void runCatalogEntry(item)}><span className="launcher-row-icon"><Sparkles className="size-4" /></span><div className="launcher-row-main"><div className="launcher-row-title">{item.label}</div><div className="launcher-row-meta">{item.shortcut ?? t("launcher.source.quick_action")}</div></div></button>)}
          {(savedSearches.data?.searches ?? []).slice(0, 5).map(search => <div key={search.id} role="button" tabIndex={0} className="launcher-row" onClick={() => applySavedSearch(search)} onKeyDown={event => { if (event.key === "Enter") applySavedSearch(search); }}>
            <span className="launcher-row-icon"><Bookmark className="size-4" /></span>
            <div className="launcher-row-main"><div className="launcher-row-title">{search.name}</div><div className="launcher-row-meta">{[search.kind ? t(KIND_HINT[search.kind]) : t("launcher.saved.all_kinds"), search.projectId ? workspaces.find(workspace => workspace.id === search.projectId)?.displayName ?? search.projectId : t("launcher.saved.all_projects"), search.query ? `“${search.query}”` : null].filter(Boolean).join(" · ")}</div></div>
            <button type="button" className="launcher-row-hint" aria-label={t("launcher.saved.delete")} title={t("launcher.saved.delete")} onClick={event => { event.stopPropagation(); void deleteSavedSearch(search.id); }}><Trash2 className="size-3.5" /></button>
          </div>)}
          {pins.slice(0, 4).map(pin => <button key={`${pin.kind}:${pin.sourceId}:${pin.id}`} type="button" className="launcher-row" onClick={() => openInApp(pin.kind === "chats" ? workspaceSessionRoute(pin.workspaceId ?? "", pin.id) : pin.workspaceId ? `${workspaceProjectRoute(pin.workspaceId)}${pin.kind === "files" ? `?file=${encodeURIComponent(pin.path ?? pin.id)}` : ""}` : "/home")}><span className="launcher-row-icon"><Pin className="size-4" /></span><div className="launcher-row-main"><div className="launcher-row-title">{pin.title}</div><div className="launcher-row-meta">{[t(KIND_HINT[pin.kind]), pin.subtitle].filter(Boolean).join(" · ")}</div></div></button>)}
          {(conversations.data?.items ?? []).filter(item => item.id !== conversation?.conversationId).slice(0, 4).map(item => <button key={item.id} type="button" className="launcher-row" onClick={() => { store.bindConversation(item); store.setView("conversation"); }}><span className="launcher-row-icon"><AssistantAvatar icon={assistant?.profile.icon} className="size-4" /></span><div className="launcher-row-main"><div className="launcher-row-title">{item.title}</div><div className="launcher-row-meta">{item.kind === "day" ? t("launcher.idle.day") : t("launcher.idle.conversation")}{item.pinned ? " · ★" : ""}</div></div></button>)}
          <p className="launcher-empty">{t("launcher.idle.hint", { files: aliases.files, projects: aliases.projects, chats: aliases.chats, tasks: aliases.tasks, recordings: aliases.recordings })}</p>
        </div>}
      </div>
      {store.view === "results" && store.overlay?.kind === "preview" && selectedResult && <LauncherPreviewPane result={selectedResult} />}
      <div className="launcher-footer">
        <span>{verb === "none" ? t("launcher.footer.select") : verb === "ask" ? t("launcher.footer.ask", { mod }) : t("launcher.footer.enter", { action: actionLabel(verb === "run" ? "run" : verb === "attach" ? "attach" : verb === "resume" ? "resume" : verb === "answer" ? "complete" : "open") })}{store.target.kind === "project" ? ` · ${t("launcher.footer.target_bound")}` : ""}</span>
        <span aria-live="polite">{store.searchPending ? <><Loader2 className="inline size-3 animate-spin motion-reduce:animate-none" /> {t("content_search.searching")}</> : sending ? t("launcher.submission.sending") : null}</span>
        <span><kbd>↑↓</kbd><kbd>↵</kbd>{mode === "conversation" || mode === "ask" ? <><kbd>⇧↵</kbd>{t("launcher.footer.newline")} </> : null}<kbd>{mod}↵</kbd>{t("launcher.footer.ask_short")} <kbd>{mod}K</kbd>{t("launcher.footer.actions")} <kbd>{mod}Y</kbd>{t("launcher.footer.preview")} <kbd>Esc</kbd></span>
      </div>
    </div>
    <span className="sr-only"><Send className="size-0" /></span>
  </div>;
}
