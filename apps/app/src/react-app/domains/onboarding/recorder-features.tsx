import { useRef, useState } from "react";
import { Check, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { useRecorderStore } from "../recorder/recorder-store";
import { formatDictationShortcut } from "../recorder/dictation-shortcut";
import { DictationShortcutControl } from "../settings/pages/dictation-setup-dialog";
import { ComposerDictationBar } from "../session/surface/composer/composer-dictation";
import { appendDictatedText, useComposerDictation } from "../session/surface/composer/use-composer-dictation";

export function RecorderFeatures(props: { demo: boolean; microphoneReady: boolean; permissionsReady: boolean; modelReady: boolean; onPermissions: () => void }) {
  const store = useRecorderStore();
  const input = useRef<HTMLTextAreaElement>(null);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoMeetings, setDemoMeetings] = useState(false);
  const [changing, setChanging] = useState<"dictation" | "meetings" | null>(null);
  const [text, setText] = useState("");
  const enabled = props.demo ? demoEnabled : store.systemDictation?.enabled === true;
  const ready = props.microphoneReady && props.permissionsReady;
  const detectionSupported = props.demo || store.meeting?.detectionSupported === true;
  const dictation = useComposerDictation("onboarding-test", spoken => setText(current => appendDictatedText(current, spoken)));
  const shortcut = store.systemDictation ? formatDictationShortcut(store.systemDictation.accelerator, store.systemDictation.platform) : "";
  const focusTest = () => input.current?.focus();

  return <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]" data-testid="onboarding-recorder-features">
    <section className="overflow-hidden rounded-2xl border border-subtle bg-surface">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{t("recorder.dictation_title")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-subtext">{t("onboarding_audio.dictation_description")}</p>
        </div>
        <Switch className="mt-0.5 shrink-0" aria-label={t("recorder.dictation_title")} checked={enabled}
          disabled={changing !== null || dictation.active || (!props.demo && (!store.systemDictation || !ready && !enabled))}
          onCheckedChange={checked => {
            if (props.demo) { setDemoEnabled(checked); return; }
            setChanging("dictation");
            void store.setSystemDictationEnabled(checked).finally(() => { setChanging(null); if (checked) focusTest(); });
          }} />
      </div>
      {!ready ? <div className="border-t border-subtle px-4 py-3"><p className="text-xs leading-relaxed text-subtext">{t("onboarding_audio.dictation_permissions_needed")}</p><Button variant="outline" size="sm" className="mt-2" onClick={props.onPermissions}>{t("onboarding_audio.review_permissions")}</Button></div> : null}
      {enabled ? <div className="space-y-4 border-t border-subtle p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-foreground">{t("recorder.dictation_shortcut_setting")}</p>
          <DictationShortcutControl compact demo={props.demo} disabled={dictation.active} onConfigured={focusTest} />
          <p className="mt-2 text-xs leading-relaxed text-subtext">{t(store.systemDictation?.supportsHold === false && !props.demo ? "recorder.dictation_gestures_fallback" : "onboarding_audio.shortcut_gestures")}</p>
        </div>
        <div>
          <label htmlFor="onboarding-dictation-test" className="text-xs font-medium text-foreground">{t("recorder.dictation_test_label")}</label>
          <p className="mt-1 text-xs leading-relaxed text-subtext">{props.demo ? t("onboarding_audio.test_demo_hint") : t("onboarding_audio.test_hint", { shortcut })}</p>
          <Textarea ref={input} id="onboarding-dictation-test" value={text} onChange={event => setText(event.currentTarget.value)} disabled={dictation.active} placeholder={t("recorder.dictation_test_placeholder")} className="mt-2 min-h-20 resize-none text-sm" />
          {dictation.active ? <ComposerDictationBar dictation={dictation} /> : <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-subtext">{text.trim() ? <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-success" />{t("onboarding_audio.test_result")}</span> : !props.modelReady ? t("onboarding_audio.test_model_needed") : t("onboarding_audio.test_private")}</span>
            <Button size="sm" variant="outline" disabled={!props.modelReady || !ready || (!props.demo && (dictation.blocked || !dictation.supported))} onClick={() => {
              if (props.demo) setText(current => appendDictatedText(current, t("onboarding_audio.test_sample")));
              else void dictation.start();
            }}><Mic className="size-3.5" />{t("onboarding_audio.try_dictation")}</Button>
          </div>}
          {dictation.error ? <p role="alert" className="mt-2 text-xs text-destructive">{dictation.error}</p> : null}
        </div>
      </div> : null}
    </section>
    <section className="rounded-2xl border border-subtle bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{t("recorder.meeting_detection_title")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-subtext">{t("recorder.meeting_detection_description")}</p>
        </div>
        <Switch className="mt-0.5 shrink-0" aria-label={t("recorder.meeting_detection_title")} checked={props.demo ? demoMeetings : store.meeting?.detectionEnabled === true} disabled={!detectionSupported || changing !== null} onCheckedChange={checked => {
          if (props.demo) { setDemoMeetings(checked); return; }
          setChanging("meetings");
          void store.setMeetingDetection(checked).finally(() => setChanging(null));
        }} />
      </div>
      {!detectionSupported ? <p className="mt-2 text-xs text-subtext">{t("onboarding_audio.detection_unavailable")}</p> : null}
    </section>
    {store.systemDictation?.error && !props.demo ? <p role="alert" className="text-xs text-destructive md:col-span-2">{store.systemDictation.error}</p> : null}
    {store.meeting?.error && !props.demo ? <p role="alert" className="text-xs text-destructive md:col-span-2">{store.meeting.error}</p> : null}
    <p className="text-xs leading-relaxed text-subtext md:col-span-2">{t("onboarding_audio.change_later")}</p>
  </div>;
}
