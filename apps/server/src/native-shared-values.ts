// Build this shared runtime boundary to plain JavaScript for the unpacked server.
// Consumers must never depend on workspace TypeScript being installed at runtime.
export { inferNativeDefaultVariant } from "@legalwork/types/native-model-display";
export { isInternalSession, LEGALMEMORY_INTERNAL_SESSION } from "@legalwork/types/session-visibility";
export { isRetiredRemoteWorkspace } from "@legalwork/types/workspace";
export { LegalMemoryPermissionsSchema, LegalMemoryPermissionSchema, LegalMemoryPermissionReplySchema } from "@legalwork/types/legalmemory";
export { ScheduledTaskMessageSchema } from "@legalwork/types/scheduled-tasks";
export { isReviewWorkerSession } from "@legalwork/types/reviews";
export { ApproveEngineProjectSchema } from "@legalwork/types/engine-project";
export { browserPasswordRequestSchema } from "@legalwork/types/browser-password-request";

export { projectMessage, projectSession } from "@legalwork/types/opencode-view";
export { codeModeWidgetResults, toolDisplayText } from "@legalwork/types/chat-tool-results";
export { AssistantAttentionItemSchema, AssistantAttentionPresentSchema, AssistantAttentionRefSchema, AssistantAttentionReplySchema, AssistantReactionResultSchema, AssistantReactionEmojiSchema, AssistantShareFileSchema, AssistantAvatarIconSchema, AssistantProfileSchema, DEFAULT_ASSISTANT_PROFILE, MORNING_BRIEFING_PROMPT } from "@legalwork/types/main-assistant";

export { AssistantResourceSchema, AssistantSettingsSchema, AssistantProjectAccessSchema, DEFAULT_ASSISTANT_SETTINGS } from "@legalwork/types/main-assistant";
