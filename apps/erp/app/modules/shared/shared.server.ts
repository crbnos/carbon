// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NotFoundError } from "@carbon/api/errors";
import type { RequiredPermissions } from "@carbon/api/permissions";
import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, unwrap } from "@carbon/api/service-tools.server";
import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import {
  actionTaskEntities,
  actionTaskParentId,
  actionTaskPermissions
} from "@carbon/ee/action-task-entity";
import { resolveIntegrationSecrets } from "@carbon/ee/integrations/secrets";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  linkActionToJiraIssue,
  type TiptapDocument,
  tiptapToAdf,
  unlinkActionFromJiraIssue
} from "@carbon/ee/jira.server";
import {
  getLinearClient,
  linkActionToLinearIssue,
  unlinkActionFromLinearIssue
} from "@carbon/ee/linear.server";
import {
  createIssueSlackThread,
  getCarbonEmployeeFromSlackId
} from "@carbon/ee/slack.server";
import { ERP_URL } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import {
  enrollImplementation,
  getImplementationHub
} from "@carbon/onboarding/server";
import {
  createConnectAccountLink,
  getOrCreateConnectAccount,
  isStaleConnectAccountError
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { nonConformancePriority } from "~/modules/quality/quality.models";
import { insertIssue } from "~/modules/quality/quality.service";
import {
  importQuotes,
  isQuoteImportTable
} from "~/modules/sales/sales.service";
import { path } from "~/utils/path";
import {
  type CreatableLookup,
  creatableLookups,
  importPermissions,
  importRequiresCreate,
  importSchemas
} from "./imports.models";
import * as service from "./shared.service";
import { invokeCreate } from "./shared.service";

const logger = getLogger("erp", "shared");
// ── Operations ──────────────────────────────────────────────────────────────
/**
 * Assign a record to a person, and tell them.
 *
 * @remarks
 * Sets `assignee` on the row of `table` with `id`, as the caller: row-level
 * security decides what they may change. An empty `assignee` unassigns it.
 * When someone is assigned and the table has an assignment notification,
 * they are notified: a job operation's names its job, make method and parent
 * material, and an issue task's names its issue. A failed notification comes
 * back as an error after the assignment is saved.
 */
export const assignRecord = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    id: z.string().min(1),
    assignee: z.string()
  }),
  permission: {},

  async run(ctx, { table, id, assignee }) {
    const client = ctx.asCaller.supabase;
    const assigned = await service.assign(client, { table, id, assignee });
    if (assigned.error) {
      return ctx.error("internal", "Failed to assign", assigned.error);
    }

    const event = assignee ? service.assignmentEvent(table) : null;
    if (!event) return { id };

    let documentId: string | null | undefined = id;
    if (table === "jobOperation") {
      const operation = await client
        .from("jobOperation")
        .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
        .eq("id", id)
        .single();
      const jobId = operation.data?.job?.id;
      const makeMethodId = operation.data?.jobMakeMethod?.id;
      const materialId = operation.data?.jobMakeMethod?.parentMaterialId;
      documentId = `${jobId}:${id}:${makeMethodId}:${materialId ?? ""}`;
    }
    if (
      table === "nonConformanceActionTask" ||
      table === "nonConformanceApprovalTask"
    ) {
      const task = await client
        .from(table)
        .select("nonConformanceId")
        .eq("id", id)
        .single();
      documentId = task.data?.nonConformanceId;
    }
    if (!documentId) return { id };

    try {
      await trigger("notify", {
        companyId: ctx.company.id,
        documentId,
        event,
        recipient: { type: "user", userId: assignee },
        from: ctx.auditUserId
      });
    } catch (error) {
      return ctx.error("internal", "Failed to notify user", error);
    }
    return { id };
  }
});

type ImportTable = keyof typeof importPermissions;

const importTables = Object.keys(importPermissions) as [
  ImportTable,
  ...ImportTable[]
];

// `update` on the table's module; an import that posts stock also needs
// `create`, as the single-record adjustment does.
const importRules = Object.fromEntries(
  importTables.map((table) => [
    table,
    importRequiresCreate.has(table)
      ? { update: importPermissions[table], create: importPermissions[table] }
      : { update: importPermissions[table] }
  ])
) as Record<ImportTable, RequiredPermissions>;

/**
 * Import a CSV file into a table.
 *
 * @remarks
 * The file is already in the company's storage at `filePath`.
 * `columnMappings` names, for each of the table's fields, the CSV column that
 * fills it; the table's required fields must be mapped. `enumMappings` maps
 * CSV values onto a field's allowed values (field → CSV value → value). Needs
 * `update` on the table's module, and `create` too for the stock imports.
 * Quotes go through the sales importer, so each gets its opportunity,
 * payment, shipment and share link as one made in the app does; every other
 * table goes through the `import-csv` posting. Returns how many rows were
 * inserted and updated, and the rows that failed or were skipped, with why.
 */
export const importCsvFile = defineServiceFn({
  input: z.object({
    table: z.enum(importTables),
    filePath: z.string().min(1),
    columnMappings: z.record(z.string(), z.string()),
    enumMappings: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional()
  }),
  permission: { by: "table", rules: importRules },

  async run(ctx, { table, filePath, enumMappings, ...input }) {
    const mapped = importSchemas[table].safeParse(input.columnMappings);
    if (!mapped.success) {
      return ctx.error("validation", z.prettifyError(mapped.error));
    }
    const columnMappings = mapped.data as Record<string, string>;

    const imported = isQuoteImportTable(table)
      ? await importQuotes(ctx.asSystem.supabase, {
          db: ctx.asSystem.pg,
          table,
          filePath,
          columnMappings,
          enumMappings,
          companyId: ctx.company.id,
          companyGroupId: ctx.company.groupId,
          userId: ctx.auditUserId
        })
      : await service.importCsv(ctx, {
          table,
          filePath,
          columnMappings,
          enumMappings
        });
    if (imported.error) {
      return ctx.error("internal", imported.error.message, imported.error);
    }

    type RowIssue = {
      row: number;
      reason: string;
      values: Record<string, string>;
    };
    const summary = (imported.data ?? {}) as {
      inserted?: number;
      updated?: number;
      errors?: RowIssue[];
      skipped?: RowIssue[];
    };
    return {
      inserted: summary.inserted ?? 0,
      updated: summary.updated ?? 0,
      errors: summary.errors ?? [],
      skipped: summary.skipped ?? []
    };
  }
});

// Creating a lookup is gated by the module that owns it. Exhaustive: a new
// lookup without a permission fails typecheck.
const lookupRules: Record<CreatableLookup, RequiredPermissions> = {
  supplierType: { create: "purchasing" },
  customerType: { create: "sales" },
  customerStatus: { create: "sales" }
};
/**
 * Create name-only lookup values for a CSV import: supplier types, customer
 * types, customer statuses.
 *
 * @remarks
 * Needs `create` on the module that owns the lookup. A name that already
 * exists is matched case-insensitively and returned instead of created, and
 * case variants within the batch become one value. `results` answers every
 * name, in order: the value's id and name, or an error.
 */
export const createImportLookups = defineServiceFn({
  input: z.object({
    lookup: z.enum(creatableLookups),
    names: z.array(z.string().trim().min(1)).min(1).max(100)
  }),
  permission: { by: "lookup", rules: lookupRules },

  async run(ctx, { lookup, names }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    // All three tables share the same name-only shape, unique on
    // (name, companyId): one read, one bulk insert.
    const existing = await client
      .from(lookup)
      .select("id, name")
      .eq("companyId", companyId);
    if (existing.error) {
      return ctx.error("internal", "Failed to read the values", existing.error);
    }

    const rowByName = new Map(
      existing.data.map((row) => [service.normalizeLookupName(row.name), row])
    );
    const missing = [
      ...new Map(
        names
          .filter((name) => !rowByName.has(service.normalizeLookupName(name)))
          .map((name) => [service.normalizeLookupName(name), name])
      ).values()
    ];

    if (missing.length > 0) {
      const inserted = await client
        .from(lookup)
        .insert(
          missing.map((name) => ({
            name,
            companyId,
            createdBy: ctx.auditUserId
          }))
        )
        .select("id, name");
      if (inserted.error) {
        return ctx.error(
          "internal",
          "Failed to create the values",
          inserted.error
        );
      }
      for (const row of inserted.data) {
        rowByName.set(service.normalizeLookupName(row.name), row);
      }
    }

    return {
      results: names.map((name) => {
        const row = rowByName.get(service.normalizeLookupName(name));
        return row
          ? { id: row.id, name: row.name }
          : { name, error: "Could not create value" };
      })
    };
  }
});

/**
 * Enroll the company in the Implementation Hub, and tell its admins.
 *
 * @remarks
 * Self-serve: anyone who can update company settings may enroll their own
 * company. A company that is already enrolled is left as it is (`enrolled`
 * is false). Every active Admin employee with an email is sent "Your
 * Implementation Hub is ready"; a failed email is logged and never fails the
 * enrollment.
 *
 * @mcp
 */
export const enrollImplementationHub = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },

  async run(ctx) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    // A double submit or a stale tab: it is enrolled already.
    const existing = await getImplementationHub(serviceRole, companyId);
    if (existing.data) return { enrolled: false };

    const enrolled = await enrollImplementation(serviceRole, {
      companyId,
      userId: ctx.auditUserId,
      tier: "self_serve"
    });
    if (enrolled.error) {
      return ctx.error("internal", "Failed to enroll company", enrolled.error);
    }

    await service.notifyImplementationHubAdmins(ctx);
    return { enrolled: true };
  }
});
/**
 * Open an issue from Slack's Create Issue form, with its Slack thread.
 *
 * @remarks
 * For the Slack integration's signed requests only: the company is the one
 * the Slack workspace is connected to. The Slack user is matched to a Carbon
 * user by email, and the issue is created as them at their default location
 * (the company's first location when they have none). Its action tasks are
 * created, and a thread for it is posted in the integration's channel; a
 * failure of either is logged and does not fail the issue.
 */
export const createIssueFromSlack = defineServiceFn({
  input: z.object({
    slackUserId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    nonConformanceTypeId: z.string(),
    nonConformanceWorkflowId: z.string().optional(),
    priority: z.enum(nonConformancePriority)
  }),
  permission: "system",

  async run(ctx, input) {
    const serviceRole = ctx.asSystem.supabase;
    const companyId = ctx.company.id;

    const integration = await serviceRole
      .from("companyIntegration")
      .select("metadata, secretRef")
      .eq("id", "slack")
      .eq("companyId", companyId)
      .maybeSingle();
    if (integration.error || !integration.data) {
      return ctx.error(
        "notFound",
        "Slack integration not found for this workspace.",
        integration.error
      );
    }

    // The configured channel, not the one the form was opened from.
    const channelId = (integration.data.metadata as { channel_id?: string })
      ?.channel_id;
    if (!channelId) {
      return ctx.error("rule", "No channel configured for Slack integration");
    }

    const secrets = (await resolveIntegrationSecrets(
      serviceRole,
      companyId,
      "slack",
      integration.data.metadata,
      integration.data.secretRef
    )) as { access_token?: string };
    const slackToken = secrets.access_token;
    if (!slackToken) {
      return ctx.error(
        "rule",
        "Slack token not found. Please reconfigure the integration."
      );
    }

    const employee = await getCarbonEmployeeFromSlackId(
      serviceRole,
      slackToken,
      input.slackUserId,
      companyId
    );
    if (employee.error || !employee.data) {
      return ctx.error("internal", "Failed to get employee", employee.error);
    }
    const userId = employee.data.id;

    const created = await insertIssue(serviceRole, {
      companyId,
      createdBy: userId,
      description: input.description,
      locationId: employee.data.locationId || "",
      name: input.title,
      nonConformanceTypeId: input.nonConformanceTypeId,
      nonConformanceWorkflowId: input.nonConformanceWorkflowId,
      openDate: datetime.timestamp(),
      priority: input.priority,
      source: "Internal"
    });
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to create issue", created.error);
    }
    const issueId = created.data.id;

    const [thread, tasks] = await Promise.all([
      createIssueSlackThread(
        serviceRole,
        {
          carbonUrl: `${ERP_URL}${path.to.issue(issueId)}`,
          companyId,
          description: input.description,
          id: issueId,
          nonConformanceId: created.data.nonConformanceId,
          severity: input.priority,
          title: input.title,
          userId
        },
        { slackToken, slackUserId: input.slackUserId, channelId }
      ),
      invokeCreate(
        { db: ctx.asSystem.pg, companyId, userId },
        { type: "nonConformanceTasks", id: issueId }
      )
    ]);
    if (tasks.error) {
      logger.error("Error creating tasks", { error: tasks.error });
    }
    if (thread.error) {
      logger.error("Error creating thread", { error: thread.error });
    }

    return { issueId };
  }
});

/**
 * Start Stripe Connect onboarding: the URL of Stripe's onboarding page.
 *
 * @remarks
 * Uses the company's Connect account, or creates one for the caller's email.
 * When Stripe no longer recognises the stored account (deleted, or its
 * access revoked) a new one is created and used instead. The account is
 * recorded on the company's `stripe-connect` integration, active and marked
 * as onboarding started; without that record the callback cannot finish.
 * Stripe sends the browser back to `origin`'s callback. A Stripe account
 * that is not set up as a Connect platform comes back as `unavailable`.
 */
export const startStripeConnectOnboarding = defineServiceFn({
  input: z.object({ origin: z.url() }),
  permission: { update: "settings" },

  async run(ctx, { origin }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const returnUrl = `${origin}/api/integrations/stripe-connect/callback?status=success`;
    const refreshUrl = `${origin}/api/integrations/stripe-connect/callback?status=refresh`;

    const user = await ctx.asSystem.supabase
      .from("user")
      .select("email")
      .eq("id", ctx.auditUserId)
      .single();
    if (user.error || !user.data?.email) {
      return ctx.error("internal", "Failed to read your email", user.error);
    }
    const email = user.data.email;

    try {
      let stripeAccountId = await getOrCreateConnectAccount(
        client,
        companyId,
        email
      );

      let redirectUrl: string;
      try {
        redirectUrl = await createConnectAccountLink(
          stripeAccountId,
          returnUrl,
          refreshUrl
        );
      } catch (linkError) {
        if (!isStaleConnectAccountError(linkError)) throw linkError;
        logger.warn(
          "Stripe Connect account link failed against the stored account; creating a new account",
          { companyId, stripeAccountId, error: linkError }
        );
        stripeAccountId = await getOrCreateConnectAccount(
          client,
          companyId,
          email,
          { forceNew: true }
        );
        redirectUrl = await createConnectAccountLink(
          stripeAccountId,
          returnUrl,
          refreshUrl
        );
      }

      const existing = await client
        .from("companyIntegration")
        .select("metadata")
        .eq("id", "stripe-connect")
        .eq("companyId", companyId)
        .maybeSingle();
      const saved = await client.from("companyIntegration").upsert({
        id: "stripe-connect",
        companyId,
        active: true,
        metadata: {
          ...(existing.data?.metadata as Record<string, unknown> | undefined),
          stripeAccountId,
          onboardingStarted: true
        }
      });
      if (saved.error) {
        // Without the account id the callback fails with "No Stripe Connect
        // account found", after onboarding against an unrecorded account.
        return ctx.error(
          "internal",
          `Failed to save Stripe Connect account id: ${saved.error.message}`,
          saved.error
        );
      }

      return { redirectUrl };
    } catch (error) {
      const stripeError = error as {
        message?: string;
        code?: string;
        raw?: { code?: string };
      };
      const message =
        stripeError.message || "Failed to initiate Stripe Connect onboarding";
      // Stripe's code for "your own account is not a Connect platform": an
      // administrator has to fix the platform, so a retry never helps.
      if (
        (stripeError.code ?? stripeError.raw?.code) ===
        "platform_account_required"
      ) {
        return ctx.error("unavailable", message, error);
      }
      return ctx.error("internal", message, error);
    }
  }
});

const actionTaskEntityTypes = Object.keys(actionTaskEntities) as [
  ActionTaskEntityType,
  ...ActionTaskEntityType[]
];

// An issue's tasks are quality's, a change notice's are parts'.
const actionTaskRule = {
  by: "entityType",
  rules: {
    nonConformanceActionTask: actionTaskPermissions("nonConformanceActionTask"),
    changeOrderActionTask: actionTaskPermissions("changeOrderActionTask")
  }
} as const;

const actionTaskInput = {
  entityType: z.enum(actionTaskEntityTypes),
  actionId: z.string().min(1)
};
/**
 * Create a Jira issue for an action task, and link the two.
 *
 * @remarks
 * The task's notes become the issue's description, else `description`
 * (Tiptap JSON or plain text). A change notice's task is refused once the
 * notice's workflow is locked. The Jira issue gets a link back to the task's
 * issue or change notice in Carbon.
 */
export const createJiraIssue = defineServiceFn({
  input: z.object({
    ...actionTaskInput,
    projectKey: z.string().min(1),
    issueTypeId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional()
  }),
  permission: actionTaskRule,

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { entityType, actionId } = input;
    const jira = getJiraClient();

    const [task, siteUrl] = await Promise.all([
      service.editableActionTask(ctx, entityType, actionId),
      jira.getSiteUrl(companyId)
    ]);
    if (task instanceof CarbonError) return task;

    let description: ReturnType<typeof tiptapToAdf> | undefined;
    if (task.notes && typeof task.notes === "object") {
      try {
        description = tiptapToAdf(task.notes as TiptapDocument);
      } catch (error) {
        logger.error("Failed to convert notes to ADF", { error });
      }
    }
    if (!description && input.description) {
      try {
        description = tiptapToAdf(JSON.parse(input.description));
      } catch {
        description = {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: input.description }]
            }
          ]
        } as ReturnType<typeof tiptapToAdf>;
      }
    }

    const issue = await jira.createIssue(companyId, {
      projectKey: input.projectKey,
      issueTypeId: input.issueTypeId,
      summary: input.title,
      description,
      assigneeId: input.assignee || undefined
    });
    if (!issue) return ctx.error("internal", "Failed to create Jira issue");

    const linked = await linkActionToJiraIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId, issue, siteUrl }
    );
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await jira.createRemoteLink(
      companyId,
      issue.id,
      service.actionTaskUrl(linked.data, entityType),
      `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    );
    return { issueId: issue.id };
  }
});

/**
 * Link an action task to an existing Jira issue.
 *
 * @remarks
 * The issue's assignee becomes the task's when a Carbon user has their
 * email. A change notice's task is refused once the notice's workflow is
 * locked. The task's notes replace the issue's description (best effort),
 * and the Jira issue gets a link back to Carbon.
 */
export const linkJiraIssue = defineServiceFn({
  input: z.object({ ...actionTaskInput, issueId: z.string().min(1) }),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId, issueId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const jira = getJiraClient();

    const [task, issue, siteUrl] = await Promise.all([
      service.editableActionTask(ctx, entityType, actionId),
      jira.getIssue(companyId, issueId),
      jira.getSiteUrl(companyId)
    ]);
    if (task instanceof CarbonError) return task;
    if (!issue) return ctx.error("notFound", "Issue not found");

    const email = issue.fields.assignee?.emailAddress ?? "";
    let assignee: string | null = null;
    if (email) {
      const user = await client
        .from("user")
        .select("id")
        .eq("email", email)
        .single();
      assignee = user.data?.id ?? null;
    }

    const linked = await linkActionToJiraIssue(client, companyId, {
      entityType,
      actionId,
      issue,
      siteUrl,
      assignee
    });
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    if (task.notes && typeof task.notes === "object") {
      try {
        await jira.updateIssue(companyId, issue.id, {
          description: tiptapToAdf(task.notes as TiptapDocument)
        });
      } catch (error) {
        logger.error("Failed to update Jira issue description", { error });
      }
    }

    await jira.createRemoteLink(
      companyId,
      issue.id,
      service.actionTaskUrl(linked.data, entityType),
      `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    );
    return { issueId: issue.id };
  }
});

/**
 * Unlink an action task from its Jira issue.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The link back to Carbon is then removed from the Jira issue (best effort).
 */
export const unlinkJiraIssue = defineServiceFn({
  input: z.object(actionTaskInput),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    if (entityType === "changeOrderActionTask") {
      const task = await service.editableActionTask(ctx, entityType, actionId);
      if (task instanceof CarbonError) return task;
    }

    const mapping = await getJiraIssueFromExternalId(
      client,
      companyId,
      actionId,
      entityType
    );
    const unlinked = await unlinkActionFromJiraIssue(client, companyId, {
      entityType,
      actionId
    });
    if (unlinked.error) {
      return ctx.error("internal", "Failed to unlink issue", unlinked.error);
    }

    if (mapping) {
      try {
        const jira = getJiraClient();
        const remoteLinks = await jira.getRemoteLinks(companyId, mapping.id);
        const carbonLink = remoteLinks.find(
          (link) =>
            link.application?.name === "Carbon" ||
            link.globalId.startsWith("carbon-")
        );
        if (carbonLink) {
          await jira.deleteRemoteLink(
            companyId,
            mapping.id,
            carbonLink.globalId
          );
        }
      } catch (error) {
        logger.error("Failed to clean up Jira remote link", { error });
      }
    }
    return { actionId };
  }
});

/**
 * Create a Linear issue for an action task, and link the two.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The Linear issue gets an attachment linking back to the task's issue or
 * change notice in Carbon.
 */
export const createLinearIssue = defineServiceFn({
  input: z.object({
    ...actionTaskInput,
    teamId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    assignee: z.string().optional()
  }),
  permission: actionTaskRule,

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const { entityType, actionId } = input;
    const linear = getLinearClient();

    const task = await service.editableActionTask(ctx, entityType, actionId);
    if (task instanceof CarbonError) return task;

    const issue = await linear.createIssue(companyId, {
      teamId: input.teamId,
      title: input.title,
      description: input.description || undefined,
      assigneeId: input.assignee || null
    });
    if (!issue) return ctx.error("internal", "Failed to create Linear issue");

    const linked = await linkActionToLinearIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId, issue }
    );
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id,
      url: service.actionTaskUrl(linked.data, entityType),
      title: `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    });
    return { issueId: issue.id };
  }
});

/**
 * Link an action task to an existing Linear issue.
 *
 * @remarks
 * The issue's assignee becomes the task's when a Carbon user has their
 * email. A change notice's task is refused once the notice's workflow is
 * locked. The Linear issue gets an attachment linking back to Carbon.
 */
export const linkLinearIssue = defineServiceFn({
  input: z.object({ ...actionTaskInput, issueId: z.string().min(1) }),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId, issueId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const linear = getLinearClient();

    const [task, issue] = await Promise.all([
      service.editableActionTask(ctx, entityType, actionId),
      linear.getIssueById(companyId, issueId)
    ]);
    if (task instanceof CarbonError) return task;
    if (!issue) return ctx.error("notFound", "Issue not found");

    const email = issue.assignee?.email ?? "";
    let assignee: string | null = null;
    if (email) {
      const user = await client
        .from("user")
        .select("id")
        .eq("email", email)
        .single();
      assignee = user.data?.id ?? null;
    }

    const linked = await linkActionToLinearIssue(client, companyId, {
      entityType,
      actionId,
      issue,
      assignee
    });
    if (!linked || linked.data?.length === 0) {
      return ctx.error("internal", "Failed to link issue");
    }

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id as string,
      url: service.actionTaskUrl(linked.data, entityType),
      title: `Linked Carbon Issue: ${task.parentReadableId ?? ""}`
    });
    return { issueId: issue.id as string };
  }
});

/**
 * Unlink an action task from its Linear issue.
 *
 * @remarks
 * A change notice's task is refused once the notice's workflow is locked.
 * The attachment linking back to Carbon is then removed from the Linear
 * issue (best effort).
 */
export const unlinkLinearIssue = defineServiceFn({
  input: z.object(actionTaskInput),
  permission: actionTaskRule,

  async run(ctx, { entityType, actionId }) {
    const companyId = ctx.company.id;
    if (entityType === "changeOrderActionTask") {
      const task = await service.editableActionTask(ctx, entityType, actionId);
      if (task instanceof CarbonError) return task;
    }

    const unlinked = await unlinkActionFromLinearIssue(
      ctx.asCaller.supabase,
      companyId,
      { entityType, actionId }
    );
    if (unlinked.error) {
      return ctx.error("internal", "Failed to unlink issue", unlinked.error);
    }

    try {
      const parentId = actionTaskParentId(unlinked.data, entityType);
      if (parentId) {
        const linear = getLinearClient();
        const [found] = await linear.listAttachments(companyId, parentId);
        if (found) await linear.removeAttachment(companyId, found.id);
      }
    } catch (error) {
      logger.error("Failed to clean up Linear attachment", { error });
    }
    return { actionId };
  }
});
/**
 * Delete saved view
 *
 * @mcp destructive
 */
export const deleteSavedView = defineServiceFn({
  input: z.looseObject({ viewId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteSavedView(
        ctx.asCaller.supabase,
        input.viewId as never
      )
    );
  }
});

/**
 * Get base64 image from supabase
 *
 * @mcp read
 */
export const getBase64ImageFromSupabase = defineServiceFn({
  input: z.looseObject({ path: z.string() }),
  permission: {},
  async run(ctx, input) {
    return await service.getBase64ImageFromSupabase(
      ctx.asCaller.supabase,
      input.path as never
    );
  }
});

/**
 * Get countries
 *
 * @mcp read
 */
export const getCountries = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: {},
  async run(ctx) {
    return unwrap(ctx, await service.getCountries(ctx.asCaller.supabase));
  }
});

/**
 * The item's CAD model in the same shape the line views expose it, so it drops straight into `<CadModel modelUpload={...} />`
 *
 * @mcp read
 */
export const getModelByItemId = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return await service.getModelByItemId(
      ctx.asCaller.supabase,
      input.itemId as never
    );
  }
});

/**
 * Get notes
 *
 * @mcp read
 */
export const getNotes = defineServiceFn({
  input: z.looseObject({ documentId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getNotes(ctx.asCaller.supabase, input.documentId as never)
    );
  }
});

/**
 * Get tags list
 *
 * @mcp read
 */
export const getTagsList = defineServiceFn({
  input: z.looseObject({ table: z.string().nullable().optional() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTagsList(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.table as never
      )
    );
  }
});

/**
 * Insert note
 *
 * @mcp
 */
export const insertNote = defineServiceFn({
  input: z.looseObject({ note: z.string(), documentId: z.string() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertNote(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Insert tag
 *
 * @mcp
 */
export const insertTag = defineServiceFn({
  input: z.looseObject({
    createdAt: z.string().optional(),
    name: z.string(),
    table: z.string()
  }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.insertTag(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Get external link
 *
 * @mcp read
 */
export const getExternalLink = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getExternalLink(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get customer portals
 *
 * @mcp read
 */
export const getCustomerPortals = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: {},
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getCustomerPortals(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get customer portal
 *
 * @mcp read
 */
export const getCustomerPortal = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCustomerPortal(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Upsert saved view
 *
 * @mcp
 */
export const upsertSavedView = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    table: z.string(),
    type: z.enum(["Public", "Private"]),
    filters: z.array(z.string()).optional(),
    sorts: z.array(z.string()).optional(),
    columnPinning: z.record(z.string(), z.unknown()).optional(),
    columnVisibility: z.record(z.string(), z.unknown()).optional(),
    columnOrder: z.array(z.string()).optional()
  }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertSavedView(
        ctx.asCaller.supabase,
        // The view keeps its creator: an update stamps only who changed it.
        payload(ctx, input)
          .withUser()
          .for(input.id ? "update" : "create") as never
      )
    );
  }
});

/**
 * Reorder the caller's saved views.
 *
 * @remarks
 * All or nothing: an id that is not one of the caller's views in the company
 * refuses the whole reorder.
 *
 * @mcp
 */
export const updateSavedViewOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(
      z.looseObject({ id: z.string(), sortOrder: z.number().int() })
    )
  }),
  permission: {},
  async run(ctx, { updates }) {
    try {
      await service.reorderSavedViews(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        updates
      );
    } catch (err) {
      return err instanceof NotFoundError
        ? ctx.error("notFound", err.message)
        : ctx.error("internal", "Failed to update the view order", err);
    }
    return { updated: updates.length };
  }
});

/**
 * Get enforcement rules
 *
 * @mcp read
 */
export const getEnforcementRules = defineServiceFn({
  input: z.looseObject({
    family: z.enum(["storage", "sales"]),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    targetType: z.enum(["item", "workCenter"]).nullable().optional()
  }),
  permission: {},
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getEnforcementRules(
        ctx.asCaller.supabase,
        input.family as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get enforcement rule
 *
 * @mcp read
 */
export const getEnforcementRule = defineServiceFn({
  input: z.looseObject({
    family: z.enum(["storage", "sales"]),
    id: z.string()
  }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEnforcementRule(
        ctx.asCaller.supabase,
        input.family as never,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Pin counts per rule id
 *
 * @mcp read
 */
export const getEnforcementRuleAssignmentCounts = defineServiceFn({
  input: z.looseObject({ ruleIds: z.array(z.string()) }),
  permission: {},
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getEnforcementRuleAssignmentCounts(
        ctx.asCaller.supabase,
        payload(ctx, input.ruleIds).build() as never
      )
    );
  }
});
