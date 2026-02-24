import { notificationRegistry } from "./registry";
import { JiraNotificationService } from "./services/jira";
import { LinearNotificationService } from "./services/linear";
import { SlackNotificationService } from "./services/slack";

notificationRegistry.register(new SlackNotificationService());
notificationRegistry.register(new LinearNotificationService());
notificationRegistry.register(new JiraNotificationService());

export * from "./pipeline";
export * from "./registry";
export * from "./types";
export { JiraNotificationService };
export { SlackNotificationService };
