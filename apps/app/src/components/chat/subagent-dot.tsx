import { Check, CircleAlert, Clock3, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { getSessionActivityStatusLabel, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";

const palette = ["bg-blue-9", "bg-violet-9", "bg-teal-9", "bg-orange-9", "bg-pink-9", "bg-cyan-9"];

export function subagentColors(ids: readonly string[]) {
  return new Map([...ids].sort().map((id, index) => [id, palette[index % palette.length]]));
}

export function SubagentDot({ color = palette[0], status, stopped = false }: {
  color?: string; status: SessionActivityStatus; stopped?: boolean;
}) {
  const working = status === "thinking" || status === "responding" || status === "compacting";
  const Icon = stopped ? X : status === "idle" ? Check : status === "error" ? CircleAlert : status === "waiting" ? Clock3 : null;
  const label = stopped ? t("session.subagent_stopped") : status === "idle" ? t("session.subagent_completed") : getSessionActivityStatusLabel(status);
  return <span role="img" aria-label={label} className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full text-white", color, working && "motion-safe:animate-pulse", status === "idle" && "opacity-50")}>
    {Icon && <Icon aria-hidden className="size-2.5" strokeWidth={2.5} />}
  </span>;
}
