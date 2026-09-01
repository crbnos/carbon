import type { Database } from "@carbon/database";
import type {
  NotificationDestination,
  NotificationEvent
} from "@carbon/notifications";
import type { RunTrigger } from "@carbon/workflows";

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
      // At least one of documentId / documentIds is required. Digest-capable
      // events pass documentIds (one notification covering several documents);
      // the primary/link id is documentId ?? documentIds[0].
      documentId?: string;
      documentIds?: string[];
      recipient:
        | { type: "user"; userId: string }
        | { type: "group"; groupIds: string[] }
        | { type: "users"; userIds: string[] };
      from?: string;
      documentType?: ApprovalDocumentType;
      /** Set by a workflow: the message is authored by the customer, not read from a document. */
      title?: string;
      body?: string;
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
      // Recurring notification emails only: after the provider accepts the
      // send, the send-email function bumps the delivery counters for these.
      tracking?: {
        event: NotificationEvent;
        userId: string;
        documentIds: string[];
      };
    };
  };

  // Assembly model conversion (CAD → GLB + assembly graph)
  "carbon/assembly-convert": {
    data: {
      modelUploadId: string;
      companyId: string;
      userId: string;
    };
  };

  // Assembly motion planning (collision-free removal paths + sequence)
  "carbon/assembly-plan": {
    data: {
      modelUploadId: string;
      companyId: string;
      userId: string;
      // When set (the user clicked "Re-run Motion Planning" on an instruction
      // that already has steps), the planner runs in order-preserving mode: it
      // takes the existing step order as fixed (options.sequence) and recomputes
      // each step's motion to avoid collision with parts from earlier steps, then
      // updates the step motions in place. Mutually exclusive with reordering.
      reMotionFor?: string;
      // Fresh regenerate: re-detect groups from scratch. When set, the worker
      // sends only USER-authored units to the planner (auto-detected swarm units
      // are excluded) so detection re-runs — WITHOUT deleting the materialized
      // `assemblyUnit` rows up front. The rows are swapped atomically when the
      // new plan's steps are generated, so a failed/late generate leaves the old
      // grouped state intact instead of stranding the model ungrouped.
      reDetectUnits?: boolean;
      // A pre-created `assemblyPlanJob` row (status Queued) the worker should
      // adopt instead of inserting its own. User-facing triggers create the row
      // synchronously so the UI reflects "planning" immediately — the worker's
      // own insert only lands after event pickup, and a page revalidation in
      // that gap would see no running job and never start polling.
      planJobId?: string;
    };
  };

  // Model thumbnail generation
  "carbon/model-thumbnail": {
    data: {
      modelId: string;
      companyId: string;
    };
  };

  // Eager model optimisation on upload (mesh inputs → compact optimised GLB)
  "carbon/assembler-job-done": {
    data: {
      /** The assembler job id the waiting run matches on. */
      jobId: string;
      /** Terminal public status: succeeded | failed | canceled. */
      status: string;
      result: unknown;
      stats: unknown;
      error: { code?: string; message?: string } | null;
    };
  };
  "carbon/model-optimize": {
    data: {
      modelUploadId: string;
      companyId: string;
      userId: string;
      // format is derived from the stored file inside the job, not passed here.
      // Force a fresh optimise of an already-Successful model (the badge's
      // refresh action) — bypasses the already-optimized guard and mints a
      // fresh assembler job id (the stable id would attach to the previous
      // run's cached result and finish instantly).
      force?: boolean;
    };
  };

  // Compact the retained raw (STEP → BinXCAF `.xbf.zst`, mesh → `.{ext}.zst`)
  // so it never lingers as the fat upload. Fired after model-optimize settles
  // (success, already-optimized, or failure) — decoupled so an optimize
  // failure can't strand a fat raw for the prune to delete.
  "carbon/model-compact": {
    data: {
      modelUploadId: string;
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

  // Onboarding demo template — applies a shared dataset to a freshly created
  // company by running the same tier code the dev seed runs. Not an import: no
  // archive, no bucket. `datasetKey` is a plain string so @carbon/lib does not
  // take a dependency on @carbon/database; the job validates it.
  "carbon/company-template": {
    data: {
      companyId: string;
      userId: string;
      datasetKey: string;
      templateRunId: string;
      /**
       * Snapshot the company before wiping, and leave the run parked on a
       * keep/revert decision instead of clearing the marker. Onboarding and the
       * Settings page both set this; absent means the legacy fire-and-forget
       * behaviour.
       */
      snapshot?: boolean;
    };
  };

  // Keep an applied demo template — drop the pre-apply snapshot and the marker.
  "carbon/company-template-finalize": {
    data: {
      companyId: string;
      templateRunId: string;
    };
  };

  // Undo an applied demo template — wipe and reload the pre-apply snapshot.
  "carbon/company-template-revert": {
    data: {
      companyId: string;
      userId: string;
      templateRunId: string;
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
      // The acting admin's userId — recorded as the actor on the audit event
      // (NIST 800-171 3.3.1/3.3.2). Optional for backward-compatible replays.
      actorId?: string;
      // Source IP of the request that triggered the change (AU-3 source-of-event).
      ip?: string;
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

  // Generate preventive-maintenance dispatches for one schedule on demand
  // (fired when a maintenance schedule is created or updated).
  "carbon/generate-maintenance": {
    data: {
      companyId: string;
      scheduleId: string;
    };
  };

  // User administration
  "carbon/user-admin": {
    data:
      | {
          id: string;
          type: "deactivate";
          companyId: string;
          // The acting admin's userId — recorded as the actor on the audit
          // event (NIST 800-171 3.3.1/3.3.2). Optional for replay safety.
          actorId?: string;
          // Source IP of the request that triggered the change (AU-3 source-of-event).
          ip?: string;
        }
      | {
          id: string;
          type: "resend";
          location: string;
          ip: string;
          companyId: string;
        };
  };

  // Scheduling inputs changed (shift/qualification/work-center/etc.) —
  // consumed by the mark + debounced replan-wave functions
  "carbon/schedule.inputs.changed": {
    data: {
      companyId: string;
      kind:
        | "ability"
        | "shift"
        | "employee-shift"
        | "work-center"
        | "location"
        | "reorder"
        | "people";
      reason: string;
      /** The changed record (abilityId, workCenterId, ...) for precise scoping */
      entityId?: string;
      /**
       * Set by the replan wave when chaining a follow-up batch. The remaining
       * jobs are already stamped stale, so the mark function must skip this
       * event — re-marking would stamp the whole company and loop forever.
       */
      continuation?: boolean;
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

  // Wake event for the PGMQ drainer (event-queue). Pushed by the database via
  // the event-wake edge function whenever events are enqueued or pending.
  "carbon/event-queue.process": {
    data: Record<string, never>;
  };

  // Event handlers
  "carbon/event-webhook": {
    data: {
      msgId: number;
      url: string;
      // Part of the outbound body, but not on the event — forwarded off the
      // queue message by the drainer.
      companyId: string;
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
      companyId: string;
      actorId: string | null;
      workflowRunId: string | null;
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

  // Onshape released-asset backfill / reconcile
  "carbon/onshape-backfill": {
    data: {
      companyId: string;
      userId: string;
      onshapeCompanyId?: string;
      after?: string;
      pageLimit?: number;
    };
  };

  // Onshape go-forward sync: one released revision (from the
  // onshape.revision.created webhook) -> attach assets to the matching item
  "carbon/onshape-revision-sync": {
    data: {
      companyId: string;
      userId: string;
      messageId: string; // Onshape webhook messageId — idempotency key
      partNumber: string;
      documentId: string;
      versionId: string;
      elementId: string;
      elementType: number; // 0 = part studio, 1 = assembly, 2 = drawing
      revisionId?: string;
    };
  };

  // Sync external accounting (accepts the full AccountingSyncSchema payload)
  "carbon/sync-external-accounting": {
    data: {
      companyId: string;
      provider: string;
      syncType?: "webhook" | "scheduled" | "trigger";
      syncDirection: "push-to-accounting" | "pull-from-accounting" | "two-way";
      entities: Array<{
        entityType: string;
        entityId: string;
        operation?: "create" | "update" | "delete" | "sync";
      }>;
      metadata?: Record<string, unknown>;
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

  // Document extraction (PDF auto-fill)
  "carbon/extract-document": {
    data: {
      documentExtractionId: string;
      companyId: string;
    };
  };

  // A matched workflow firing: one event per created workflowRun row.
  "carbon/workflow-run.queued": {
    data: {
      runId: string;
      companyId: string;
      workflowId: string;
      workflowVersionId: string;
      eventId: string;
      ownerId: string;
      sourceEventId: string;
      trigger: RunTrigger;
    };
  };

  // The self-chaining scheduler's own wake. Each wake books the next one as a future-dated send;
  // `bookedFor` is the booking this wake was created by, or null from the hourly backstop, which
  // always adopts the chain.
  "carbon/workflow-scheduler.wake": {
    data: {
      bookedFor: number | null;
    };
  };

  // Workflow moments — raised after a business action commits.
  "carbon/workflow-moment.raised": {
    data: {
      /** Minted by raiseMoment; also set as the Inngest event id. */
      momentId: string;
      moment: string;
      companyId: string;
      /** auth.uid() of the actor; null for service-role / background writes. */
      actorId: string | null;
      /** Output name -> entity id, per the moment's declaration. */
      outputs: Record<string, { id: string }>;
    };
  };
};
