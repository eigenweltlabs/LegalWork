import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, Calculator, Clipboard, Folder, MessageSquare, FilePlus2, Filter, ListChecks, Loader2, Maximize2, Mic, MousePointerSquareDashed, Paperclip, Plus, ScanLine, Sparkles, X } from "lucide-react";
import type { AssistantContextItem, AssistantSubmission, LauncherCatalogEntry, LauncherFileFilter, LauncherInvocation, LauncherResultAction, LauncherSearchKind, LauncherSearchResult, SavedSearch } from "@legalwork/types/launcher";
import { LAUNCHER_SEARCH_KINDS } from "@legalwork/types/launcher";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isMacPlatform } from "@/app/utils";
import { launcherApprovalReply, launcherAttentionSet, launcherOutputRemember, launcherStatus, launcherVoice, launcherWindowControl, listLocalSkills, openDesktopPath, revealDesktopItemInDir } from "@/app/lib/desktop";
import { t } from "@/i18n";
import { useLocal } from "@/react-app/kernel/local-provider";
import { AssistantAvatar } from "@/react-app/domains/session/sidebar/assistant-appearance";
import { appendDictatedText, useComposerDictation } from "@/react-app/domains/session/surface/composer/use-composer-dictation";
import { ComposerDictationBar } from "@/react-app/domains/session/surface/composer/composer-dictation";
import { workspaceProjectRoute, workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { appActionEntries, catalogArguments, filterCatalog, invocationForAppAction, primaryResultAction } from "./action-catalog";
import { captureClipboard, captureScreen, captureSelection, fileReferenceItem, stageFiles } from "./context-capture";
import { LauncherApprovalCard } from "./launcher-approval";
import { LauncherContextBar } from "./launcher-context-bar";
import { AttentionCards, LauncherConversation, SubmissionStatusRow, useSubmissionStatus, type PendingOutput } from "./launcher-conversation";
import { enterTarget, escapeAction, footerVerb, isComposingKeyEvent, moveSelection, optionId, reconcileSelection, type SelectableItem } from "./launcher-keyboard";
import { activateCategoryAlias, categorySuggestions, namedCategoryQuery, normalizeLauncherAliases, parseLauncherEntry } from "./launcher-query";
import { isPinned, readPins, togglePin as togglePinnedResult } from "./launcher-pins";
import { LauncherPreviewPane } from "./launcher-preview";
import { CATEGORY_ICONS, LauncherActionMenu, LauncherResultList, actionLabel, type LauncherTransferAction } from "./launcher-results";
import { LauncherSearchSession, resultKey } from "./launcher-search-session";
import { useLauncherShell } from "./launcher-shell";
import { useLauncherStore } from "./launcher-store";
import { LauncherWork } from "./launcher-work";
import { LauncherOutputHistory } from "./launcher-output-history";
import { submitAssistantDraft } from "./submit-draft";
import { attachFilesToDraft, droppedFiles } from "./attach-files";
import { voiceCoordinator } from "./voice-coordinator";
import { LauncherNavigationHistory } from "./launcher-navigation";
import { calculate } from "./launcher-calculator";
import { LauncherNavigationRows, type NavigationRow } from "./launcher-navigation-rows";
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const navigation = useRef(new LauncherNavigationHistory());
  const savingNavigation = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invocationRunning = useRef<string | null>(null);
  const mod = isMacPlatform() ? "⌘" : "Ctrl";
  const [pins, setPins] = useState(() => typeof window === "undefined" ? [] : readPins());
  const [submission, setSubmission] = useState<{ requestId: string; messageId: string; state: string; error?: string | null } | null>(null);
  const [pendingOutput, setPendingOutput] = useState<PendingOutput | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const uploadConversation = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const pastedText = useRef(false);
  const status = useQuery({ queryKey: ["launcher-desktop-status"], queryFn: () => launcherStatus(), enabled: desktop, refetchInterval: 15_000 });
  const aliases = useMemo(() => normalizeLauncherAliases(status.data?.aliases), [status.data?.aliases]);
  const entry = parseLauncherEntry(store.input);
  const mode: "search" | "command" | "ask" | "conversation" = store.view === "conversation" ? "conversation" : entry.mode;
  const namedCategory = mode === "search" && !store.category ? namedCategoryQuery(entry.text) : null;
  const searchCategory = store.category ?? namedCategory?.category ?? null;
  const searchText = namedCategory?.rest ?? entry.text;
  const showCommands = entry.mode === "command" && (store.view === "commands" || store.view === "conversation");
  const commandWorkspaceId = store.view === "conversation" ? store.target.kind === "project" ? store.target.workspaceId : assistant?.workspaceId : null;
  const calculation = useMemo(() => mode === "search" && !searchCategory && !store.scope ? calculate(searchText) : null, [mode, searchCategory, store.scope, searchText]);

  // Keep the search or command screen underneath a conversation or task view.
  useLayoutEffect(() => {
    navigation.current.observe(store);
  }, [store.view, store.input, store.category, store.fileFilter, store.scope, store.selection, store.conversation, store.context, store.target, store.previews]);

  // Conversation binding: read-only lookup first; a conversation is only created by an explicit action.
  // Callbacks read the store imperatively: depending on the whole store object would re-run effects on every state change.
  const bindCurrent = useCallback(async () => {
    const before = useLauncherStore.getState().conversation?.conversationId;
    const id = shell.conversationId ?? useLauncherStore.getState().conversation?.conversationId;
    const bound = id ? (await client.assistantConversation(id)).conversation : (await client.assistantConversationCurrent()).conversation;
    const after = useLauncherStore.getState().conversation?.conversationId;
    if (after && after !== before) return (await client.assistantConversation(after)).conversation;
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
    state.replaceContext(draft.context);
    state.setTarget(draft.target);
    const scope = workspaces.find(workspace => workspace.id === draft.searchScope);
    state.setScope(scope ? { id: scope.id, name: scope.displayName || scope.name } : null);
    setSubmission(draft.submission);
    let text = draft.text;
    for (const part of draft.composer?.pasteParts ?? []) text = text.replace(`[pasted text ${part.label}]`, () => part.text);
    if (overwrite || !state.input) state.setInput(text);
    if (draft.model) local.setPrefs(previous => ({ ...previous, defaultModel: draft.model, modelVariant: draft.variant }));
  }, [drafts, owner, workspaces]);
  useEffect(() => { if (conversation && store.view === "conversation" && !invocationRunning.current) void adoptDraft(conversation.conversationId, false).catch(error => store.notify({ tone: "error", text: String(error) })); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conversation?.conversationId]);
  useEffect(() => {
    if (store.view !== "conversation" || !store.visible || !conversation || drafts.owns(conversation.conversationId, owner)) return;
    void adoptDraft(conversation.conversationId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.visible, conversation?.conversationId]);
  // While another surface holds the lease, this one only displays what it writes.
  useEffect(() => drafts.subscribe(id => {
    const state = useLauncherStore.getState();
    if (state.view !== "conversation" || state.conversation?.conversationId !== id || drafts.owns(id, owner)) return;
    const draft = drafts.get(id);
    if (draft.text !== state.input) state.setInput(draft.text);
    state.replaceContext(draft.context);
  }), [drafts, owner]);
  // Persist the complete draft while this surface owns it.
  useEffect(() => {
    if (store.view !== "conversation" || !conversation || (uploading && (!uploadConversation.current || uploadConversation.current === conversation.conversationId)) || !drafts.owns(conversation.conversationId, owner)) return;
    const timer = setTimeout(() => {
      if (uploadingRef.current && (!uploadConversation.current || uploadConversation.current === conversation.conversationId)) return;
      const current = drafts.get(conversation.conversationId);
      const text = mode === "conversation" || mode === "ask" ? (mode === "ask" ? entry.text : store.input) : current.text;
      if (current.text === text && current.context === store.context && current.target === store.target && current.searchScope === (store.scope?.id ?? null)) return;
      void drafts.update(conversation.conversationId, owner, { text, context: store.context, target: store.target, searchScope: store.scope?.id ?? null, model: local.prefs.defaultModel, variant: local.prefs.modelVariant }).catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, [uploading, conversation, drafts, owner, store.view, store.input, store.context, store.target, store.scope, mode, entry.text, local.prefs.defaultModel, local.prefs.modelVariant]);

  // Search: two-phase session bound to the current category and scope.
  const session = useMemo(() => new LauncherSearchSession((input, signal) => client.launcherSearch({ query: input.query, kinds: input.kinds, projectId: input.projectId, content: input.content, fileTypes: input.fileTypes, modifiedAfter: input.modifiedAfter }, signal)), [client]);
  useEffect(() => session.subscribe(snapshot => useLauncherStore.getState().setResults(snapshot.items, snapshot.sources, snapshot.pending, snapshot.error)), [session]);
  useEffect(() => () => session.cancel(), [session]);
  const hasFileFilter = Boolean(store.fileFilter.types?.length || store.fileFilter.modifiedAfter);
  const runSearch = useCallback(() => {
    const state = useLauncherStore.getState();
    const entry = parseLauncherEntry(state.input), named = !state.category ? namedCategoryQuery(entry.text) : null;
    const category = state.category ?? named?.category;
    session.search({ query: named?.rest ?? entry.text, kinds: category ? [category] : [...LAUNCHER_SEARCH_KINDS], projectId: state.scope?.id ?? null, fileTypes: state.fileFilter.types, modifiedAfter: state.fileFilter.modifiedAfter });
  }, [session]);
  useEffect(() => {
    if (!store.visible) { session.cancel(); return; }
    if (store.view === "work" || mode !== "search" || calculation || !store.input.trim() && !store.category && !store.scope && !hasFileFilter) { session.cancel(); return; }
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, store.visible, mode, entry.text, store.category, store.scope, store.input, store.fileFilter, calculation, store.view, runSearch]);
  useEffect(() => {
    if (store.view === "work") return;
    if (mode === "search" && (store.input.trim() || store.category || store.scope || hasFileFilter)) store.setView("results");
    else if (mode === "command") store.setView("commands");
    else if (mode === "ask") { store.setInput(entry.text); store.setView("conversation"); }
    // An emptied field leaves a conversation that was never bound; a bound conversation keeps its view.
    else if (store.view === "results" || store.view === "commands") store.setView(conversation && store.input ? "conversation" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, store.input, store.category, store.scope, hasFileFilter]);

  // Catalog: engine commands and quick actions from the server, app actions and skills from this client.
  const catalogQuery = useQuery({ queryKey: ["launcher-catalog", client.baseUrl, commandWorkspaceId ?? ""], queryFn: () => client.launcherCatalog(commandWorkspaceId === assistant?.workspaceId ? null : commandWorkspaceId ?? null), enabled: Boolean(commandWorkspaceId), staleTime: 30_000 });
  const skillsQuery = useQuery({ queryKey: ["launcher-skills"], queryFn: () => listLocalSkills(""), enabled: desktop, staleTime: 60_000 });
  const catalog = useMemo<LauncherCatalogEntry[]>(() => {
    const favorites = new Set((catalogQuery.data?.entries ?? []).filter(entry => entry.favorite).map(entry => entry.id));
    const skills = (skillsQuery.data?.items ?? []).map<LauncherCatalogEntry>(skill => ({ id: `skill:${skill.name}`, label: skill.name, description: skill.description ?? null, aliases: [skill.name.toLowerCase()], kind: "agent", source: "skill", requires: [], target: "assistant", outputs: ["preview"], workspaceId: null, shortcut: null, favorite: false, usedAt: null, command: null, quickAction: null }));
    return [...appActionEntries({ desktop, favorites, recent: new Map(), shortcuts: status.data?.actionShortcuts ?? {} }), ...(catalogQuery.data?.entries ?? []), ...skills];
  }, [catalogQuery.data, skillsQuery.data, desktop, status.data?.actionShortcuts]);
  const commandItems = useMemo(() => showCommands && commandWorkspaceId ? filterCatalog(catalog.filter(item => ["command", "skill", "quick-action"].includes(item.source)), entry.text) : [], [catalog, showCommands, commandWorkspaceId, entry.text]);
  // Saved searches keep their scope visible and apply it exactly: category, project and words.
  const savedSearches = useQuery({ queryKey: ["launcher-saved-searches", client.baseUrl], queryFn: () => client.savedSearches(), staleTime: 30_000 });
  const applySavedSearch = (search: SavedSearch) => {
    const state = useLauncherStore.getState();
    const workspace = search.projectId ? workspaces.find(workspace => workspace.id === search.projectId) : null;
    state.setScope(workspace ? { id: workspace.id, name: workspace.displayName || workspace.name } : null);
    state.setCategory(search.kind); state.setInput(search.query); state.setOverlay(null); state.setView("results");
    state.setFileFilter({ types: search.fileTypes ?? null, modifiedAfter: search.modifiedAfter ?? null });
    void client.recordSavedSearchUse(search.id).catch(() => undefined);
    inputRef.current?.focus();
  };
  const refreshSavedSearches = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["launcher-saved-searches"] }), queryClient.invalidateQueries({ queryKey: ["launcher-catalog"] })]);
  const saveCurrentSearch = async () => {
    if (mode !== "search" || (!searchText.trim() && !searchCategory && !store.scope)) { store.notify({ tone: "info", text: t("launcher.saved.nothing") }); return; }
    const name = [searchCategory ? t(KIND_HINT[searchCategory]) : null, searchText.trim() || null, store.scope?.name ?? null].filter(Boolean).join(" · ");
    try {
      const { search } = await client.createSavedSearch({ name, query: searchText.trim(), kind: searchCategory, projectId: store.scope?.id ?? null, fileTypes: store.fileFilter.types, modifiedAfter: store.fileFilter.modifiedAfter });
      await refreshSavedSearches();
      store.notify({ tone: "info", text: t("launcher.saved.saved", { name: search.name }) });
    } catch (error) { store.notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
  };
  const deleteSavedSearch = async (id: string) => {
    try { await client.deleteSavedSearch(id); await refreshSavedSearches(); } catch (error) { store.notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
  };

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

  const submitAsk = useCallback(async (text: string, reuse?: { requestId: string; messageId: string }, output?: PendingOutput["output"], command?: { name: string; arguments: string }) => {
    const trimmed = text.trim();
    // The live store, not this render's snapshot: a target chosen a moment ago must be the one that ships.
    const live = useLauncherStore.getState();
    if (sending || uploadingRef.current || (!reuse && !trimmed && !live.context.length && !command)) return;
    notify(null);
    setSending(true);
    try {
      const target = await ensureConversation();
      const context = { items: live.context, target: live.target, searchScope: live.scope?.id ?? null, capturedAt: Date.now() };
      if (!reuse) await drafts.update(target.conversationId, owner, { text: trimmed, context: live.context, target: live.target, searchScope: live.scope?.id ?? null });
      store.setView("conversation");
      let result: AssistantSubmission;
      try {
        result = await submitAssistantDraft({ client, drafts, owner, conversationId: target.conversationId, retry: Boolean(reuse), beforeSend: desktop && output ? input => launcherOutputRemember(client.baseUrl, { requestId: input.requestId, messageId: input.messageId, conversationId: target.conversationId, output, originId: live.origin?.id ?? null }) : undefined, input: { text: trimmed, context, command, model: local.prefs.defaultModel ?? undefined, variant: local.prefs.modelVariant ?? undefined } });
      } catch (error) {
        // Ambiguous: keep the identity and draft; the status poll and Retry reuse it.
        const pending = drafts.get(target.conversationId).submission;
        if (pending) setSubmission({ ...pending, error: error instanceof Error ? error.message : String(error) });
        if (pending?.state === "unconfirmed" && output && !desktop) setPendingOutput({ messageId: pending.messageId, output, originId: live.origin?.id ?? null });
        if (!pending) notify({ tone: "error", text: error instanceof Error ? error.message : String(error) });
        return;
      }
      setSubmission({ requestId: result.requestId, messageId: result.messageId, state: result.state, error: result.error });
      if (output && !desktop && result.state !== "failed") setPendingOutput({ messageId: result.messageId, output, originId: live.origin?.id ?? null });
      if (result.state === "failed" || result.state === "unconfirmed") return;
      const current = useLauncherStore.getState();
      const saved = drafts.get(target.conversationId);
      if (!saved.text && !saved.context.length && current.conversation?.conversationId === target.conversationId && current.input === live.input && JSON.stringify(current.context) === JSON.stringify(live.context)) { store.setInput(""); store.replaceContext([]); }
    } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally { setSending(false); }
  }, [sending, store, ensureConversation, drafts, owner, client, local.prefs.defaultModel, local.prefs.modelVariant, notify, desktop]);
  // The panel stays open across its own dialogs: the file chooser and an active dictation are not a blur to hide on.
  // Menus restore focus to their trigger; the keyboard belongs to the entry once a choice is made.
  const refocusEntry = () => setTimeout(() => inputRef.current?.focus(), 60);
  const holdPanel = (hold: boolean) => { if (desktop && surface === "panel") void launcherWindowControl(hold ? "dialog-begin" : "dialog-end").catch(() => undefined); };
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    if (uploadingRef.current) { notify({ tone: "info", text: t("launcher.drop.busy") }); return; }
    uploadingRef.current = true; setUploading(true); holdPanel(true);
    const live = useLauncherStore.getState();
    let conversationId: string | undefined;
    try {
      const target = await ensureConversation();
      conversationId = target.conversationId;
      uploadConversation.current = conversationId;
      await drafts.update(conversationId, owner, { text: live.input, context: live.context, target: live.target, searchScope: live.scope?.id ?? null });
      const bound = useLauncherStore.getState();
      if (bound.conversation?.conversationId === conversationId) { bound.setInput(live.input); bound.replaceContext(live.context); bound.setTarget(live.target); bound.setScope(live.scope); bound.setView("conversation"); }
      const outcome = await attachFilesToDraft({ files, conversationId, owner, drafts,
        context: () => { const current = useLauncherStore.getState(); return current.conversation?.conversationId === target.conversationId ? current.context : drafts.get(target.conversationId).context; },
        onAttached: context => { const current = useLauncherStore.getState(); if (current.conversation?.conversationId === target.conversationId) current.replaceContext(context); },
        stage: async file => (await stageFiles(client, target.workspaceId, [file]))[0] });
      if (outcome.failures.length) notify({ tone: "error", text: outcome.failures.map(item => `${item.name}: ${item.error}`).join("\n") });
      else notify({ tone: "info", text: t("launcher.drop.added", { count: outcome.added }) });
    } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally {
      const state = useLauncherStore.getState();
      if (conversationId && state.conversation?.conversationId === conversationId) await drafts.update(conversationId, owner, { context: state.context }).catch(() => undefined);
      uploadingRef.current = false; uploadConversation.current = null; setUploading(false); holdPanel(false);
    }
  };
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
    if (conversation && drafts.owns(conversation.conversationId, owner)) {
      const pending = drafts.get(conversation.conversationId).submission;
      if (pending?.requestId === next.requestId && pending.state !== next.state) void drafts.acknowledgeSubmission(conversation.conversationId, owner, next).then(cleared => {
        const state = useLauncherStore.getState();
        if (cleared && state.view === "conversation" && state.conversation?.conversationId === conversation.conversationId && state.input.trim() === cleared.text && JSON.stringify(state.context) === JSON.stringify(cleared.context)) {
          state.setInput(""); state.replaceContext([]);
        }
      }).catch(() => undefined);
    }
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
  const attentionItems = [...new Map([...(ownAttention.data?.items ?? []), ...(delegatedAttention.data?.items ?? [])].filter(item => item.kind !== "widget").map(item => [item.id, item])).values()];
  const attentionCount = attentionItems.length;
  const [attentionBusy, setAttentionBusy] = useState<string | null>(null);
  const replyAttention: Parameters<typeof AttentionCards>[0]["onReply"] = async (item, answer) => {
    if (attentionBusy) return;
    setAttentionBusy(item.id);
    try { await client.replyAssistantAttention({ id: item.id, revision: item.revision, workspaceId: item.workspaceId, sessionId: item.sessionId, ...answer }); }
    catch (error) { notify({ tone: "error", text: String(error) }); }
    finally { setAttentionBusy(null); await Promise.all([ownAttention.refetch(), delegatedAttention.refetch()]); }
  };
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
    if (result.folderId && (action === "open" || action === "copy-path")) {
      try {
        if (action === "open" && (!desktop || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(client.baseUrl).hostname))) { store.setOverlay({ kind: "preview", resultKey: resultKey(result) }); return; }
        const file = await client.launcherFolderFile(result.folderId, result.path ?? result.id);
        if (action === "open") await openDesktopPath(file.path);
        else { await navigator.clipboard.writeText(file.path); notify({ tone: "info", text: t("launcher.notice.copied") }); }
      } catch (error) { notify({ tone: "error", text: String(error) }); }
      return;
    }
    const route = result.kind === "chats" ? workspaceSessionRoute(result.workspaceId ?? "", result.sessionId ?? result.id) : result.kind === "tasks" ? `/tasks?task=${encodeURIComponent(result.id)}` : result.kind === "recordings" ? `/recorder?recording=${encodeURIComponent(result.id)}` : result.workspaceId ? `${workspaceProjectRoute(result.workspaceId)}${result.kind === "files" ? `?file=${encodeURIComponent(result.path ?? result.id)}` : ""}` : "/home";
    const multi = store.multiSelect.size ? store.results.filter(item => store.multiSelect.has(resultKey(item))) : [result];
    if (result.kind === "chats" && result.sourceId === "assistant" && (action === "resume" || action === "open")) {
      try { const { conversation: found } = await client.assistantConversation(result.id); store.bindConversation(found); store.setInput(""); store.setView("conversation"); }
      catch { notify({ tone: "error", text: t("launcher.conversation.unavailable") }); }
      return;
    }
    switch (action) {
      case "open": case "resume": case "play": openInApp(route); if (surface === "panel") dismiss(); return;
      case "reveal": { const path = absolutePath(result); if (path) await revealDesktopItemInDir(path); return; }
      case "open-external": { const path = absolutePath(result); if (path) await openDesktopPath(path); return; }
      case "copy-path": await navigator.clipboard.writeText(result.path ?? result.title); notify({ tone: "info", text: t("launcher.notice.copied") }); return;
      case "copy-reference": await navigator.clipboard.writeText(`${result.subtitle ? `${result.subtitle}: ` : ""}${result.path ?? result.title}`); notify({ tone: "info", text: t("launcher.notice.copied") }); return;
      case "pin": setPins(togglePinnedResult(result)); return;
      case "copy-to-project": case "move-to-project": store.setOverlay({ kind: "actions", resultKey: resultKey(result) }); return;
      case "complete": try { await client.patchTask(result.workspaceId ?? "", result.id, { status: "done" }); notify({ tone: "info", text: t("launcher.notice.task_done", { title: result.title }) }); } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); } return;
      case "attach": case "ask": case "compare": case "summarize": case "hand-to-assistant": {
        if (uploadingRef.current) return;
        uploadingRef.current = true; setUploading(true); holdPanel(true);
        const initial = useLauncherStore.getState();
        try {
          const target = await ensureConversation();
          uploadConversation.current = target.conversationId;
          await drafts.update(target.conversationId, owner, { context: initial.context, text: initial.input, target: initial.target, searchScope: initial.scope?.id ?? null });
          await drafts.protect(target.conversationId, owner, async () => {
            const items: AssistantContextItem[] = [];
            for (const item of multi) {
              if (item.kind === "files") {
                if (item.folderId) {
                  try { items.push((await client.attachLauncherFolderFile(item.folderId, item.path ?? item.id)).item); }
                  catch (error) { notify({ tone: "error", text: String(error) }); }
                } else items.push(fileReferenceItem(item));
              }
              else if (item.kind === "recordings") { try { const transcript = await client.recordingTranscript(item.id, { limit: 20000 }); items.push({ id: `rec_${item.id}`, type: "selection", text: `${item.title}\n\n${transcript.content}`, sourceApp: "LegalWork Recorder", sourceWindow: item.title, capturedAt: Date.now() }); } catch { notify({ tone: "error", text: t("launcher.notice.transcript_unavailable") }); } }
              else if (item.kind === "tasks") items.push({ id: `task_${item.id}`, type: "selection", text: `${item.title}\n${item.excerpt ?? ""}`.trim(), sourceApp: "LegalWork", sourceWindow: t("launcher.kind.tasks"), capturedAt: Date.now() });
              else if (item.kind === "chats") items.push({ id: `chat_${item.id}`, type: "selection", text: `${item.subtitle ?? ""} / ${item.title}${item.excerpt ? `\n${item.excerpt}` : ""}`.trim(), sourceApp: "LegalWork", sourceWindow: t("launcher.kind.chats"), capturedAt: Date.now() });
            }
            if (!items.length && result.kind !== "projects") return;
            const context = [...drafts.get(target.conversationId).context, ...items];
            if (context.length > 50) throw new Error(t("launcher.drop.limit"));
            const executionTarget = result.kind === "projects" && result.workspaceId && action === "ask" ? { kind: "project" as const, workspaceId: result.workspaceId }
              : (action === "compare" || action === "summarize") && multi.every(item => item.workspaceId && item.workspaceId === multi[0]?.workspaceId) && multi[0]?.workspaceId ? { kind: "project" as const, workspaceId: multi[0].workspaceId } : initial.target;
            const scope = result.kind === "projects" && result.workspaceId ? { id: result.workspaceId, name: result.title } : initial.scope;
            const prompt = action === "compare" ? t("launcher.prompt.compare", { count: items.length }) : action === "summarize" ? t("launcher.prompt.summarize", { count: items.length }) : action === "hand-to-assistant" ? t("launcher.prompt.task", { title: result.title }) : "";
            const current = useLauncherStore.getState();
            const text = current.conversation?.conversationId === target.conversationId && current.input !== initial.input && current.input ? current.input : prompt;
            await drafts.update(target.conversationId, owner, { context, text, target: executionTarget, searchScope: scope?.id ?? null });
            if (current.conversation?.conversationId !== target.conversationId) return;
            current.replaceContext(context); current.setInput(text); current.setTarget(executionTarget); current.setScope(scope);
            current.clearMultiSelect(); current.setView("conversation"); inputRef.current?.focus();
          });
        } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
        finally { uploadingRef.current = false; uploadConversation.current = null; setUploading(false); holdPanel(false); }
        return;
      }
    }
  };
  const runCatalogEntry = async (item: LauncherCatalogEntry, args = catalogArguments(item, parseLauncherEntry(useLauncherStore.getState().input).text)) => {
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
      const context = useLauncherStore.getState().context;
      const selection = context.find((entry): entry is Extract<AssistantContextItem, { type: "selection" }> => entry.type === "selection")?.text;
      const clipboard = context.find((entry): entry is Extract<AssistantContextItem, { type: "clipboard" }> => entry.type === "clipboard")?.text;
      const files = context.flatMap(entry => entry.type === "file" ? [entry.path] : []);
      try {
        const rendered = await client.renderQuickAction(item.quickAction.id, { selection, clipboard, files, arguments: args });
        if (item.quickAction.target === "project" && item.quickAction.projectId) useLauncherStore.getState().setTarget({ kind: "project", workspaceId: item.quickAction.projectId });
        else if (item.quickAction.target === "project" && useLauncherStore.getState().target.kind !== "project") { notify({ tone: "error", text: t("launcher.notice.needs_project") }); return; }
        else if (item.quickAction.target !== "project") useLauncherStore.getState().setTarget({ kind: "assistant" });
        void client.recordQuickActionUse(item.quickAction.id).catch(() => undefined);
        const prompt = item.quickAction.skill ? `Load [skill ${item.quickAction.skill}] and follow its instructions.\n\n${rendered.prompt}` : rendered.prompt;
        await submitAsk(prompt, undefined, item.quickAction.output === "copy" || item.quickAction.output === "insert" ? item.quickAction.output : undefined,
          item.quickAction.command ? { name: item.quickAction.command, arguments: prompt } : undefined);
      } catch (error) { notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (item.source === "skill") { await submitAsk(`Load [skill ${item.label}] and follow its instructions.\n\n${args}`); return; }
    // Slash commands run through the engine as agent work; a project's own command binds that project.
    if (item.workspaceId && item.workspaceId !== assistant?.workspaceId) useLauncherStore.getState().setTarget({ kind: "project", workspaceId: item.workspaceId });
    const name = item.command?.name ?? item.label.replace(/^\//, "");
    await submitAsk(`/${name}${args ? ` ${args}` : ""}`, undefined, undefined, { name, arguments: args });
  };
  const applyInvocation = useCallback(async (invocation: LauncherInvocation) => {
    const bound = invocation.action === "new-conversation" ? (await client.createAssistantConversation({ origin: surface })).conversation
      : invocation.conversationId ? (await client.assistantConversation(invocation.conversationId)).conversation : await bindCurrent();
    if (bound) {
      useLauncherStore.getState().bindConversation(bound);
      if (invocation.conversationId || ["ask", "resume", "new-conversation"].includes(invocation.action) || useLauncherStore.getState().view === "conversation") await adoptDraft(bound.id, true);
    }
    const aliasKinds: Partial<Record<LauncherInvocation["action"], LauncherSearchKind>> = { files: "files", projects: "projects", chats: "chats", tasks: "tasks", recordings: "recordings" };
    const kind = aliasKinds[invocation.action];
    if (invocation.projectId) { const workspace = workspaces.find(workspace => workspace.id === invocation.projectId); if (workspace) store.setScope({ id: workspace.id, name: workspace.displayName || workspace.name }); }
    if (invocation.contextId) { const staged = await client.consumeLauncherContext(invocation.contextId); addItems(staged.items); }
    if (kind) { store.setCategory(kind); store.setInput(invocation.query ?? ""); store.setView("results"); }
    else if (invocation.action === "search") { store.setCategory(null); store.setInput(invocation.query ?? ""); store.setView("results"); }
    else if (invocation.action === "ask") { store.setInput(invocation.query ?? ""); store.setView("conversation"); }
    else if (invocation.action === "new-conversation") store.setView("conversation");
    else if (invocation.action === "resume") store.setView("conversation");
    else if (invocation.action === "work") store.setView("work");
    else if (invocation.action === "speak") void speak();
    else if (invocation.action === "capture-region") void captureActions.region();
    else if (invocation.action === "capture-window") void captureActions.window();
    else if (invocation.action === "quick-action" && invocation.actionId) {
      const loaded = await client.launcherCatalog(invocation.projectId ?? null);
      const item = loaded.entries.find(entry => entry.id === invocation.actionId);
      if (!item) throw new Error(t("launcher.notice.action_unknown"));
      await runCatalogEntry(item, invocation.query ?? "");
    }
    else if (invocation.action === "dictate" || invocation.action === "record") {
      if (!desktop) openInApp("/recorder");
      else { if (invocation.action === "dictate" && surface === "panel") dismiss(); void launcherVoice(invocation.action).catch(() => openInApp("/recorder")); }
    }
    if (invocation.conversationId) store.setView("conversation");
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, client, catalog, startNewConversation, bindCurrent, adoptDraft]);
  useEffect(() => {
    if (!store.invocation || invocationRunning.current) return;
    const invocation = store.invocation;
    invocationRunning.current = invocation.id;
    void applyInvocation(invocation).catch(error => notify({ tone: "error", text: error instanceof Error ? error.message : String(error) })).finally(() => {
      invocationRunning.current = null;
      if (useLauncherStore.getState().invocation?.id === invocation.id) useLauncherStore.getState().setInvocation(null);
      else { const pending = useLauncherStore.getState().invocation; if (pending) useLauncherStore.getState().setInvocation({ ...pending }); }
    });
  }, [store.invocation, applyInvocation]);

  const conversations = useQuery({ queryKey: ["launcher-conversations", client.baseUrl], queryFn: () => client.assistantConversations({ limit: 6 }), enabled: store.view === "idle", staleTime: 10_000 });
  const resumeConversation = async () => {
    if (conversation) await adoptDraft(conversation.conversationId, true);
    store.setView("conversation");
    inputRef.current?.focus();
  };
  const browseCategory = (category: LauncherSearchKind) => {
    store.setCategory(category); store.setInput(""); store.setOverlay(null); store.clearMultiSelect(); store.setView("results"); inputRef.current?.focus();
  };
  const categoryRows: NavigationRow[] = categorySuggestions(store.view === "idle" ? "" : store.input, aliases).map(kind => ({
    id: `category:${kind}`, title: t(KIND_HINT[kind]), Icon: CATEGORY_ICONS[kind], shortcut: aliases[kind], run: () => browseCategory(kind),
  }));
  const assistantRow: NavigationRow = { id: "home:new", title: t("assistant.title"), subtitle: t("launcher.idle.new_hint"), Icon: MessageSquare, run: startNewConversation };
  const assistantSuggestion = store.input.trim() && ["assistant", "ask", "fragen"].some(word => word.startsWith(store.input.trim().toLocaleLowerCase()));
  const suggestionRows = mode === "search" && !searchCategory && !calculation ? [...categoryRows, ...(assistantSuggestion ? [assistantRow] : [])] : [];
  const chooseCommandContext = async (workspaceId?: string) => {
    const input = useLauncherStore.getState().input;
    const { conversation: created } = await client.createAssistantConversation({ origin: surface });
    await drafts.claim(created.id, owner);
    const target = workspaceId ? { kind: "project" as const, workspaceId } : { kind: "assistant" as const };
    await drafts.update(created.id, owner, { text: input, target, searchScope: null });
    store.bindConversation(created); setSubmission(null);
    store.setTarget(target); store.setInput(input); store.setCategory(null); store.setScope(null); store.setFileFilter({ types: null, modifiedAfter: null }); store.setView("conversation"); inputRef.current?.focus();
  };
  const commandContextRows: NavigationRow[] = [
    { id: "command-context:assistant", title: assistant?.profile.name ?? t("assistant.title"), Icon: MessageSquare, run: () => chooseCommandContext() },
    ...workspaces.map(workspace => ({ id: `command-context:${workspace.id}`, title: workspace.displayName || workspace.name, Icon: Folder, run: () => chooseCommandContext(workspace.id) })),
  ];
  const homeRows: NavigationRow[] = [
    ...(conversation ? [{ id: "home:resume", title: conversation.title, subtitle: t("launcher.idle.resume_hint"), Icon: MessageSquare, run: resumeConversation }] : []),
    assistantRow,
    ...categoryRows,
    ...(savedSearches.data?.searches ?? []).slice(0, 5).map(search => ({ id: `home:search:${search.id}`, title: search.name, subtitle: [search.kind ? t(KIND_HINT[search.kind]) : t("launcher.saved.all_kinds"), search.query].filter(Boolean).join(" · "), Icon: Bookmark, run: () => applySavedSearch(search), remove: () => { void deleteSavedSearch(search.id); } })),
    ...pins.slice(0, 4).map(pin => ({ id: `home:pin:${pin.kind}:${pin.sourceId}:${pin.id}`, title: pin.title, subtitle: pin.subtitle ?? t(KIND_HINT[pin.kind]), Icon: CATEGORY_ICONS[pin.kind], run: () => openInApp(pin.kind === "chats" ? workspaceSessionRoute(pin.workspaceId ?? "", pin.id) : pin.workspaceId ? `${workspaceProjectRoute(pin.workspaceId)}${pin.kind === "files" ? `?file=${encodeURIComponent(pin.path ?? pin.id)}` : ""}` : "/home") })),
    ...(conversations.data?.items ?? []).filter(item => item.id !== conversation?.conversationId).slice(0, 4).map(item => ({ id: `home:chat:${item.id}`, title: item.title, subtitle: t(item.kind === "day" ? "launcher.idle.day" : "launcher.idle.conversation"), Icon: MessageSquare, run: async () => { store.bindConversation(item); await adoptDraft(item.id, true); store.setView("conversation"); inputRef.current?.focus(); } })),
  ];
  const navigationRows = showCommands && store.view !== "conversation" ? commandContextRows : store.view === "idle" ? homeRows : store.view === "results" ? suggestionRows : [];
  const selectable: SelectableItem[] = [
    ...navigationRows.map(item => ({ id: item.id, primaryAction: "open" as const })),
    ...(showCommands ? commandItems.map(item => ({ id: item.id, primaryAction: item.kind === "agent" ? "run" as const : "open" as const }))
      : store.view === "results" ? calculation ? calculation.value !== null ? [{ id: "calculator", primaryAction: "copy-reference" as const }] : [] : store.results.map(item => ({ id: resultKey(item), primaryAction: primaryResultAction(item) })) : []),
  ];
  const selectionSignature = JSON.stringify(selectable.map(item => item.id));
  useEffect(() => {
    const state = useLauncherStore.getState();
    const next = reconcileSelection(state.selection, selectable);
    if (next.id !== state.selection.id || next.source !== state.selection.source) state.select(next);
    // The row identities, not changing labels, determine selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSignature, store.view, store.selection.id, store.selection.source]);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [store.selection.id, store.view, selectionSignature]);
  const selected = enterTarget(store.selection, selectable);
  const selectedNavigation = navigationRows.find(item => item.id === selected?.id);
  const runNavigation = (row: NavigationRow) => void Promise.resolve().then(row.run).catch(error => notify({ tone: "error", text: String(error) }));
  const renderNavigationRows = (rows: NavigationRow[]) => <LauncherNavigationRows rows={rows} selected={selected?.id ?? null} onSelect={id => store.select({ id, source: "user" })} onError={error => notify({ tone: "error", text: String(error) })} />;
  const copyCalculation = async () => {
    if (calculation?.value === null || !calculation) return;
    try { await navigator.clipboard.writeText(calculation.value); notify({ tone: "info", text: t("launcher.notice.copied") }); }
    catch { notify({ tone: "error", text: t("launcher.calculator.copy_failed") }); }
  };
  const goBack = async () => {
    if (savingNavigation.current) return;
    const state = useLauncherStore.getState();
    if (state.view === "conversation" && parseLauncherEntry(state.input).mode === "command" && !state.overlay) { state.setInput(""); inputRef.current?.focus(); return; }
    const layer = escapeAction({ overlayOpen: state.overlay !== null, detail: state.view === "conversation" || state.view === "work", query: Boolean(state.input), category: Boolean(state.category || state.scope || hasFileFilter) });
    if (layer === "overlay") state.setOverlay(null);
    else if (layer === "view") {
      savingNavigation.current = true;
      if (state.view === "conversation" && state.conversation && drafts.owns(state.conversation.conversationId, owner)) {
        try { await drafts.update(state.conversation.conversationId, owner, { text: state.input, context: state.context, target: state.target, searchScope: state.scope?.id ?? null }); }
        catch (error) { savingNavigation.current = false; notify({ tone: "error", text: String(error) }); return; }
      }
      const previous = navigation.current.back(state);
      useLauncherStore.setState(previous);
      if (previous.view === "conversation" && previous.conversation) {
        try { await adoptDraft(previous.conversation.conversationId, true); }
        catch (error) { notify({ tone: "error", text: String(error) }); }
      }
      savingNavigation.current = false;
    } else if (layer === "query") { state.setInput(""); state.select({ id: null, source: "auto" }); }
    else if (layer === "filter") { state.setCategory(null); state.setScope(null); state.setFileFilter({ types: null, modifiedAfter: null }); }
    else dismiss();
    inputRef.current?.focus();
  };
  const openWork = async () => {
    if (store.view === "work") { await goBack(); return; }
    const state = useLauncherStore.getState();
    if (state.view === "conversation" && state.conversation && drafts.owns(state.conversation.conversationId, owner)) {
      try { await drafts.update(state.conversation.conversationId, owner, { text: state.input, context: state.context, target: state.target, searchScope: state.scope?.id ?? null }); }
      catch (error) { notify({ tone: "error", text: String(error) }); return; }
    }
    store.setInput(""); store.setView("work"); inputRef.current?.focus();
  };
  const openActions = () => { if (selected && !selectedNavigation && store.view === "results" && !calculation) store.setOverlay({ kind: "actions", resultKey: selected.id }); };
  // Shared by the entry and home rows; native menus get first refusal.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isComposingKeyEvent(event)) return;
    const key = event.key;
    if (key === "Escape") { event.preventDefault(); event.stopPropagation(); void goBack(); return; }
    const input = inputRef.current;
    if (!input || (event.target !== input && !(event.target instanceof Element && event.target.matches("[data-launcher-item]")))) return;
    const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
    if (modifier && key === "Enter" && !showCommands) { event.preventDefault(); void submitAsk(mode === "ask" ? entry.text : store.input); return; }
    if ((modifier && key.toLowerCase() === "k") || (key === "ArrowRight" && !event.shiftKey && !event.altKey && !modifier && input.selectionStart === input.selectionEnd && input.selectionEnd === input.value.length)) {
      if (selected && !selectedNavigation && store.view === "results" && !calculation) { event.preventDefault(); event.stopPropagation(); openActions(); }
      return;
    }
    if (modifier && key.toLowerCase() === "y") { event.preventDefault(); event.stopPropagation(); if (selected && !selectedNavigation && store.view === "results" && !calculation) store.setOverlay(store.overlay?.kind === "preview" ? null : { kind: "preview", resultKey: selected.id }); return; }
    if (modifier && key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void saveCurrentSearch(); return; }
    if (key === "ArrowDown" || key === "ArrowUp") { if (!selectable.length || event.shiftKey || modifier || event.altKey) return; event.preventDefault(); store.select(moveSelection(store.selection, selectable, key === "ArrowDown" ? 1 : -1)); return; }
    if (key === "Tab" && !event.shiftKey && !modifier && selectedNavigation) { event.preventDefault(); runNavigation(selectedNavigation); return; }
    if (key === "Tab" && !event.shiftKey && showCommands) {
      const item = commandItems.find(item => item.id === selected?.id);
      if (item) { event.preventDefault(); const args = catalogArguments(item, entry.text); store.setInput(`/${item.command?.name ?? item.label.replace(/^\//, "")}${args ? ` ${args}` : " "}`); }
      return;
    }
    if (key === "Tab" && !event.shiftKey && !store.category && mode === "search") {
      const activated = activateCategoryAlias(store.input, aliases, "tab");
      if (activated) { event.preventDefault(); store.setCategory(activated.category); store.setInput(activated.rest); }
      return;
    }
    if (key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0 && mode === "search") {
      if (store.category) { event.preventDefault(); store.setCategory(null); }
      return;
    }
    if (key !== "Enter") return;
    if (event.shiftKey && (mode === "ask" || mode === "conversation")) return;
    event.preventDefault();
    if (event.shiftKey) return;
    if (selectedNavigation) { runNavigation(selectedNavigation); return; }
    if (showCommands) { const item = commandItems.find(item => item.id === selected?.id); if (item) void runCatalogEntry(item, catalogArguments(item, entry.text)); return; }
    if (mode === "ask" || mode === "conversation") { void submitAsk(mode === "ask" ? entry.text : store.input); return; }
    if (calculation) { void copyCalculation(); return; }
    const result = store.results.find(item => resultKey(item) === selected?.id);
    if (result) void runResultAction(result, primaryResultAction(result));
  };
  const onInputChange = (value: string) => {
    if (store.view === "work") store.setView("idle");
    if (pastedText.current) { pastedText.current = false; store.setInput(value); return; }
    if (!store.category && mode === "search") {
      const activated = activateCategoryAlias(value, aliases);
      if (activated) { store.setCategory(activated.category); store.setInput(activated.rest); return; }
    }
    store.setInput(value);
  };
  const expand = async () => {
    if (!conversation) { openInApp("/home"); return; }
    const live = useLauncherStore.getState();
    await drafts.update(conversation.conversationId, owner, { text: mode === "ask" ? entry.text : live.input, context: live.context,
      target: live.target, searchScope: live.scope?.id ?? null, model: local.prefs.defaultModel, variant: local.prefs.modelVariant });
    await drafts.release(conversation.conversationId, owner);
    openInApp(`${workspaceSessionRoute(conversation.workspaceId, conversation.sessionId)}?conversation=${encodeURIComponent(conversation.conversationId)}`);
  };

  const selectedResult = store.view === "results" && !calculation ? store.results.find(item => resultKey(item) === (store.overlay?.kind === "actions" ? store.overlay.resultKey : store.selection.id)) ?? null : null;
  const verb = footerVerb(selected, showCommands ? "command" : mode);
  const pinnedKeys = useMemo(() => new Set(pins.map(pin => `${pin.kind}\u0000${pin.sourceId}\u0000${pin.id}`)), [pins]);
  const placeholder = mode === "conversation" ? t("launcher.placeholder.conversation", { name: assistant?.profile.name ?? t("assistant.title") }) : store.category ? t("launcher.placeholder.category", { kind: t(KIND_HINT[store.category]) }) : t("launcher.placeholder.search");

  return <div className="launcher-root" data-surface={surface} data-view={store.view} onKeyDown={onKeyDown}
    onDragEnter={event => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); if (dragDepth.current++ === 0) { setDragging(true); holdPanel(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = uploading ? "none" : "copy"; } }}
    onDragLeave={event => { if (!event.dataTransfer.types.includes("Files") || !dragDepth.current) return; event.preventDefault(); if (--dragDepth.current === 0) { setDragging(false); holdPanel(false); } }}
    onDrop={event => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); if (dragDepth.current) holdPanel(false); dragDepth.current = 0; setDragging(false); const dropped = droppedFiles(event.dataTransfer); if (dropped.folders) notify({ tone: "error", text: t("launcher.drop.folders") }); void uploadFiles(dropped.files); }}>
    <div className="launcher-panel" role="dialog" aria-label={t("launcher.title")}>
      {(dragging || uploading) && <div className="launcher-drop-status" role="status">{uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}{t(uploading ? "launcher.drop.busy" : "launcher.drop.hint")}</div>}
      <div className="launcher-entry">
        {(store.view === "conversation" || store.view === "work") ? <Button variant="ghost" size="icon-sm" aria-label={t("launcher.back")} title={t("launcher.back")} onClick={() => void goBack()}><ArrowLeft className="size-4" /></Button> : <AssistantAvatar icon={assistant?.profile.icon} className="size-6" motion={sending ? "thinking" : undefined} />}
        {store.category && <span className="launcher-chip" data-kind="category">{t(KIND_HINT[store.category])}<button type="button" aria-label={t("launcher.chip.remove_category")} onClick={() => { store.setCategory(null); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        {store.scope && <span className="launcher-chip" data-kind="scope" title={t("launcher.chip.scope_hint")}>{store.scope.name}<button type="button" aria-label={t("launcher.chip.remove_scope")} onClick={() => { store.setScope(null); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        {store.target.kind === "project" && <span className="launcher-chip" data-kind="target" title={t("launcher.chip.target_hint")}>{t("launcher.chip.target", { name: (workspace => workspace ? workspace.displayName || workspace.name : store.target.kind === "project" ? store.target.workspaceId : "")(workspaces.find(workspace => workspace.id === (store.target.kind === "project" ? store.target.workspaceId : ""))) })}<button type="button" aria-label={t("launcher.chip.remove_target")} onClick={() => store.setTarget({ kind: "assistant" })}><X className="size-3" /></button></span>}
        {(() => { const labels = fileFilterLabels(store.fileFilter); return <>
          {labels.type && <span className="launcher-chip" data-kind="filter">{labels.type}<button type="button" aria-label={t("launcher.filter.types_any")} onClick={() => { store.setFileFilter({ types: null }); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
          {labels.modified && <span className="launcher-chip" data-kind="filter">{labels.modified}<button type="button" aria-label={t("launcher.filter.modified_any")} onClick={() => { store.setFileFilter({ modifiedAfter: null }); inputRef.current?.focus(); }}><X className="size-3" /></button></span>}
        </>; })()}
        <textarea ref={inputRef} className="launcher-input" rows={1} value={store.input} placeholder={placeholder} aria-label={t("launcher.title")} autoFocus autoComplete="off" spellCheck={false} onChange={event => onInputChange(event.target.value)} role={selectable.length ? "combobox" : undefined} aria-autocomplete={selectable.length ? "list" : undefined} aria-expanded={selectable.length ? true : undefined} aria-controls={selectable.length ? "launcher-options" : undefined} aria-activedescendant={selected ? optionId(selected.id) : undefined}
          onFocus={() => { if (store.view === "conversation" && conversation && !drafts.owns(conversation.conversationId, owner)) void adoptDraft(conversation.conversationId, true); }}
          onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void uploadFiles(files); } else if (event.clipboardData.getData("text")) pastedText.current = true; }} />
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
          <Button variant="ghost" size="icon-sm" aria-label={t("launcher.work.title")} title={t("launcher.work.title")} onClick={() => void openWork()}><ListChecks className="size-4" />{store.attentionCount > 0 && <span className="ml-0.5 rounded-full bg-blue-9 px-1 text-[10px] text-white">{store.attentionCount}</span>}</Button>

          {surface === "panel" && <Button variant="ghost" size="icon-sm" aria-label={t("launcher.expand")} title={t("launcher.expand")} onClick={() => void expand().catch(error => notify({ tone: "error", text: error instanceof Error ? error.message : String(error) }))}><Maximize2 className="size-4" /></Button>}
          {surface === "embedded" && <Button variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={dismiss}><X className="size-4" /></Button>}
        </div>
      </div>
      {desktop && <LauncherOutputHistory visible={store.visible} />}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => { holdPanel(false); const files = Array.from(event.target.files ?? []); event.target.value = ""; void uploadFiles(files); }} />
      {store.notice && <div className="launcher-notice" data-tone={store.notice.tone} role={store.notice.tone === "error" ? "alert" : "status"}>{store.notice.text}<button type="button" className="float-right" aria-label={t("common.close")} onClick={() => notify(null)}><X className="size-3.5" /></button></div>}
      {store.approval && surface === "panel" && <LauncherApprovalCard request={store.approval} onReply={async (id, decision) => { try { await launcherApprovalReply(id, decision); } finally { useLauncherStore.getState().setApproval(null); } }} />}
      {dictation.active && <div className="px-3 pt-2"><ComposerDictationBar dictation={dictation} sendDisabled={sending} /></div>}
      {store.view === "conversation" && <LauncherContextBar />}
      {store.view !== "conversation" && attentionItems.length > 0 && <AttentionCards items={attentionItems} busy={attentionBusy} onReply={replyAttention} onOpen={item => openInApp(workspaceSessionRoute(item.workspaceId, item.sessionId))} />}
      <div ref={bodyRef} className="launcher-body">
        {showCommands && store.view === "conversation" && <SubmissionStatusRow submission={submission} onRetry={retrySubmission} />}
        {store.view === "results" && !calculation && <div id="launcher-options" role="listbox" aria-label={t("launcher.results.title")} aria-multiselectable>
          {renderNavigationRows(suggestionRows)}
          <LauncherResultList items={store.results} sources={store.sources} query={searchText} selectedKey={store.selection.id} multiSelect={store.multiSelect} pins={pinnedKeys} pending={store.searchPending} hideEmpty={suggestionRows.length > 0}
            onSelect={key => { if (store.overlay?.kind !== "actions") store.select({ id: key, source: "user" }); }} onRun={(result, action) => void runResultAction(result, action)} onToggleMulti={store.toggleMultiSelect} onOpenActions={key => store.setOverlay({ kind: "actions", resultKey: key })} />

          {store.searchError && <p className="launcher-notice" data-tone="error">{store.searchError}</p>}
        </div>}
        {store.view === "results" && calculation && <div className="launcher-calculator" id="launcher-options" role="listbox" aria-label={t("launcher.calculator.title")}>
          {calculation.value !== null ? <div id={optionId("calculator")} role="option" aria-selected={selected?.id === "calculator"} data-selected={selected?.id === "calculator"} data-launcher-item className="launcher-row" onClick={() => void copyCalculation()}>
            <Calculator className="size-5 text-muted-foreground" /><div className="launcher-row-main"><div className="launcher-calculator-expression">{calculation.expression}</div><div className="launcher-calculator-value">{calculation.value}</div></div>
          </div> : <div className="launcher-empty">{t(calculation.error === "undefined" ? "launcher.calculator.undefined" : "launcher.calculator.incomplete")}</div>}
        </div>}
        {showCommands && store.view !== "conversation" && <><p className="launcher-section-title">{t("launcher.commands.choose_context")}</p><div id="launcher-options" role="listbox" aria-label={t("launcher.commands.choose_context")}>{renderNavigationRows(commandContextRows)}</div></>}
        {showCommands && store.view === "conversation" && (commandItems.length ? <div id="launcher-options" role="listbox" aria-label={t("launcher.commands.title")}>{commandItems.map(item => <div key={item.id} id={optionId(item.id)} data-launcher-item role="option" aria-selected={store.selection.id === item.id} data-selected={store.selection.id === item.id} className="launcher-row" onMouseMove={() => store.select({ id: item.id, source: "user" })} onClick={() => void runCatalogEntry(item)}>
          <span className="launcher-row-icon"><Sparkles className="size-4" /></span>
          <div className="launcher-row-main"><div className="launcher-row-title">{item.label}{item.favorite ? " ★" : ""}</div><div className="launcher-row-meta">{[t(`launcher.action_kind.${item.kind}`), item.source === "quick-action" ? t("launcher.source.quick_action") : item.source === "command" ? t("launcher.source.command") : item.source === "skill" ? t("launcher.source.skill") : null, item.requires.length ? t("launcher.requires", { inputs: item.requires.map(input => t(`launcher.input.${input}`)).join(", ") }) : null, item.description].filter(Boolean).join(" · ")}</div></div>
          <span className="launcher-row-hint">{item.shortcut}</span>
        </div>)}</div> : <div className="launcher-empty">{t(catalogQuery.isPending || skillsQuery.isLoading ? "launcher.coverage.searching" : "launcher.commands_empty")}</div>)}
        {store.view === "conversation" && !showCommands && conversation && <LauncherConversation conversation={conversation} submission={submission} pendingOutput={pendingOutput} onRetry={retrySubmission} onOutputApplied={() => setPendingOutput(null)}
          onArchived={() => { const state = useLauncherStore.getState(); state.bindConversation(null); state.setInput(""); state.replaceContext([]); setSubmission(null); state.setView("idle"); void bindCurrent().catch(() => undefined); }} />}
        {store.view === "conversation" && !showCommands && !conversation && <div className="launcher-empty">{t("launcher.conversation.new_hint")}</div>}
        {store.view === "work" && <LauncherWork onOpenConversation={id => void client.assistantConversation(id).then(({ conversation: found }) => { store.bindConversation(found); store.setView("conversation"); }).catch(() => notify({ tone: "error", text: t("launcher.conversation.unavailable") }))} />}
        {store.view === "idle" && <div className="launcher-idle" id="launcher-options" role="listbox" aria-label={t("launcher.title")}>
          {renderNavigationRows(homeRows)}
        </div>}
      </div>
          {store.overlay?.kind === "actions" && selectedResult && <LauncherActionMenu result={selectedResult} multiSelected={store.multiSelect.size} pinned={isPinned(pins, selectedResult)} extra={["preview", ...(entry.text.trim() || store.category ? ["save-search" as const] : [])]} projects={workspaces.filter(workspace => workspace.id !== selectedResult.workspaceId).map(workspace => ({ id: workspace.id, name: workspace.displayName || workspace.name }))}
            onTransfer={(action, projectId) => { store.setOverlay(null); void transferFiles(selectedResult, action, projectId); inputRef.current?.focus(); }}
            onRun={action => { store.setOverlay(null); void runResultAction(selectedResult, action); inputRef.current?.focus(); }} onExtra={action => { store.setOverlay(action === "preview" ? { kind: "preview", resultKey: resultKey(selectedResult) } : null); if (action === "save-search") void saveCurrentSearch(); inputRef.current?.focus(); }} onClose={() => { store.setOverlay(null); inputRef.current?.focus(); }} />}
      {store.view === "results" && store.overlay?.kind === "preview" && selectedResult && <LauncherPreviewPane result={selectedResult} />}
      <div className="launcher-footer">
        <span className="launcher-footer-status" aria-live="polite">{sending ? t("launcher.submission.sending") : store.searchPending && !calculation ? <><Loader2 className="size-3 animate-spin motion-reduce:animate-none" />{t("content_search.searching")}</> : store.view === "idle" ? t("launcher.idle.compact_hint", { files: aliases.files }) : store.target.kind === "project" && store.view === "conversation" ? t("launcher.footer.target_bound") : ""}</span>
        <div className="launcher-footer-actions">
          {calculation?.value != null ? <button type="button" onClick={() => void copyCalculation()}>{t("launcher.calculator.copy")}<kbd>↵</kbd></button> : verb !== "none" && <span>{verb === "ask" ? t("launcher.footer.ask_short") : actionLabel(verb === "run" ? "run" : verb === "attach" ? "attach" : verb === "resume" ? "resume" : verb === "answer" ? "complete" : "open")}<kbd>↵</kbd></span>}
          {selectedResult && <button type="button" onClick={openActions} title={`${mod}K`}>{t("launcher.footer.actions")}<kbd>→</kbd></button>}
          <button type="button" onClick={() => void goBack()}>{t(store.view === "idle" && !store.overlay ? "common.close" : "launcher.back")}<kbd>Esc</kbd></button>
        </div>
      </div>
    </div>
  </div>;
}
