import { notificationRegistry } from "./registry";
import { SlackNotificationService } from "./services/slack";

notificationRegistry.register(new SlackNotificationService());

export * from "./pipeline";
export * from "./registry";
export * from "./types";
export { SlackNotificationService };
