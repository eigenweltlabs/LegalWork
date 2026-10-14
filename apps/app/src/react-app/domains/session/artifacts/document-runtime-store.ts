import { writeMarkdownChunk } from "./markdown-stream";
import { attachmentFilename } from "@/app/lib/attachment-filename";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { LegalworkControlAction, LegalworkControlSurface } from "../../../shell/control/control-provider";
import type { ArtifactPanelProps } from "./artifact-panel";
import { classifyOpenTarget } from "./open-target";
import { usePanelTabStore, workspacePanelKey } from "../panel/panel-tab-store";
import { storageFileTab } from "../panel/storage-file-tab";
import { createDocumentTaskQueue } from "./document-task-queue";

export type DocumentProject = { projectId: string; workspaceId: string; workspaceRoot: string; client: LegalworkServerClient; isRemoteWorkspace: boolean };
export type Registration = { surface: LegalworkControlSurface; action: LegalworkControlAction; ready: () => boolean; dirty: () => boolean };
export type Entry = {
  key: string;
  props: ArtifactPanelProps;
  host: HTMLDivElement;
  sessions: Set<string>;
  destinations: Map<HTMLElement, boolean>;
  registration: Registration | null;
};

export function documentKey(props: ArtifactPanelProps) {
  return JSON.stringify([props.client?.baseUrl, props.workspaceId, props.tab.storage ? [props.tab.storage.root.id, props.tab.storage.file.path] : props.tab.value ?? props.tab.id]);
}
export function stringArg(args: unknown, key: string) {
  const value: unknown = args && typeof args === "object" ? Reflect.get(args, key) : undefined;
  return typeof value === "string" ? value : "";
}
function validPath(path: string) {
  return Boolean(path) && !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..");
}

export function createDocumentRuntime(createHost = () => document.createElement("div"), fallbackProject?: (sessionId: string) => Promise<DocumentProject>) {
  const entries = new Map<string, Entry>();
  const selected = new Map<string, string>();
  const taskSessions = new Map<string, string>();
  const listeners = new Set<() => void>();
  const queue = createDocumentTaskQueue();
  let version = 0;
  let resolveProject: ((sessionId: string) => DocumentProject) | null = null;
  const changed = () => { version++; listeners.forEach(listener => listener()); };
  const ensure = (props: ArtifactPanelProps) => {
    const key = documentKey(props);
    const existing = entries.get(key);
    if (existing) return existing;
    const host = createHost();
    host.className = "flex h-full min-h-0 min-w-0 flex-col";
    const entry: Entry = { key, props, host, sessions: new Set(), destinations: new Map(), registration: null };
    entries.set(key, entry);
    changed();
    return entry;
  };
  const close = (entry: Entry) => {
    entries.delete(entry.key);
    for (const [session, key] of selected) if (key === entry.key) selected.delete(session);
    usePanelTabStore.getState().closeTab(entry.props.sessionId, entry.props.tab.id);
    changed();
  };
  const prune = () => {
    for (const entry of entries.values()) {
      if (entry.destinations.size || [...selected.values()].includes(entry.key) || !entry.registration || entry.registration.dirty()) continue;
      if (usePanelTabStore.getState().sessions[entry.props.sessionId]?.tabs.some(tab => tab.id === entry.props.tab.id)) continue;
      close(entry);
    }
  };
  const resolvedProjects = new Map<string, DocumentProject>();
  const getProject = async (sessionId: string) => {
    if (!sessionId) throw new Error("A task identity is required.");
    try { if (resolveProject) return resolveProject(sessionId); } catch (error) { if (!fallbackProject) throw error; }
    const cached = resolvedProjects.get(sessionId);
    if (cached) return cached;
    if (!fallbackProject) throw new Error("The task's project is unavailable.");
    const project = await fallbackProject(sessionId);
    resolvedProjects.set(sessionId, project);
    return project;
  };
  const belongs = (entry: Entry, project: DocumentProject) => entry.props.workspaceId === project.workspaceId && entry.props.client?.baseUrl === project.client.baseUrl;
  const select = (entry: Entry, sessionId: string) => {
    entry.sessions.add(sessionId);
    selected.set(sessionId, entry.key);
    changed();
  };
  const current = (sessionId: string, project: DocumentProject, path?: string) => {
    const explicit = selected.get(sessionId);
    const candidates = [...entries.values()].filter(entry => belongs(entry, project));
    const entry = path ? candidates.find(entry => (entry.registration?.surface.path ?? entry.props.tab.value) === path)
      : candidates.find(entry => entry.key === explicit) ?? candidates.find(entry => [...entry.destinations.values()].some(Boolean));
    if (!entry) throw new Error("No document is selected for this task. Use inapp_documents_open with its workspace path; no visible tab is required.");
    return entry;
  };
  const waitUntilReady = async (entry: Entry) => {
    const deadline = Date.now() + 60_000;
    while (entries.get(entry.key) === entry && Date.now() < deadline) {
      if (entry.registration?.ready()) return entry.registration;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The document could not finish loading. The task can report the failure without changing the user's view.");
  };
  return {
    entries, changed, ensure, close, getProject, taskSessions, prune,
    releaseTask: (sessionId: string) => { selected.delete(sessionId); taskSessions.delete(sessionId); prune(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => version,
    setResolver: (resolver: (sessionId: string) => DocumentProject) => { resolveProject = resolver; },
    async createMarkdown(args: unknown) {
      const sessionId = stringArg(args, "sessionId"), path = stringArg(args, "path"), content = stringArg(args, "content");
      if (!validPath(path) || !/\.(md|markdown)$/i.test(path)) throw new Error("Use a new workspace-relative Markdown filename.");
      const project = await getProject(sessionId);
      const append = Boolean(args && typeof args === "object" && Reflect.get(args, "append") === true);
      const complete = Boolean(args && typeof args === "object" && Reflect.get(args, "complete") === true);
      return queue(JSON.stringify([project.client.baseUrl, project.workspaceId, path]), () => writeMarkdownChunk({
        workspaceId: project.workspaceId, sessionId, path, content, append, complete,
        exists: async () => (await project.client.statWorkspaceFile(project.workspaceId, path)).exists,
        save: value => project.client.writeWorkspaceFile(project.workspaceId, { path, content: value, createOnly: true }),
      }));
    },
    async open(args: unknown) {
      const sessionId = stringArg(args, "sessionId");
      const project = await getProject(sessionId);
      let path = stringArg(args, "path"), connectionId = stringArg(args, "connectionId");
      const copyTo = stringArg(args, "copyTo");
      if (!validPath(path)) throw new Error("Use a relative file path within the workspace or connection.");
      if (copyTo) {
        if (!validPath(copyTo) || copyTo.split(".").at(-1)?.toLowerCase() !== (connectionId ? path : attachmentFilename(path)).split(".").at(-1)?.toLowerCase()) throw new Error("Use a new workspace-relative filename with the same file extension as the template.");
        if (connectionId) {
          const copy = await project.client.checkoutStorageFile(project.workspaceId, connectionId, path);
          await project.client.keepStorageLocalCopy(project.workspaceId, connectionId, copy.localPath, copyTo);
        } else await project.client.copyWorkspaceFile(project.workspaceId, path, copyTo);
        path = copyTo; connectionId = "";
      }
      const name = connectionId ? path.split("/").at(-1)! : attachmentFilename(path);
      const preview = classifyOpenTarget(name, "file");
      if (preview === "external" || preview === "browser") throw new Error("This file type has no in-app document editor. Use the tools for its saved file.");
      const file = connectionId ? null : await project.client.statWorkspaceFile(project.workspaceId, path);
      if (file && (!file.exists || file.kind !== "file")) throw new Error("File not found in this task's workspace.");
      const root = connectionId ? (await project.client.storageRoots(project.workspaceId)).roots.find(root => root.id === connectionId) : null;
      if (connectionId && !root) throw new Error("This storage connection is unavailable.");
      const tab = root ? storageFileTab(project.workspaceId, root, { path, name, kind: "file", size: null, modifiedAt: null })
        : { id: `file:${path}`, type: "artifact", label: name, value: path, preview, size: file?.size, updatedAt: file?.updatedAt } satisfies ArtifactPanelProps["tab"];
      const entry = ensure({ ...project, sessionId: workspacePanelKey(project.projectId), tab, onClose: () => {} });
      select(entry, sessionId);
      const liveEditing = ["word", "markdown"].includes(preview) || /\.(xlsx|pptx)$/i.test(path);
      if (liveEditing) await waitUntilReady(entry);
      return { ok: true, name, path: entry.registration?.surface.path ?? path, liveEditing, ...(copyTo ? { copied: true } : {}), message: "The document is ready for this task. Use the matching inapp_* tools. The user's view has not changed." };
    },
    async list(args: unknown) {
      const sessionId = stringArg(args, "sessionId"), project = await getProject(sessionId);
      let active: Entry | undefined;
      try { active = current(sessionId, project); } catch { /* No selected document yet. */ }
      const files = [...entries.values()].filter(entry => belongs(entry, project)).map(entry => ({
        name: entry.props.tab.label, path: entry.registration?.surface.path ?? entry.props.tab.value,
        sessionId, active: entry === active,
      }));
      return { openFiles: files, surfaces: [...entries.values()].filter(entry => belongs(entry, project) && entry.registration).map(entry => ({ ...entry.registration!.surface, sessionId, sessionIds: [sessionId] })), activeSurface: active?.registration ? { ...active.registration.surface, sessionId, sessionIds: [sessionId] } : null };
    },
    async select(args: unknown) {
      const sessionId = stringArg(args, "sessionId");
      const entry = current(sessionId, await getProject(sessionId), stringArg(args, "path"));
      select(entry, sessionId);
      await waitUntilReady(entry);
      return { ok: true, path: entry.registration?.surface.path, message: "Selected for this task. The user's view has not changed." };
    },
    async execute(actionId: string, args: unknown) {
      const sessionId = stringArg(args, "sessionId");
      // Capture the target before queueing: another task's selection cannot redirect it.
      const entry = current(sessionId, await getProject(sessionId), stringArg(args, "path") || undefined);
      if (!selected.has(sessionId)) select(entry, sessionId);
      else if (!entry.sessions.has(sessionId)) { entry.sessions.add(sessionId); changed(); }
      return queue(entry.key, async () => {
        const registration = await waitUntilReady(entry);
        if (registration.action.id !== actionId || (stringArg(args, "format") && stringArg(args, "format") !== registration.surface.format)) throw new Error("This document requires a different format's tools.");
        // The dispatcher has checked project ownership. Address the persistent
        // editor by its pane identity, without waiting for React to propagate a
        // newly attached chat's membership before this call can proceed.
        const editorArgs = args && typeof args === "object" ? { ...args, sessionId: entry.props.sessionId } : args;
        return registration.action.execute(editorArgs, { setNarration: () => {} });
      });
    },
  };
}
