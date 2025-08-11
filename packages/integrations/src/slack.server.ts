// Server-side exports for Slack integration
export * from "./slack/lib/client";
export * from "./slack/lib/service";
export * from "./slack/lib/messages";

// Re-export specific types to avoid conflicts
export type { DocumentType } from "./slack/lib/service";