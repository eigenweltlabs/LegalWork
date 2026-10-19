/** @jsxImportSource react */
/**
 * Recorder onboarding stays one main step: device permissions/model first,
 * then explicit dictation, shortcut/test and meeting-detection choices.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { captureAnalyticsEvent } from "@/app/lib/analytics";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { formatBytes } from "@/app/utils";
import { t } from "@/i18n";
import {
  hasEigenweltFeature,
  useEigenweltEntitlements,
} from "@/react-app/domains/connections/eigenwelt-entitlements";
import type { AudioDictationPermissionKind, AudioPermissionState } from "@legalwork/types/audio";

import { RecorderFlow } from "./recorder-flow";
import { dictationPermissionReady, dictationPermissionsReady, dictationSetupPermissions, onboardingDictationPermissions, type DictationSetupPermission } from "./recorder-permissions";
import { MODEL_TIERS, tierName } from "../recorder/model-tiers";
import { recommendedTier } from "../recorder/recorder-setup";
import { useRecorderStore } from "../recorder/recorder-store";
import { onboardingDemoActive } from "./onboarding-cover";

/** How often the step re-probes the OS while something is still missing. */
const PERMISSION_POLL_MS = 4000;
/** Fallback size shown in demo mode when the real catalog is unavailable. */
const DEMO_MODEL_BYTES = 466 * 1024 * 1024;

type SimState = {
  mic: AudioPermissionState;
  micBusy: boolean;
  sys: AudioPermissionState;
  sysWaiting: boolean;
  model: "not-installed" | "downloading" | "installed";
  dictationPermissions: Record<DictationSetupPermission, boolean>;
  progress: number; // 0..1 while downloading
};

export function AudioStep(props: {
  onDone: (result: "enabled" | "background" | "skipped") => void;
  onBack: () => void;
  /** For the entitlement check — a firm with premium models gets the premium
   *  transcription model offered instead of the free tier. */
  legalworkClient: LegalworkServerClient | null;
  workspaceId: string | null;
}) {
  const store = useRecorderStore();
  const demo = onboardingDemoActive();
  const [sim, setSim] = useState<SimState>({
    mic: "not-determined",
    micBusy: false,
    sys: "not-determined",
    sysWaiting: false,
    model: "not-installed",
    dictationPermissions: { inputMonitoring: false, accessibility: false, automation: false },
    progress: 0,
  });
  const [micBusy, setMicBusy] = useState(false);
  const [sysWaiting, setSysWaiting] = useState(false);
  const [requestingDictation, setRequestingDictation] = useState<AudioDictationPermissionKind | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(!demo);
  const simTimers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const timer of simTimers.current) window.clearTimeout(timer);
    },
    [],
  );
  const later = (ms: number, fn: () => void) => {
    simTimers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    captureAnalyticsEvent("onboarding_audio_viewed");
    if (!demo) void Promise.all([store.init(), store.refreshDictationReadiness()]).finally(() => setCheckingReadiness(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const permissions = store.permissions;
  const bootstrap = store.bootstrap;

  const micState: AudioPermissionState = demo ? sim.mic : (permissions?.microphone ?? "unknown");
  const micDone = micState === "granted" || (!demo && permissions !== null && micState === "unknown");
  const micBlocked = micState === "denied" || micState === "restricted";

  const sysApplies = demo
    ? true
    : permissions?.platform === "darwin" && bootstrap?.capabilities.systemAudio !== false;
  const sysState: AudioPermissionState = demo ? sim.sys : (permissions?.systemAudio ?? "unknown");
  const sysGranted = sysState === "granted" || (!demo && sysState === "unknown");

  // A firm already entitled to premium models (an existing Eigenwelt
  // connection — the onboarding AI step now runs after this one) gets the
  // premium transcription model; everyone else the device recommendation /
  // best free tier. Live query, so the tier upgrades on this screen the
  // moment the platform reports an entitlement.
  const entitlementsQuery = useEigenweltEntitlements({
    client: props.legalworkClient,
    workspaceId: props.workspaceId,
  });
  const premiumEntitled = hasEigenweltFeature(
    entitlementsQuery.data?.entitlements ?? null,
    "premium_models",
  );
  const premiumTier = MODEL_TIERS.find((tier) => tier.key === "premium");
  const recommended =
    premiumEntitled && premiumTier ? premiumTier : recommendedTier(bootstrap);
  const recommendedModel = bootstrap?.models.find((model) => model.id === recommended.modelId);
  const modelInstalled = demo
    ? sim.model === "installed"
    : bootstrap?.models.some((model) => model.id === store.modelId && model.state === "installed") === true;
  // Reuse a usable installed model when an earlier choice is absent or no
  // longer installed. Keep an intentional download selected until it finishes.
  useEffect(() => {
    if (demo || !bootstrap || modelInstalled || bootstrap.models.some(model => model.id === store.modelId && model.state === "downloading")) return;
    const installed = bootstrap.models.find(model => model.id === recommended.modelId && model.state === "installed")
      ?? bootstrap.models.find(model => model.state === "installed" && (model.plan !== "premium" || premiumEntitled || store.unlockedModels.includes(model.id)));
    if (installed) store.setModelId(installed.id);
  }, [demo, bootstrap, modelInstalled, store.modelId, store.setModelId, store.unlockedModels, recommended.modelId, premiumEntitled]);
  const modelDownloading = demo
    ? sim.model === "downloading"
    : recommendedModel?.state === "downloading";
  const totalBytes = demo
    ? DEMO_MODEL_BYTES
    : recommendedModel?.totalBytes || recommendedModel?.approxSizeBytes || 0;
  const downloadedBytes = demo ? sim.progress * DEMO_MODEL_BYTES : (recommendedModel?.downloadedBytes ?? 0);
  const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

  const readiness = store.dictationReadiness;
  const extraPermissions = demo ? dictationSetupPermissions : onboardingDictationPermissions(readiness);
  const nativeDictationReady = demo ? dictationSetupPermissions.every(kind => sim.dictationPermissions[kind]) : dictationPermissionsReady(readiness);
  const permissionViews: Record<DictationSetupPermission, { title: string; body: string }> = {
    inputMonitoring: { title: t("onboarding_audio.permission_monitor_title"), body: t("onboarding_audio.permission_shortcut") },
    accessibility: { title: t("onboarding_audio.permission_a11y_title"), body: t("onboarding_audio.permission_insert") },
    automation: { title: t("onboarding_audio.permission_automation_title"), body: t("onboarding_audio.permission_paste") },
  };
  const allDone = micDone && (!sysApplies || sysGranted) && nativeDictationReady && modelInstalled;

  // Re-check OS permission state when the user returns from System Settings
  // (focus), plus a slow poll while anything is still missing.
  useEffect(() => {
    if (demo) return;
    const refresh = () => { void store.refreshPermissions(); void store.refreshDictationReadiness(); void store.refreshSystemDictation(); void store.refreshMeeting(); };
    const onFocus = refresh;
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(refresh, PERMISSION_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const allowMicrophone = () => {
    captureAnalyticsEvent("onboarding_audio_mic_requested");
    if (demo) {
      setSim((state) => ({ ...state, micBusy: true }));
      later(900, () => setSim((state) => ({ ...state, micBusy: false, mic: "granted" })));
      return;
    }
    if (micState === "not-determined" || micState === "unknown") {
      setMicBusy(true);
      void store.requestPermission("microphone").finally(() => setMicBusy(false));
    } else {
      void store.openPermissionSettings("microphone");
    }
  };

  const openSystemAudioSettings = () => {
    captureAnalyticsEvent("onboarding_audio_sys_requested");
    if (demo) {
      setSim((state) => ({ ...state, sysWaiting: true }));
      later(2200, () => setSim((state) => ({ ...state, sysWaiting: false, sys: "granted" })));
      return;
    }
    setSysWaiting(true);
    void store.openPermissionSettings("systemAudio");
  };

  const startDownload = () => {
    captureAnalyticsEvent("onboarding_audio_model_download");
    if (demo) {
      setSim((state) => ({ ...state, model: "downloading", progress: 0 }));
      return;
    }
    store.setModelId(recommended.modelId);
    void store.downloadModel(recommended.modelId);
  };

  useEffect(() => {
    if (!demo || sim.model !== "downloading") return;
    const timer = window.setInterval(() => setSim(state => {
      const progress = Math.min(1, state.progress + 0.08);
      return { ...state, progress, model: progress === 1 ? "installed" : "downloading" };
    }), 160);
    return () => window.clearInterval(timer);
  }, [demo, sim.model]);

  const cancelDownload = () => {
    if (demo) {
      setSim((state) => ({ ...state, model: "not-installed", progress: 0 }));
      return;
    }
    void store.cancelModelDownload(recommended.modelId);
  };

  const waitingForSettings = demo ? sim.sysWaiting : sysWaiting;
  const requestingMic = demo ? sim.micBusy : micBusy;
  const modelSize = formatBytes(
    recommendedModel?.installedSizeBytes ?? recommendedModel?.approxSizeBytes ?? DEMO_MODEL_BYTES,
  );

  return (
    <RecorderFlow
      demo={demo}
      loading={checkingReadiness}
      microphoneReady={micDone}
      permissionsReady={nativeDictationReady}
      modelReady={modelInstalled}
      onBack={props.onBack}
      onDone={() => props.onDone(modelDownloading ? "background" : allDone ? "enabled" : "skipped")}
      recorderPermissions={
        <div className="divide-y divide-dls-border" data-testid="onboarding-recorder-grants">
          <PermissionRow title={t("recorder.perm_microphone")} description={t("onboarding_audio.permission_microphone")} done={micDone} hint={micBlocked ? t("recorder.perm_microphone_instructions") : null}>
            <Button size="sm" variant="outline" disabled={requestingMic} onClick={allowMicrophone}>
              {requestingMic ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t(micBlocked ? "recorder.perm_open_settings" : "recorder.perm_allow")}
            </Button>
          </PermissionRow>
          {sysApplies ? <PermissionRow title={t("recorder.perm_system_audio")} description={t("onboarding_audio.permission_system")} done={sysGranted}>
            <Button size="sm" variant="outline" onClick={openSystemAudioSettings}>
              {waitingForSettings ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("recorder.perm_allow")}
            </Button>
          </PermissionRow> : null}
          <PermissionRow title={t("onboarding_audio.model_title")} description={modelDownloading ? `${pct}% · ${t("onboarding_audio.background_note")}` : modelInstalled ? t("onboarding_audio.model_local") : `${tierName(recommended.key)} · ${modelSize}`} done={modelInstalled} hint={!demo && recommendedModel?.state === "error" ? recommendedModel.error : null}>
            {modelDownloading ? <div className="flex w-full items-center gap-2">
              <Progress value={pct} className="h-1 flex-1" />
              <span className="text-xs tabular-nums text-subtext">{pct}%</span>
              <Button variant="ghost" size="icon-sm" aria-label={t("recorder.model_cancel")} onClick={cancelDownload}><X /></Button>
            </div> : <Button size="sm" variant="outline" onClick={startDownload}>{t("recorder.model_download")}</Button>}
          </PermissionRow>
        </div>
      }
      dictationPermissions={
        <div className="divide-y divide-dls-border" data-testid="onboarding-dictation-permissions">
          {extraPermissions.map(kind => <PermissionRow key={kind} title={permissionViews[kind].title} description={permissionViews[kind].body} done={demo ? sim.dictationPermissions[kind] : dictationPermissionReady(readiness?.[kind] ?? "not-determined")} hint={readiness?.[kind] === "broken" ? t("recorder.dictation_step_monitor_broken") : null}>
            <Button size="sm" variant="outline" disabled={requestingDictation !== null} onClick={() => {
              if (demo) { setSim(state => ({ ...state, dictationPermissions: { ...state.dictationPermissions, [kind]: true } })); return; }
              setRequestingDictation(kind);
              void store.requestDictationPermission(kind).finally(() => setRequestingDictation(null));
            }}>
              {requestingDictation === kind ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("recorder.perm_allow")}
            </Button>
          </PermissionRow>)}
          {!demo && extraPermissions.length > 0 ? <p className="pt-3 text-xs leading-relaxed text-subtext">{t("recorder.perm_recheck_hint")}</p> : null}
        </div>
      }
    />
  );
}

function PermissionRow(props: { title: string; description: string; done: boolean; hint?: string | null; children: ReactNode }) {
  return <div className="py-3">
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-foreground">{props.title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-subtext">{props.description}</p>
      </div>
      {props.done ? <Check aria-label={t("recorder.perm_status_granted")} className="size-4 shrink-0 text-success" /> : <div className="flex max-w-[52%] shrink-0 flex-wrap items-center justify-end gap-2">{props.children}</div>}
    </div>
    {!props.done && props.hint ? <p className="mt-2 text-xs leading-relaxed text-subtext">{props.hint}</p> : null}
  </div>;
}
