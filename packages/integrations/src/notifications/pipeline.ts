import { notificationRegistry } from "./registry";
import type {
  CompanyIntegration,
  NotificationContext,
  NotificationEvent,
} from "./types";

export class NotificationPipeline {
  constructor(private context: NotificationContext) {}

  async send(
    event: NotificationEvent,
    integrations: CompanyIntegration[]
  ): Promise<void> {
    try {
      const activeNotificationServices = integrations.filter(
        (integration) =>
          integration.active && this.isNotificationService(integration.id)
      );

      const sendPromises = activeNotificationServices.map(
        async (integration) => {
          const service = notificationRegistry.getService(integration.id);
          if (!service) {
            console.warn(
              `Notification service ${integration.id} not found in registry`
            );
            return;
          }

          try {
            await service.send(event, {
              serviceRole: this.context.serviceRole || this.context.client,
            });
          } catch (error) {
            console.error(
              `Failed to send notification via ${integration.id}:`,
              error
            );
          }
        }
      );

      await Promise.all(sendPromises);
    } catch (error) {
      console.error("Failed to send notification:", error);
    }
  }

  private isNotificationService(integrationId: string): boolean {
    const notificationServiceIds = ["slack"];
    return notificationServiceIds.includes(integrationId);
  }
}

export function createNotificationPipeline(
  context: NotificationContext
): NotificationPipeline {
  return new NotificationPipeline(context);
}

export async function notifyIssueCreated(
  context: NotificationContext,
  integrations: CompanyIntegration[],
  data: {
    companyId: string;
    userId: string;
    carbonUrl: string;
    issue: {
      id: string;
      nonConformanceId: string;
      title: string;
      description: string;
      severity: string;
    };
  }
): Promise<void> {
  const pipeline = createNotificationPipeline(context);
  await pipeline.send(
    {
      type: "issue.created",
      companyId: data.companyId,
      userId: data.userId,
      carbonUrl: data.carbonUrl,
      data: data.issue,
    },
    integrations
  );
}

export async function notifyIssueStatusChanged(
  context: NotificationContext,
  integrations: CompanyIntegration[],
  data: {
    companyId: string;
    userId: string;
    carbonUrl: string;
    issue: {
      id: string;
      status: string;
      nonConformanceId: string;
      title: string;
    };
  }
): Promise<void> {
  const pipeline = createNotificationPipeline(context);
  await pipeline.send(
    {
      type: "issue.status.changed",
      companyId: data.companyId,
      userId: data.userId,
      carbonUrl: data.carbonUrl,
      data: data.issue,
    },
    integrations
  );
}

export async function notifyTaskStatusChanged(
  context: NotificationContext,
  integrations: CompanyIntegration[],
  data: {
    companyId: string;
    userId: string;
    carbonUrl: string;
    task: {
      id: string;
      status: string;
      issueId: string;
      title: string;
      type: "investigation" | "action" | "approval" | "review";
    };
  }
): Promise<void> {
  const pipeline = createNotificationPipeline(context);
  await pipeline.send(
    {
      type: "task.status.changed",
      companyId: data.companyId,
      userId: data.userId,
      carbonUrl: data.carbonUrl,
      data: data.task,
    },
    integrations
  );
}

export async function notifyTaskAssigned(
  context: NotificationContext,
  integrations: CompanyIntegration[],
  data: {
    companyId: string;
    userId: string;
    carbonUrl: string;
    task: {
      id: string;
      table: string;
      assignee: string;
      title?: string;
    };
  }
): Promise<void> {
  const pipeline = createNotificationPipeline(context);
  await pipeline.send(
    {
      type: "task.assigned",
      companyId: data.companyId,
      userId: data.userId,
      carbonUrl: data.carbonUrl,
      data: data.task,
    },
    integrations
  );
}
