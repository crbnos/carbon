import type { Database } from "@carbon/database";
import type {
  NotificationDestination,
  NotificationEvent
} from "@carbon/notifications";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

/**
 * Event definitions for the Carbon inngest functions.
 * Each event has a name and a typed data payload.
 */
export type Events = {
  // Notification events
  "carbon/notify": {
    data: {
      event: NotificationEvent;
      companyId: string;
      documentId: string;
      recipient:
        | { type: "user"; userId: string }
        | { type: "group"; groupIds: string[] }
        | { type: "users"; userIds: string[] };
      from?: string;
      documentType?: ApprovalDocumentType;
      // Caller-selected fan-out targets. inApp is always added by the notify
      // function regardless of what's passed; email and slack are opt-in.
      destinations?: NotificationDestination[];
    };
  };

  // Slack message dispatch (fan-out target from carbon/notify)
  "carbon/send-slack": {
    data: {
      channel: string;
      text: string;
      blocks?: any[];
      companyId: string;
    };
  };

  // Email events
  "carbon/send-email": {
    data: {
      to: string | string[];
      cc?: string | string[];
      from?: string;
      subject: string;
      text: string;
      html: string;
      attachments?: Array<
        | { filename: string; content: string }
        | { filename: string; path: string }
      >;
      companyId: string;
    };
  };

  // Model thumbnail generation
  "carbon/model-thumbnail": {
    data: {
      modelId: string;
      companyId: string;
    };
  };

  // Company backup export — snapshot all company-scoped rows (and
  // optionally storage files) into a gzipped backup in the company bucket
  "carbon/company-export": {
    data: {
      companyId: string;
      userId: string;
      label?: string;
      includeStorage: "none" | "all";
    };
  };

  // Company backup import — two-phase: rows are inserted alongside an
  // externalIntegrationMapping ledger (integration = 'company-backup'),
  // then the user finalizes (keeps) or reverts (deletes) the run
  "carbon/company-import": {
    data: {
      companyId: string;
      userId: string;
      filePath: string;
      mode: "preserve" | "reseed";
      importRunId: string;
      /** Delete the revert ledger as soon as the import commits (no pending
       *  review step). Used by onboarding-from-template. */
      autoFinalize?: boolean;
      /** Set when the source is an onboarding demo template. The template's
       *  storage assets live once per workspace at `_templates/<industryId>/`
       *  (uploaded at deploy), so the import REFERENCES them instead of copying
       *  files into `{companyId}/` — storage path columns are rewritten to the
       *  shared prefix and no per-company file upload happens. Absent for real
       *  backups, which stay self-contained (files embedded + copied). */
      templateIndustryId?: string;
    };
  };

  // In-place restore — replace a company's own data with one of its backups.
  // Three-step: snapshot current state to a hidden _pre-restore file, WIPE the
  // company's companyId-scoped data, then load the backup (ids preserved). A
  // marker row (integration = 'company-restore') holds the snapshot path so the
  // restore can be kept or reverted. Distinct from carbon/company-import, which
  // is additive (reseed/onboarding) and never wipes.
  "carbon/company-restore": {
    data: {
      companyId: string;
      userId: string;
      /** The backup to restore (in this company's bucket, `exports/…`). */
      filePath: string;
      restoreRunId: string;
      /** Whether to also load the backup's bundled files. Data always loads. */
      includeStorage: "none" | "all";
      label?: string;
    };
  };

  // Keep an in-place restore — drop the hidden pre-restore snapshot + marker.
  "carbon/company-restore-finalize": {
    data: {
      companyId: string;
      restoreRunId: string;
    };
  };

  // Undo an in-place restore — wipe again and reload the pre-restore snapshot,
  // returning the company to its pre-restore state, then drop snapshot + marker.
  "carbon/company-restore-revert": {
    data: {
      companyId: string;
      restoreRunId: string;
    };
  };

  // Permission updates
  "carbon/update-permissions": {
    data: {
      id: string;
      addOnly: boolean;
      permissions: Record<
        string,
        { view: boolean; create: boolean; update: boolean; delete: boolean }
      >;
      companyId: string;
    };
  };

  // MES recalculation
  "carbon/recalculate": {
    data: {
      type: "jobRequirements" | "jobMakeMethodRequirements";
      id: string;
      companyId: string;
      userId: string;
    };
  };

  // User administration
  "carbon/user-admin": {
    data:
      | {
          id: string;
          type: "deactivate";
          companyId: string;
        }
      | {
          id: string;
          type: "resend";
          location: string;
          ip: string;
          companyId: string;
        };
  };

  // Job rescheduling
  "carbon/reschedule-job": {
    data: {
      jobId: string;
      companyId: string;
      userId: string;
      mode?: "initial" | "reschedule";
      direction?: "backward" | "forward";
    };
  };

  // Post transaction (accounting)
  "carbon/post-transaction": {
    data: {
      documentId: string;
      type: "receipt" | "purchase-invoice" | "shipment";
      userId: string;
      companyId: string;
    };
  };

  // Slack document sync (4 specific events)
  "carbon/slack-document-created": {
    data: {
      documentType: string;
      documentId: string;
      companyId: string;
      channelId: string;
      threadTs: string;
    };
  };

  "carbon/slack-document-status-update": {
    data: {
      documentType: string;
      documentId: string;
      companyId: string;
      previousStatus: string;
      newStatus: string;
      updatedBy: string;
      reason?: string;
    };
  };

  "carbon/slack-document-task-update": {
    data: {
      documentType: string;
      documentId: string;
      companyId: string;
      taskType: "investigation" | "action" | "approval";
      taskName: string;
      status: string;
      assignee?: string | null;
      completedAt?: string;
    };
  };

  "carbon/slack-document-assignment-update": {
    data: {
      documentType: string;
      documentId: string;
      companyId: string;
      previousAssignee?: string;
      newAssignee: string;
      updatedBy: string;
    };
  };

  // Onboarding
  "carbon/onboard": {
    data: {
      type: "lead" | "customer";
      companyId: string;
      userId: string;
      plan?: string;
    };
  };

  // Event queue processing (PGMQ consumer)
  "carbon/event-queue.process": {
    data: Record<string, never>;
  };

  // Event handlers
  "carbon/event-webhook": {
    data: {
      msgId: number;
      url: string;
      config: {
        headers?: Record<string, string>;
        [key: string]: unknown;
      };
      data: {
        table: string;
        recordId: string;
        operation: "INSERT" | "UPDATE" | "DELETE";
        [key: string]: unknown;
      };
    };
  };

  "carbon/event-workflow": {
    data: {
      msgId: number;
      workflowId: string;
      data: {
        table: string;
        recordId: string;
        operation: "INSERT" | "UPDATE" | "DELETE";
        [key: string]: unknown;
      };
    };
  };

  "carbon/event-sync": {
    data: {
      records: Array<{
        event: {
          table: string;
          recordId: string;
          operation: "INSERT" | "UPDATE" | "DELETE";
          [key: string]: unknown;
        };
        companyId: string;
        handlerConfig: Record<string, unknown>;
      }>;
    };
  };

  "carbon/event-search": {
    data: {
      records: Array<{
        event: {
          table: string;
          recordId: string;
          operation: "INSERT" | "UPDATE" | "DELETE";
          [key: string]: unknown;
        };
        companyId: string;
      }>;
    };
  };

  "carbon/event-audit": {
    data: {
      records: Array<{
        event: {
          table: string;
          recordId: string;
          operation: "INSERT" | "UPDATE" | "DELETE";
          [key: string]: unknown;
        };
        companyId: string;
        actorId?: string;
        handlerConfig: Record<string, unknown>;
      }>;
    };
  };

  "carbon/event-embedding": {
    data: {
      records: Array<{
        event: {
          table: string;
          recordId: string;
          operation: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
          [key: string]: unknown;
        };
        companyId: string;
      }>;
    };
  };

  // Print job events
  "carbon/print-job": {
    data: {
      sourceDocument: string;
      sourceDocumentId: string;
      companyId: string;
      userId: string;
      locationId?: string;
      workCenterId?: string;
      printerRouteId?: string;
    };
  };

  "carbon/print-job-deliver": {
    data: {
      printJobId: string;
      companyId: string;
    };
  };

  // Cleanup tasks
  "carbon/cleanup": {
    data: Record<string, never>;
  };

  // MRP calculation
  "carbon/mrp": {
    data: {
      companyId?: string;
    };
  };

  // Weekly tasks
  "carbon/weekly": {
    data: Record<string, never>;
  };

  // Dispatch
  "carbon/dispatch": {
    data: {
      companyId?: string;
    };
  };

  // Exchange rates update
  "carbon/update-exchange-rates": {
    data: Record<string, never>;
  };

  // Audit archive (scheduled, no payload)
  "carbon/audit-archive": {
    data: Record<string, never>;
  };

  // Accounting backfill
  "carbon/accounting-backfill": {
    data: {
      companyId: string;
      provider: string;
      batchSize?: number;
      entityTypes?: {
        customers?: boolean;
        vendors?: boolean;
        items?: boolean;
      };
    };
  };

  // Sync external accounting (accepts the full AccountingSyncSchema payload)
  "carbon/sync-external-accounting": {
    data: {
      companyId: string;
      provider: string;
      syncDirection: "push-to-accounting" | "pull-from-accounting" | "two-way";
      entities: Array<{
        entityType: string;
        entityId: string;
      }>;
    };
  };

  // Paperless parts integration (full webhook payload)
  "carbon/paperless-parts": {
    data: {
      apiKey: string;
      companyId: string;
      payload: {
        type: string;
        created: string;
        object: string;
        data: Record<string, unknown>;
      };
    };
  };

  // Linear integration (full webhook payload)
  "carbon/linear-sync": {
    data: {
      companyId: string;
      event: {
        type: string;
        action: string;
        data: {
          id: string;
          assigneeId?: string;
          [key: string]: unknown;
        };
      };
    };
  };

  // Jira integration (full webhook payload)
  "carbon/jira-sync": {
    data: {
      companyId: string;
      event: {
        timestamp?: number;
        webhookEvent: string;
        issue?: {
          id: string;
          key: string;
          fields: Record<string, unknown>;
        };
        changelog?: {
          items: Array<Record<string, unknown>>;
        };
      };
    };
  };
};
