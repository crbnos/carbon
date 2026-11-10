// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getAppUrl } from "@carbon/auth";
import type { Database, Json } from "@carbon/database";
import {
  completedAtForGroup,
  isProjectPlanLocked,
  type ProjectStateGroup,
  pickStateForGroup
} from "@carbon/database/project-plan";
import { TiptapText } from "@carbon/files/markdown";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getJiraClient } from "../jira/lib/client";
import { adfToTiptap } from "../jira/lib/richtext";
import { issueToMapping } from "../jira/lib/service";
import type { JiraIssue } from "../jira/lib/types";
import { mapJiraStatusToCarbonStatus } from "../jira/lib/utils";
import { getLinearClient } from "../linear/lib/client";
import { getCompanyEmployees } from "../linear/lib/service";
import { type LinearIssue, LinearIssueSchema } from "../linear/lib/types";
import { mapLinearStatusToCarbonStatus } from "../linear/lib/utils";
import { resolveInboundAssignee } from "./assignee";
import {
  carbonValues,
  jiraValues,
  linearValues,
  type SyncedRow
} from "./canonical";
import {
  changedInbound,
  changedOutbound,
  firstSyncInbound,
  firstSyncOutbound,
  nextSync
} from "./diff";
import { isSyncedEntityType, syncedEntities } from "./entities";
import { type LockContext, lockedFields } from "./locks";
import {
  jiraCategoryToGroup,
  jiraToPriority,
  linearToPriority,
  linearTypeToGroup
} from "./maps";
import { ensureIssueSyncSubscriptions } from "./subscriptions";
import { pushToJira } from "./trackers/jira.server";
import { pushToLinear } from "./trackers/linear.server";
import {
  type FieldValues,
  type IssueTracker,
  type LinkSync,
  LinkSyncSchema,
  type SnapshotValue,
  type SyncedEntityType,
  type SyncedField
} from "./types";

const logger = getLogger("ee", "issue-sync");

type Client = SupabaseClient<Database>;

/** A link: one `externalIntegrationMapping` row joining a record to an issue. */
export type IssueLink = {
  entityType: string;
  entityId: string;
  integration: string;
  externalId: string | null;
  metadata: Json | null;
};

const LINK_COLUMNS = "entityType, entityId, integration, externalId, metadata";

const isTracker = (value: string): value is IssueTracker =>
  value === "linear" || value === "jira";

/** The sync snapshot on a link, or null for a link made before snapshots. */
export function readLinkSync(metadata: Json | null): LinkSync | null {
  const sync = (metadata as { sync?: unknown } | null)?.sync;
  if (!sync) return null;
  return LinkSyncSchema.safeParse(sync).data ?? null;
}

/** Every link of the given records, for both trackers, in one query. */
export async function readLinks(
  client: Client,
  companyId: string,
  type: SyncedEntityType,
  ids: string[]
): Promise<IssueLink[]> {
  if (ids.length === 0) return [];
  const result = await client
    .from("externalIntegrationMapping")
    .select(LINK_COLUMNS)
    .eq("companyId", companyId)
    .eq("entityType", type)
    .in("entityId", ids)
    .in("integration", ["linear", "jira"]);

  if (result.error) {
    throw new Error(`Failed to read issue links: ${result.error.message}`);
  }
  return result.data ?? [];
}

type LinkWrite = {
  companyId: string;
  entityType: SyncedEntityType;
  entityId: string;
  integration: IssueTracker;
  externalId: string;
  /** The issue as the dialogs show it (Linear issue / Jira mapping). */
  issue: Record<string, unknown>;
  sync: LinkSync | null;
};

const toLinkRow = (link: LinkWrite) => ({
  companyId: link.companyId,
  entityType: link.entityType,
  entityId: link.entityId,
  integration: link.integration,
  externalId: link.externalId,
  metadata: (link.sync
    ? { ...link.issue, sync: link.sync }
    : link.issue) as unknown as Json,
  lastSyncedAt: datetime.timestamp(),
  updatedAt: datetime.timestamp()
});

/**
 * Upsert links on (entityType, entityId, integration, companyId). The table
 * has no UPDATE policy, so `client` must be the service role.
 */
export async function writeLinks(client: Client, links: LinkWrite[]) {
  if (links.length === 0) return;
  const result = await client
    .from("externalIntegrationMapping")
    .upsert(links.map(toLinkRow), {
      onConflict: "entityType,entityId,integration,companyId"
    });
  if (result.error) {
    throw new Error(`Failed to write issue links: ${result.error.message}`);
  }
}

export async function writeLink(client: Client, link: LinkWrite) {
  await writeLinks(client, [link]);
}

/** The issue as a tracker returns it, plus its snapshot values and metadata. */
type FetchedIssue =
  | {
      tracker: "linear";
      issue: LinearIssue;
      remote: FieldValues;
      metadata: Record<string, unknown>;
    }
  | {
      tracker: "jira";
      issue: JiraIssue;
      remote: FieldValues;
      metadata: Record<string, unknown>;
    };

/** Read an issue from its tracker. Returns null when it cannot be read. */
export async function fetchIssue(
  companyId: string,
  tracker: IssueTracker,
  issueId: string
): Promise<FetchedIssue | null> {
  if (tracker === "linear") {
    const raw = await getLinearClient().getIssueById(companyId, issueId);
    const issue = LinearIssueSchema.safeParse(raw).data;
    if (!issue) return null;
    return {
      tracker,
      issue,
      remote: linearValues(issue),
      metadata: issue as unknown as Record<string, unknown>
    };
  }

  const jira = getJiraClient();
  const issue = await jira.getIssue(companyId, issueId);
  if (!issue) return null;
  const siteUrl = await jira.getSiteUrl(companyId);
  return {
    tracker,
    issue,
    remote: jiraValues(issue),
    metadata: issueToMapping(issue, siteUrl) as unknown as Record<
      string,
      unknown
    >
  };
}

async function readRows(
  client: Client,
  companyId: string,
  type: SyncedEntityType,
  ids: string[]
): Promise<Map<string, SyncedRow>> {
  const result = await client
    .from(syncedEntities[type].table)
    .select("*")
    .eq("companyId", companyId)
    .in("id", ids);
  if (result.error) {
    throw new Error(`Failed to read ${type} rows: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as unknown as SyncedRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** The lock context of each row, read in one query per parent table. */
async function readLockContexts(
  client: Client,
  companyId: string,
  type: SyncedEntityType,
  rows: SyncedRow[]
): Promise<Map<string, LockContext>> {
  const contexts = new Map<string, LockContext>();
  if (type === "changeOrderActionTask") {
    const ids = [...new Set(rows.map((row) => String(row.changeOrderId)))];
    const notices = await client
      .from("changeOrder")
      .select("id, status")
      .eq("companyId", companyId)
      .in("id", ids);
    // A lock that cannot be read must not open: fail the sync instead.
    if (notices.error) {
      throw new Error(
        `Failed to read change notices: ${notices.error.message}`
      );
    }
    const statusById = new Map(
      (notices.data ?? []).map((notice) => [notice.id, notice.status])
    );
    for (const row of rows) {
      contexts.set(row.id, {
        changeNoticeStatus: statusById.get(String(row.changeOrderId)) ?? null
      });
    }
  }

  if (type === "projectElement") {
    const projectIds = [...new Set(rows.map((row) => String(row.projectId)))];
    const projects = await client
      .from("project")
      .select("id, status, lockPlanAfterMilestoneId")
      .eq("companyId", companyId)
      .in("id", projectIds);
    if (projects.error) {
      throw new Error(`Failed to read projects: ${projects.error.message}`);
    }
    const milestoneIds = (projects.data ?? [])
      .map((project) => project.lockPlanAfterMilestoneId)
      .filter((id): id is string => !!id);
    const milestoneById = new Map<string, { completedAt: string | null }>();
    if (milestoneIds.length > 0) {
      const milestones = await client
        .from("projectMilestone")
        .select("id, completedAt")
        .eq("companyId", companyId)
        .in("id", milestoneIds);
      if (milestones.error) {
        throw new Error(
          `Failed to read milestones: ${milestones.error.message}`
        );
      }
      for (const milestone of milestones.data ?? []) {
        milestoneById.set(milestone.id, milestone);
      }
    }
    const projectById = new Map(
      (projects.data ?? []).map((project) => [project.id, project])
    );
    for (const row of rows) {
      const project = projectById.get(String(row.projectId));
      contexts.set(row.id, {
        projectStatus: project?.status ?? null,
        planLocked: isProjectPlanLocked({
          lockMilestone: project?.lockPlanAfterMilestoneId
            ? milestoneById.get(project.lockPlanAfterMilestoneId)
            : null
        })
      });
    }
  }

  return contexts;
}

type ElementState = {
  id: string;
  group: ProjectStateGroup;
  isDefault: boolean;
  sortOrder: number;
};

/**
 * The company's project states, for an element's status (its state's group).
 * Other record types need none.
 */
async function readStates(
  client: Client,
  companyId: string,
  type: SyncedEntityType
): Promise<{
  states: ElementState[];
  stateGroupById: Map<string, ProjectStateGroup>;
}> {
  if (type !== "projectElement") {
    return { states: [], stateGroupById: new Map() };
  }
  const result = await client
    .from("projectState")
    .select("id, group, isDefault, sortOrder")
    .eq("companyId", companyId);
  const states = (result.data ?? []) as ElementState[];
  return {
    states,
    stateGroupById: new Map(states.map((state) => [state.id, state.group]))
  };
}

/** The email of each assigned user, in one query. */
async function readUserEmails(
  client: Client,
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await client.from("user").select("id, email").in("id", userIds);
  return new Map((users.data ?? []).map((user) => [user.id, user.email]));
}

/** The trackers the company has installed and active. */
async function readActiveTrackers(
  client: Client,
  companyId: string
): Promise<Set<IssueTracker>> {
  const result = await client
    .from("companyIntegration")
    .select("id")
    .eq("companyId", companyId)
    .eq("active", true)
    .in("id", ["linear", "jira"]);
  return new Set((result.data ?? []).map((row) => row.id).filter(isTracker));
}

export type PushSummary = {
  pushed: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
};

/**
 * Push the changed fields of these records to their linked issues.
 *
 * The event is a hint; the CURRENT row is the truth. A field is pushed only
 * when the row differs from the snapshot's `carbon` value, so the event an
 * inbound write raises pushes nothing. `initial` ignores the snapshot (a
 * newly created issue takes every field).
 */
export async function pushRecords(
  client: Client,
  companyId: string,
  type: SyncedEntityType,
  ids: string[],
  opts: { initial?: boolean } = {}
): Promise<PushSummary> {
  const summary: PushSummary = { pushed: [], skipped: [], failed: [] };
  const active = await readActiveTrackers(client, companyId);
  const links = (await readLinks(client, companyId, type, ids)).filter(
    (link) => isTracker(link.integration) && active.has(link.integration)
  );
  if (links.length === 0) return summary;

  const entity = syncedEntities[type];
  const rowById = await readRows(client, companyId, type, [
    ...new Set(links.map((link) => link.entityId))
  ]);
  const { stateGroupById } = await readStates(client, companyId, type);
  const emails = await readUserEmails(client, [
    ...new Set(
      [...rowById.values()]
        .map((row) => row[entity.assigneeColumn])
        .filter((id): id is string => typeof id === "string")
    )
  ]);

  const writes: LinkWrite[] = [];

  for (const link of links) {
    const row = rowById.get(link.entityId);
    if (!row || !link.externalId || !isTracker(link.integration)) {
      summary.skipped.push({ id: link.entityId, reason: "no row or issue" });
      continue;
    }

    const sync = readLinkSync(link.metadata);
    const carbon = carbonValues(type, row, { stateGroupById });
    // A first sync (a new issue, or a link made before snapshots) has nothing
    // to compare with. It pushes only what Carbon has: an empty Carbon value
    // never overwrites the issue's (a picked assignee, a description).
    const firstSync = opts.initial || !sync;
    const changed = firstSync
      ? firstSyncOutbound(entity.fields, carbon)
      : changedOutbound(entity.fields, carbon, sync);
    if (changed.length === 0) {
      summary.skipped.push({ id: row.id, reason: "unchanged" });
      continue;
    }

    try {
      const assigneeId = row[entity.assigneeColumn];
      const assigneeEmail =
        typeof assigneeId === "string"
          ? (emails.get(assigneeId) ?? null)
          : null;

      const sent =
        link.integration === "linear"
          ? await pushToLinear({
              companyId,
              issueId: link.externalId,
              teamId: await linearTeamId(companyId, link),
              type,
              row,
              carbon,
              fields: changed,
              assigneeEmail
            })
          : await pushToJira({
              companyId,
              issueId: link.externalId,
              currentCategory:
                (
                  link.metadata as {
                    status?: { category?: string };
                  } | null
                )?.status?.category ?? null,
              type,
              row,
              carbon,
              fields: changed,
              assigneeEmail
            });

      if (sent.length === 0) {
        summary.failed.push({ id: row.id, error: "the tracker refused it" });
        continue;
      }

      // Read the issue back: the tracker may normalize what it stored (rich
      // text above all), and the snapshot must hold what it really has.
      const fetched = await fetchIssue(
        companyId,
        link.integration,
        link.externalId
      );
      if (!fetched) {
        summary.failed.push({ id: row.id, error: "could not read back" });
        continue;
      }

      const updates: Partial<Record<SyncedField, SnapshotValue>> = {};
      for (const field of sent) {
        updates[field] = {
          carbon: carbon[field] ?? null,
          remote: fetched.remote[field] ?? null
        };
      }

      writes.push({
        companyId,
        entityType: type,
        entityId: row.id,
        integration: link.integration,
        externalId: link.externalId,
        issue: fetched.metadata,
        sync: nextSync(sync, updates)
      });
      summary.pushed.push(row.id);
    } catch (error) {
      logger.error("Issue sync push failed", { error, id: row.id });
      summary.failed.push({
        id: row.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await writeLinks(client, writes);
  return summary;
}

/** A Linear issue's team, from the link, else read from Linear. */
async function linearTeamId(
  companyId: string,
  link: IssueLink
): Promise<string | null> {
  const stored = LinearIssueSchema.safeParse(link.metadata).data?.team?.id;
  if (stored) return stored;
  const issue = link.externalId
    ? await getLinearClient().getIssueById(companyId, link.externalId)
    : null;
  return issue?.team?.id ?? null;
}

/**
 * Remove the links of deleted records. Best-effort, it also removes the
 * Carbon back-link from each issue. It never deletes an issue.
 */
export async function deleteLinks(
  client: Client,
  companyId: string,
  type: SyncedEntityType,
  deleted: Array<{ id: string; old: Record<string, unknown> | null }>
): Promise<{ unlinked: string[] }> {
  const links = await readLinks(
    client,
    companyId,
    type,
    deleted.map((record) => record.id)
  );
  if (links.length === 0) return { unlinked: [] };

  const entity = syncedEntities[type];
  const oldById = new Map(deleted.map((record) => [record.id, record.old]));

  for (const link of links) {
    if (!link.externalId) continue;
    try {
      if (link.integration === "linear") {
        const parentId = String(
          oldById.get(link.entityId)?.[entity.parentColumn] ?? ""
        );
        await getLinearClient().removeIssueLink(
          companyId,
          link.externalId,
          getAppUrl() + entity.detailPath(parentId, link.entityId)
        );
      } else if (link.integration === "jira") {
        await removeJiraBackLink(companyId, link.externalId);
      }
    } catch (error) {
      logger.error("Failed to remove an issue back-link", { error });
    }
  }

  const result = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("entityType", type)
    .in(
      "entityId",
      links.map((link) => link.entityId)
    )
    .in("integration", ["linear", "jira"]);
  if (result.error) {
    throw new Error(`Failed to delete issue links: ${result.error.message}`);
  }

  return { unlinked: links.map((link) => link.entityId) };
}

/** Remove Carbon's remote link from a Jira issue (found as the unlink route finds it). */
export async function removeJiraBackLink(companyId: string, issueId: string) {
  const jira = getJiraClient();
  const remoteLinks = await jira.getRemoteLinks(companyId, issueId);
  const carbonLink = remoteLinks.find(
    (remote) =>
      remote.application?.name === "Carbon" ||
      remote.globalId.startsWith("carbon-")
  );
  if (carbonLink) {
    await jira.deleteRemoteLink(companyId, issueId, carbonLink.globalId);
  }
}

/** Delete the link of an issue that the tracker deleted. The record stays. */
export async function unlinkDeletedIssue(
  client: Client,
  args: { companyId: string; tracker: IssueTracker; issueId: string }
) {
  return client
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", args.companyId)
    .eq("integration", args.tracker)
    .eq("externalId", args.issueId);
}

export type ApplySummary =
  | { skipped: string }
  | { failed: string }
  | { applied: SyncedField[]; refused: SyncedField[] };

/**
 * Apply an issue's changes to its linked record.
 *
 * A field is applied only when the issue differs from the snapshot's `remote`
 * value, and only when no lock protects it. A protected field is refused:
 * the link stores the refusal and Carbon keeps its value. `initial` (linking
 * an existing issue) takes every field from the issue, except a description
 * when the record already has one: that one goes to the issue instead.
 */
export async function applyIssue(
  client: Client,
  args: {
    companyId: string;
    tracker: IssueTracker;
    issueId: string;
    initial?: boolean;
  }
): Promise<ApplySummary> {
  const { companyId, tracker, issueId } = args;

  const linkResult = await client
    .from("externalIntegrationMapping")
    .select(LINK_COLUMNS)
    .eq("companyId", companyId)
    .eq("integration", tracker)
    .eq("externalId", issueId)
    .order("createdAt")
    .limit(1)
    .maybeSingle();
  const link = linkResult.data;
  if (!link) return { skipped: "no link" };
  if (!isSyncedEntityType(link.entityType)) {
    return { skipped: "not a synced record" };
  }

  const type = link.entityType;
  const entity = syncedEntities[type];
  const fetched = await fetchIssue(companyId, tracker, issueId);
  if (!fetched) return { failed: "issue not found" };

  const rows = await readRows(client, companyId, type, [link.entityId]);
  const row = rows.get(link.entityId);
  if (!row) return { skipped: "no record" };

  const lockContext =
    (await readLockContexts(client, companyId, type, [row])).get(row.id) ?? {};
  const { states, stateGroupById } = await readStates(client, companyId, type);
  const sync = readLinkSync(link.metadata);

  // A first sync (linking an existing issue, or a link made before
  // snapshots) takes the issue's values, but never an empty one, and never
  // over a description Carbon already has: that one goes to the issue.
  const firstSync = args.initial || !sync;
  const carbonBefore = carbonValues(type, row, { stateGroupById });
  const changed = firstSync
    ? firstSyncInbound(entity.fields, fetched.remote, carbonBefore)
    : changedInbound(entity.fields, fetched.remote, sync);

  const lock = lockedFields(type, lockContext);
  const refusedFields = lock
    ? changed.filter((field) => lock.fields.includes(field))
    : [];
  const allowed = changed.filter((field) => !refusedFields.includes(field));

  const patch: Record<string, unknown> = {};
  for (const field of allowed) {
    switch (field) {
      case "status": {
        if (type !== "projectElement") {
          patch.status =
            fetched.tracker === "linear"
              ? mapLinearStatusToCarbonStatus(fetched.issue.state.type)
              : mapJiraStatusToCarbonStatus(
                  fetched.issue.fields.status.statusCategory.key
                );
          break;
        }
        // An element takes a state of the matching group: its own state
        // when that is already in the group, else the group's default.
        const currentGroup = stateGroupById.get(String(row.stateId)) ?? null;
        const group =
          fetched.tracker === "linear"
            ? linearTypeToGroup(fetched.issue.state.type)
            : jiraCategoryToGroup(
                fetched.issue.fields.status.statusCategory.key,
                currentGroup
              );
        const stateId = pickStateForGroup(states, group, String(row.stateId));
        if (stateId && stateId !== row.stateId) {
          patch.stateId = stateId;
          patch.completedAt = completedAtForGroup(group, datetime.timestamp());
        }
        break;
      }
      case "title":
        patch.name =
          fetched.tracker === "linear"
            ? fetched.issue.title
            : fetched.issue.fields.summary;
        break;
      case "priority": {
        const priority =
          fetched.tracker === "linear"
            ? linearToPriority(fetched.issue.priority)
            : jiraToPriority(fetched.issue.fields.priority?.name);
        if (priority) patch.priority = priority;
        break;
      }
      case "assignee": {
        const email =
          fetched.tracker === "linear"
            ? (fetched.issue.assignee?.email ?? null)
            : (fetched.issue.fields.assignee?.emailAddress ?? null);
        const hasAssignee =
          fetched.tracker === "linear"
            ? !!fetched.issue.assignee
            : !!fetched.issue.fields.assignee;
        const employees = email
          ? await getCompanyEmployees(client, companyId, [email])
          : [];
        const assignee = resolveInboundAssignee({
          issueHasAssignee: hasAssignee,
          matchedUserId: employees[0]?.userId
        });
        if (assignee !== undefined) patch[entity.assigneeColumn] = assignee;
        break;
      }
      case "dueDate":
        patch[entity.dueDateColumn] = fetched.remote.dueDate ?? null;
        break;
      case "description":
        patch[entity.textColumn] =
          fetched.tracker === "linear"
            ? TiptapText(fetched.issue.description).toDocument()
            : adfToTiptap(fetched.issue.fields.description);
        break;
      default:
        break;
    }
  }

  if (Object.keys(patch).length > 0) {
    const update = await client
      .from(entity.table)
      .update(patch as never)
      .eq("companyId", companyId)
      .eq("id", row.id);
    if (update.error) return { failed: update.error.message };
  }

  const after = carbonValues(type, { ...row, ...patch }, { stateGroupById });
  const updates: Partial<Record<SyncedField, SnapshotValue>> = {};
  for (const field of allowed) {
    updates[field] = {
      carbon: after[field] ?? null,
      remote: fetched.remote[field] ?? null
    };
  }

  const refused =
    refusedFields.length > 0 && lock
      ? { at: datetime.timestamp(), fields: refusedFields, reason: lock.reason }
      : null;

  await writeLink(client, {
    companyId,
    entityType: type,
    entityId: row.id,
    integration: tracker,
    externalId: issueId,
    issue: fetched.metadata,
    sync: nextSync(sync, updates, refused)
  });

  return { applied: allowed, refused: refusedFields };
}

type LinkArgs = {
  companyId: string;
  tracker: IssueTracker;
  entityType: SyncedEntityType;
  entityId: string;
  /** The issue id or key the user picked. */
  issueId: string;
};

/**
 * Refuse an issue that already links to another record: the inbound sync
 * finds a link by the issue id, so one issue can drive only one record.
 */
async function issueLinkedElsewhere(
  client: Client,
  args: LinkArgs & { externalId: string }
): Promise<boolean> {
  const existing = await client
    .from("externalIntegrationMapping")
    .select("entityType, entityId")
    .eq("companyId", args.companyId)
    .eq("integration", args.tracker)
    .eq("externalId", args.externalId);
  return (existing.data ?? []).some(
    (row) =>
      row.entityType !== args.entityType || row.entityId !== args.entityId
  );
}

/**
 * Link an existing issue to a record. The record takes the issue's fields
 * first (a pull), except a description it already has; then that
 * description goes to the issue (a push). `client` must be the service role.
 */
export async function linkExistingIssue(
  client: Client,
  args: LinkArgs
): Promise<{ error: string } | { issue: Record<string, unknown> }> {
  const fetched = await fetchIssue(args.companyId, args.tracker, args.issueId);
  if (!fetched) return { error: "Issue not found" };

  const externalId = fetched.issue.id;
  if (await issueLinkedElsewhere(client, { ...args, externalId })) {
    return { error: "This issue is already linked to another record" };
  }

  await writeLink(client, {
    companyId: args.companyId,
    entityType: args.entityType,
    entityId: args.entityId,
    integration: args.tracker,
    externalId,
    issue: fetched.metadata,
    sync: null
  });

  const applied = await applyIssue(client, {
    companyId: args.companyId,
    tracker: args.tracker,
    issueId: externalId,
    initial: true
  });
  if ("failed" in applied) return { error: applied.failed };

  await ensureIssueSyncSubscriptions(client, args.companyId, args.tracker);

  // The caller sends `carbon/issue-sync.push` for the record: the push runs
  // under the per-company concurrency key, so the webhook it raises cannot
  // overtake the snapshot it writes.
  return { issue: fetched.metadata };
}

/**
 * Link a newly created issue to the record it was created from. The issue
 * takes every field of the record (a push). `client` must be the service role.
 */
export async function linkNewIssue(
  client: Client,
  args: LinkArgs
): Promise<{ error: string } | { issue: Record<string, unknown> }> {
  const fetched = await fetchIssue(args.companyId, args.tracker, args.issueId);
  if (!fetched) return { error: "Issue not found" };

  await writeLink(client, {
    companyId: args.companyId,
    entityType: args.entityType,
    entityId: args.entityId,
    integration: args.tracker,
    externalId: fetched.issue.id,
    issue: fetched.metadata,
    sync: null
  });

  await ensureIssueSyncSubscriptions(client, args.companyId, args.tracker);

  // The caller sends `carbon/issue-sync.push` with `initial`, so the first
  // push runs under the per-company concurrency key.
  return { issue: fetched.metadata };
}
