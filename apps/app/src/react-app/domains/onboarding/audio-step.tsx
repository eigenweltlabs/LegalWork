/** @jsxImportSource react */
/**
 * Recorder onboarding stays one main step: device permissions/model first,
 * then explicit dictation, shortcut/test and meeting-detection choices.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";

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

import { HubTabs } from "../settings/segmented-tabs";
import { RecorderFeatures } from "./recorder-features";
import { dictationPermissionReady, dictationPermissionsReady, onboardingDictationPermissions, type DictationSetupPermission } from "./recorder-permissions";
import { MODEL_TIERS, tierName } from "../recorder/model-tiers";
import { SetupStep, recommendedTier } from "../recorder/recorder-setup";
import { useRecorderStore } from "../recorder/recorder-store";
import {
  CoverBackButton,
  CoverSkipButton,
  OnboardingCover,
  StepDots,
  onboardingDemoActive,
} from "./onboarding-cover";

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
  dictationPermissions: boolean;
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
    dictationPermissions: false,
    progress: 0,
  });
  const [micBusy, setMicBusy] = useState(false);
  const [sysWaiting, setSysWaiting] = useState(false);
  const [sysSkipped, setSysSkipped] = useState(false);
  const [section, setSection] = useState<"permissions" | "features">("permissions");
  const [dictationSkipped, setDictationSkipped] = useState(false);
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
  const sysDone = sysGranted || sysSkipped;

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
  const downloadedBytes = demo
    ? Math.round(sim.progress * DEMO_MODEL_BYTES)
    : (recommendedModel?.downloadedBytes ?? 0);
  const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

  const readiness = store.dictationReadiness;
  const extraPermissions = onboardingDictationPermissions(readiness);
  const nativeDictationReady = demo ? sim.dictationPermissions : dictationPermissionsReady(readiness);
  const permissionViews: Record<DictationSetupPermission, { title: string; body: string }> = {
    inputMonitoring: { title: t("recorder.dictation_step_monitor_title"), body: t(readiness?.inputMonitoring === "broken" ? "recorder.dictation_step_monitor_broken" : readiness?.inputMonitoring === "denied" ? "recorder.dictation_step_monitor_denied" : "recorder.dictation_step_monitor_body") },
    accessibility: { title: t("recorder.dictation_step_a11y_title"), body: t("recorder.dictation_step_a11y_body") },
    automation: { title: t("recorder.dictation_step_automation_title"), body: t(readiness?.automation === "denied" ? "recorder.dictation_step_automation_denied" : "recorder.dictation_step_automation_body") },
  };
  const steps = [
    { id: "microphone" as const, done: micDone, doneLabel: t("recorder.perm_status_granted") },
    ...(sysApplies
      ? [
          {
            id: "systemAudio" as const,
            done: sysDone,
            doneLabel: sysGranted ? t("recorder.perm_status_granted") : t("recorder.setup_skipped"),
          },
        ]
      : []),
    ...extraPermissions.map(id => ({ id, done: dictationSkipped || dictationPermissionReady(readiness?.[id] ?? "not-determined"), doneLabel: t(dictationSkipped ? "recorder.setup_skipped" : "recorder.perm_status_granted") })),
    ...(demo ? [{ id: "dictationPermissions", done: dictationSkipped || sim.dictationPermissions, doneLabel: t(dictationSkipped ? "recorder.setup_skipped" : "recorder.perm_status_granted") }] : []),
    { id: "model", done: modelInstalled, doneLabel: t("recorder.model_installed") },
  ];
  const activeIndex = steps.findIndex((step) => !step.done);
  const allDone = activeIndex === -1;

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
      const tick = () => {
        setSim((state) => {
          if (state.model !== "downloading") return state;
          const progress = Math.min(1, state.progress + 0.03 + Math.random() * 0.05);
          if (progress >= 1) return { ...state, model: "installed", progress: 1 };
          return { ...state, progress };
        });
        later(160, tick);
      };
      later(160, tick);
      return;
    }
    store.setModelId(recommended.modelId);
    void store.downloadModel(recommended.modelId);
  };

  const cancelDownload = () => {
    if (demo) {
      setSim((state) => ({ ...state, model: "not-installed", progress: 0 }));
      return;
    }
    void store.cancelModelDownload(recommended.modelId);
  };

  const finish = (result: "enabled" | "background" | "skipped") => {
    props.onDone(result);
  };

  const waitingForSettings = demo ? sim.sysWaiting : sysWaiting;
  const requestingMic = demo ? sim.micBusy : micBusy;
  const modelSize = formatBytes(
    recommendedModel?.installedSizeBytes ?? recommendedModel?.approxSizeBytes ?? DEMO_MODEL_BYTES,
  );

  const reviewPermissions = () => { setDictationSkipped(false); setSection("permissions"); };

  return (
    <OnboardingCover
      compact={section === "features"}
      wide={section === "features"}
      footerLeft={<CoverBackButton label={t("onboarding.back")} onClick={section === "features" ? reviewPermissions : props.onBack} />}
      footerRight={
        section === "features" ? (
          <Button size="sm" disabled={store.starting || store.finalizing || Boolean(store.dictationRecordingId)} onClick={() => finish(modelDownloading ? "background" : allDone ? "enabled" : "skipped")}>
            {t("onboarding.continue")}
          </Button>
        ) : allDone ? (
          <Button size="sm" disabled={checkingReadiness} onClick={() => setSection("features")}>
            {t("onboarding.continue")}
          </Button>
        ) : modelDownloading ? (
          <Button size="sm" disabled={checkingReadiness} onClick={() => setSection("features")}>
            {t("onboarding_audio.continue_background")}
          </Button>
        ) : (
          <CoverSkipButton label={t("onboarding_audio.setup_later")} onClick={() => setSection("features")} />
        )
      }
    >
      <div className="flex w-full flex-col gap-6">
        <div>
          <StepDots step={3} total={5} />
          <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.04em] text-foreground">
            {t("onboarding_audio.title")}
          </h1>
          <p className="mt-3 max-w-sm text-[14px] leading-[1.6] text-dls-secondary">
            {t(section === "features" ? "onboarding_audio.features_subtitle" : "onboarding_audio.subtitle")}
          </p>
        </div>

        <HubTabs label={t("onboarding_audio.setup_label")} value={section} onChange={next => { if (next === "permissions") reviewPermissions(); else setSection(next); }} items={[
          { id: "permissions", label: t("onboarding_audio.permissions_tab") },
          { id: "features", label: t("onboarding_audio.features_tab") },
        ]} />
        {section === "features" ? <RecorderFeatures demo={demo} microphoneReady={micDone} permissionsReady={nativeDictationReady} modelReady={modelInstalled} onPermissions={reviewPermissions} /> : <>
        <div className="divide-y divide-subtle overflow-hidden rounded-2xl border border-subtle bg-surface shadow-xs">
          {steps.map((step, index) => {
            const active = index === activeIndex;
            if (step.id === "microphone") {
              return (
                <SetupStep
                  key={step.id}
                  index={index}
                  done={step.done}
                  active={active}
                  title={t("recorder.setup_mic_title")}
                  doneLabel={step.doneLabel}
                >
                  <p className="text-sm text-subtext">
                    {micBlocked
                      ? t("recorder.perm_microphone_instructions")
                      : t("recorder.setup_mic_body")}
                  </p>
                  <div className="mt-3">
                    {micBlocked ? (
                      <Button size="sm" variant="outline" onClick={allowMicrophone}>
                        <ExternalLink data-icon="inline-start" />
                        {t("recorder.perm_open_settings")}
                      </Button>
                    ) : (
                      <Button size="sm" disabled={requestingMic} onClick={allowMicrophone}>
                        {requestingMic ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : null}
                        {t("recorder.setup_mic_cta")}
                      </Button>
                    )}
                  </div>
                </SetupStep>
              );
            }
            if (step.id === "systemAudio") {
              return (
                <SetupStep
                  key={step.id}
                  index={index}
                  done={step.done}
                  active={active}
                  title={t("recorder.setup_sys_title")}
                  doneLabel={step.doneLabel}
                >
                  <p className="text-sm text-subtext">{t("recorder.setup_sys_body")}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Button size="sm" onClick={openSystemAudioSettings}>
                      <ExternalLink data-icon="inline-start" />
                      {t("recorder.perm_open_settings")}
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-subtext underline-offset-2 hover:text-ink hover:underline"
                      onClick={() => setSysSkipped(true)}
                    >
                      {t("recorder.setup_sys_skip")}
                    </button>
                  </div>
                  {waitingForSettings ? (
                    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-subtext animate-in fade-in-0">
                      <Loader2 className="size-3 animate-spin text-brand" />
                      {t("recorder.setup_sys_waiting")}
                    </p>
                  ) : null}
                </SetupStep>
              );
            }
            const extra = extraPermissions.find(kind => kind === step.id);
            if (extra || step.id === "dictationPermissions") {
              const view = extra ? permissionViews[extra] : { title: t("onboarding_audio.dictation_permissions_title"), body: t("onboarding_audio.dictation_permissions_body") };
              return <SetupStep key={step.id} index={index} done={step.done} active={active} title={view.title} doneLabel={step.doneLabel}>
                <p className="text-sm text-subtext">{view.body}</p>
                {!demo && readiness?.packaged === false ? <p className="mt-2 text-xs text-subtext">{t("recorder.perm_dev_hint")}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button size="sm" disabled={requestingDictation !== null} onClick={() => {
                    if (demo) { setSim(state => ({ ...state, dictationPermissions: true })); return; }
                    if (!extra) return;
                    setRequestingDictation(extra);
                    void store.requestDictationPermission(extra).finally(() => setRequestingDictation(null));
                  }}>
                    {requestingDictation === extra ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {t(demo || extra && readiness?.[extra] === "not-determined" ? "recorder.perm_allow" : "recorder.perm_open_settings")}
                  </Button>
                  <button type="button" className="text-xs text-subtext hover:text-ink" onClick={() => setDictationSkipped(true)}>{t("onboarding_audio.dictation_permissions_skip")}</button>
                </div>
              </SetupStep>;
            }
            return (
              <SetupStep
                key={step.id}
                index={index}
                done={step.done}
                active={active}
                title={t("recorder.setup_model_title")}
                doneLabel={step.doneLabel}
              >
                <p className="text-sm text-subtext">{t("recorder.setup_model_body")}</p>
                <div className="mt-3 flex items-center gap-3">
                  {modelDownloading ? (
                    <>
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="text-2xs tabular-nums text-subtext">
                        {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("recorder.model_cancel")}
                        onClick={cancelDownload}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={startDownload}>
                      {t("recorder.model_download")} {tierName(recommended.key)} · {modelSize}
                    </Button>
                  )}
                </div>
                {!demo && recommendedModel?.state === "error" && recommendedModel.error ? (
                  <div className="mt-1 text-xs text-red-11">{recommendedModel.error}</div>
                ) : null}
              </SetupStep>
            );
          })}
        </div>

        {allDone ? (
          <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-green-11">
            <Check className="size-4" />
            {t("onboarding_audio.permissions_ready")}
          </span>
        ) : modelDownloading ? (
          <p className="text-[13px] text-dls-secondary">{t("onboarding_audio.background_note")}</p>
        ) : null}
        </>}
      </div>
    </OnboardingCover>
  );
}
