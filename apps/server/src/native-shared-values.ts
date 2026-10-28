// Build this shared runtime boundary to plain JavaScript for the unpacked server.
// Consumers must never depend on workspace TypeScript being installed at runtime.
export { inferNativeDefaultVariant } from "@legalwork/types/native-model-display";
export { isInternalSession, LEGALMEMORY_INTERNAL_SESSION } from "@legalwork/types/session-visibility";
export { isRetiredRemoteWorkspace } from "@legalwork/types/workspace";
export { LegalMemoryPermissionsSchema, LegalMemoryPermissionSchema, LegalMemoryPermissionReplySchema } from "@legalwork/types/legalmemory";
export { ScheduledTaskMessageSchema } from "@legalwork/types/scheduled-tasks";
export { isReviewWorkerSession } from "@legalwork/types/reviews";
export { browserPasswordRequestSchema } from "@legalwork/types/browser-password-request";

export { codeModeWidgetResults, toolDisplayText } from "@legalwork/types/chat-tool-results";
