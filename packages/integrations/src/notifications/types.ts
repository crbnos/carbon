import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Integration types
export interface CompanyIntegration {
  id: string;
  companyId: string;
  metadata: Record<string, any>;
  active: boolean;
}

// Base notification event types
export interface BaseNotificationEvent {
  companyId: string;
  userId: string;
  carbonUrl: string;
}

export interface IssueCreatedEvent extends BaseNotificationEvent {
  type: "issue.created";
  data: {
    id: string;
    nonConformanceId: string;
    title: string;
    description: string;
    severity: string;
  };
}

export interface IssueStatusChangedEvent extends BaseNotificationEvent {
  type: "issue.status.changed";
  data: {
    id: string;
    status: string;
    nonConformanceId: string;
    title: string;
  };
}

export interface TaskStatusChangedEvent extends BaseNotificationEvent {
  type: "task.status.changed";
  data: {
    id: string;
    status: string;
    issueId: string;
    title: string;
    type?: string;
  };
}

export interface TaskAssignedEvent extends BaseNotificationEvent {
  type: "task.assigned";
  data: {
    id: string;
    table: string;
    assignee: string;
    title?: string;
  };
}

export type NotificationEvent =
  | IssueCreatedEvent
  | IssueStatusChangedEvent
  | TaskStatusChangedEvent
  | TaskAssignedEvent;

// Notification service interface
export interface NotificationService {
  id: string;
  name: string;
  send(event: NotificationEvent, config: any): Promise<void>;
}

// Context for notification services
export interface NotificationContext {
  client: SupabaseClient<Database>;
  serviceRole?: SupabaseClient<Database>;
}

// Service registry
export interface NotificationServiceRegistry {
  register(service: NotificationService): void;
  getService(id: string): NotificationService | undefined;
  getAllServices(): NotificationService[];
}
