import { useRef, useState, type ReactNode } from "react";
import { Check, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { useRecorderStore } from "../recorder/recorder-store";
import { DictationShortcutControl } from "../settings/pages/dictation-setup-dialog";
import { ComposerDictationBar } from "../session/surface/composer/composer-dictation";
import { appendDictatedText, useComposerDictation } from "../session/surface/composer/use-composer-dictation";
import { CoverBackButton, OnboardingCover, StepDots } from "./onboarding-cover";

/** Three consecutive views within the existing Recorder onboarding step. */
export function RecorderFlow(props: {
  demo: boolean;
  loading: boolean;
  permissions: ReactNode;
  microphoneReady: boolean;
  permissionsReady: boolean;
  modelReady: boolean;
  onBack: () => void;
  onDone: () => void;
}) {
  const store = useRecorderStore();
  const [section, setSection] = useState<"permissions" | "dictation" | "meetings">("permissions");
  const input = useRef<HTMLTextAreaElement>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoMeetings, setDemoMeetings] = useState(false);
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState("");
  const enabled = props.demo ? demoEnabled : store.systemDictation?.enabled === true;
  const ready = props.microphoneReady && props.permissionsReady;
  const detectionSupported = props.demo || store.meeting?.detectionSupported === true;
  const dictation = useComposerDictation("onboarding-test", spoken => setText(current => appendDictatedText(current, spoken)), section === "dictation");
  const busy = changing || dictation.active || (!props.demo && (store.starting || store.finalizing || Boolean(store.dictationRecordingId) || store.systemDictation?.shortcutCaptureActive === true));
  const title = section === "permissions" ? "onboarding_audio.permissions_title" : section === "dictation" ? "recorder.dictation_title" : "onboarding_audio.meetings_title";
  const subtitle = section === "permissions" ? "onboarding_audio.permissions_subtitle" : section === "dictation" ? "onboarding_audio.dictation_description" : "onboarding_audio.meetings_subtitle";

  return <OnboardingCover compact
    footerLeft={<CoverBackButton label={t("onboarding.back")} disabled={busy} onClick={() => {
      if (section === "permissions") props.onBack();
      else setSection(section === "meetings" ? "dictation" : "permissions");
    }} />}
    footerRight={<Button size="sm" disabled={props.loading || busy} onClick={() => {
      if (section === "meetings") props.onDone();
      else setSection(section === "permissions" ? "dictation" : "meetings");
    }}>{t("onboarding.continue")}</Button>}
  >
    <div className="flex w-full flex-col gap-7" data-testid={`onboarding-recorder-${section}`}>
      <div>
        <StepDots step={3} total={5} />
        <h1 className="text-[32px] font-medium leading-[1.15] tracking-[-0.04em] text-foreground">{t(title)}</h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-dls-secondary">{t(subtitle)}</p>
      </div>

      {section === "permissions" ? <>
        {props.permissions}
        <p className="text-xs text-subtext">{t(props.microphoneReady && props.permissionsReady && props.modelReady ? "onboarding_audio.subtitle" : "onboarding_audio.permissions_optional")}</p>
      </> : section === "dictation" ? <div className="space-y-5">
        <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-dls-border pb-4 text-sm font-medium">
          {t("onboarding_audio.enable_dictation")}
          <Switch aria-label={t("onboarding_audio.enable_dictation")} checked={enabled}
            disabled={changing || dictation.active || (!ready && !enabled) || (!props.demo && !store.systemDictation)}
            onCheckedChange={checked => {
              if (props.demo) { setDemoEnabled(checked); return; }
              setChanging(true);
              void store.setSystemDictationEnabled(checked).finally(() => setChanging(false));
            }} />
        </label>
        {!ready ? <div className="space-y-2">
          <p className="text-xs leading-relaxed text-subtext">{t("onboarding_audio.dictation_permissions_needed")}</p>
          <Button variant="outline" size="sm" onClick={() => setSection("permissions")}>{t("onboarding_audio.review_permissions")}</Button>
        </div> : null}
        {enabled ? <>
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">{t("recorder.dictation_shortcut_setting")}</p>
            <DictationShortcutControl compact demo={props.demo} disabled={dictation.active} onConfigured={() => input.current?.focus()} />
            <p className="mt-2 text-xs leading-relaxed text-subtext">{t(store.systemDictation?.supportsHold === false && !props.demo ? "recorder.dictation_gestures_fallback" : "onboarding_audio.shortcut_gestures")}</p>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="onboarding-dictation-test" className="text-xs font-medium text-foreground">{t("recorder.dictation_test_label")}</label>
              {!dictation.active ? <Button size="sm" variant="ghost" disabled={!props.modelReady || !props.microphoneReady || (!props.demo && (dictation.blocked || !dictation.supported))} onClick={() => {
                if (props.demo) setText(current => appendDictatedText(current, t("onboarding_audio.test_sample")));
                else void dictation.start();
              }}><Mic className="size-3.5" />{t("onboarding_audio.try_dictation")}</Button> : null}
            </div>
            <Textarea ref={input} id="onboarding-dictation-test" value={text} onChange={event => setText(event.currentTarget.value)} disabled={dictation.active} placeholder={t("recorder.dictation_test_placeholder")} className="min-h-24 resize-none text-sm" />
            {dictation.active ? <ComposerDictationBar dictation={dictation} /> : <p className="mt-2 flex items-center gap-1.5 text-xs text-subtext" aria-live="polite">
              {text.trim() ? <Check className="size-3.5 text-success" /> : null}
              {t(text.trim() ? "onboarding_audio.test_result" : !props.modelReady ? "onboarding_audio.test_model_needed" : "onboarding_audio.test_private")}
            </p>}
            {!props.modelReady ? <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setSection("permissions")}>{t("onboarding_audio.review_permissions")}</button> : null}
            {dictation.error ? <p role="alert" className="mt-2 text-xs text-destructive">{dictation.error}</p> : null}
          </div>
        </> : <p className="text-xs text-subtext">{t("onboarding_audio.change_later")}</p>}
        {!props.demo && store.systemDictation?.error ? <p role="alert" className="text-xs text-destructive">{store.systemDictation.error}</p> : null}
      </div> : <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-dls-border pb-4 text-sm font-medium">
          {t("recorder.meeting_detection_title")}
          <Switch aria-label={t("recorder.meeting_detection_title")} checked={props.demo ? demoMeetings : store.meeting?.detectionEnabled === true} disabled={!detectionSupported || changing} onCheckedChange={checked => {
            if (props.demo) { setDemoMeetings(checked); return; }
            setChanging(true);
            void store.setMeetingDetection(checked).finally(() => setChanging(false));
          }} />
        </label>
        <p className="text-xs leading-relaxed text-subtext">{t(detectionSupported ? "onboarding_audio.meetings_manual_start" : "onboarding_audio.detection_unavailable")}</p>
        {!props.demo && store.meeting?.error ? <p role="alert" className="text-xs text-destructive">{store.meeting.error}</p> : null}
      </div>}
    </div>
  </OnboardingCover>;
}
