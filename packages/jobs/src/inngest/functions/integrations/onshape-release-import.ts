import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { OnshapeReleasePackage } from "@carbon/ee/onshape";
import {
  buildOnshapeItemNotesBlock,
  getOnshapeClient,
  readReleasePackageName,
  readReleasePackageNotes,
  writeOnshapeItemNotes
} from "@carbon/ee/onshape";
import { datetime, textToTiptap } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RetryAfterError } from "inngest";
import { z } from "zod";
import { getWorkflowDispatch } from "../../../workflows/actions/dispatcher";
import { inngest } from "../../client";
import {
  resolveOnshapeCompanyId,
  withRateLimitRetry
} from "./onshape-backfill";
import { selectReleaseTarget } from "./onshape-matching";

// Release import: an Onshape release becomes ENGINEERING DATA in Carbon, not
// just attached files. Two modes, chosen per company in
// Settings → Integrations → Onshape:
//
//   releaseImportMode = "changeNotice"  (default)
//     One Draft change notice per release package, with one affected item per
//     released element, pre-populated with Onshape's revision letter, name and
//     description. A human drives it through the normal
//     Draft → Start → Engineering Complete → Implementation → Done flow.
//
//   releaseImportMode = "revision"
//     Create the new revision immediately via the same `createRevision` the
//     manual "New Revision" button uses. No review step, no change notice.
//
// Deliberately NOT auto-applying a change notice: `applyChangeNotice` drives
// four status transitions into a terminal `Done`, is not one transaction, and
// `itemSupersession`'s primary key is ("itemId") alone — so a second release on
// the same predecessor silently overwrites the first's successor pointer. Direct
// revision creation has none of those properties: it is additive, writes no
// supersession, and is reversible by deactivating the item.
//
// There is no release-level Onshape event: a 9-element release arrives as 9
// separate onshape.revision.created deliveries, in nondeterministic order, with
// no "release complete" signal. `releaseId` is therefore the grouping key, and a
// marker row in `externalIntegrationMapping` is the claim: the first element to
// insert it creates the notice, every sibling appends to the notice it names.
// Serialisation comes from `concurrency: { key: "event.data.releaseId" }`.

type CarbonClient = SupabaseClient<Database>;

const MARKER_ENTITY_TYPE = "onshapeRelease";
const MARKER_INTEGRATION = "onshape";
const UNIQUE_VIOLATION = "23505";

export type OnshapeReleaseImportSkipReason =
  | "disabled"
  | "drawing-element"
  | "revision-not-found"
  | "no-matching-item"
  | "revision-already-imported"
  | "no-dispatcher";

export interface OnshapeReleaseImportResult {
  imported: boolean;
  mode?: "changeNotice" | "revision";
  skippedReason?: OnshapeReleaseImportSkipReason;
  changeNoticeId?: string;
  itemId?: string;
  newItemId?: string;
  revision?: string;
  /** Prior open change notices already touching this item — permit-and-warn parity with the UI. */
  openNoticeCollisions?: OpenNotice[];
}

interface OpenNotice {
  id: string;
  readableId: string;
  status: string;
}

// Mirrors `changeNoticeOpenStatuses` (apps/erp items.models.ts). packages/jobs
// cannot import ~/modules, so the list is duplicated deliberately — keep in sync.
const CHANGE_NOTICE_OPEN_STATUSES = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation"
] as const;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return JSON.stringify(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Unwrap the TWO error layers a dispatched service call has. `result.success`
 * only says the dispatch itself worked; the Supabase envelope inside carries its
 * own error, and treating a failed write as success would poison the release's
 * idempotency marker so it could never be retried.
 */
function unwrapDispatch(
  functionName: string,
  result: { success: boolean; data?: unknown; error?: unknown }
): { ok: true; data: unknown } | { ok: false; error: unknown } {
  if (!result.success) {
    return { ok: false, error: result.error ?? `${functionName} failed` };
  }
  const envelope = isRecord(result.data) ? result.data : undefined;
  if (envelope?.error !== undefined && envelope.error !== null) {
    return { ok: false, error: envelope.error };
  }
  return {
    ok: true,
    data: envelope && "data" in envelope ? envelope.data : result.data
  };
}

/** Shared gate: run only when the integration is active AND release import is on. */
export async function getOnshapeReleaseImportSettings(
  carbon: CarbonClient,
  companyId: string
): Promise<{ enabled: boolean; mode: "changeNotice" | "revision" }> {
  const integration = await carbon
    .from("companyIntegration")
    .select("active, metadata")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();
  const metadata = (integration.data?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  return {
    enabled:
      Boolean(integration.data?.active) &&
      metadata.releaseImportEnabled === true,
    // Anything other than the explicit opt-out falls back to the reviewable path.
    mode:
      metadata.releaseImportMode === "revision" ? "revision" : "changeNotice"
  };
}

/**
 * Prior OPEN change notices already naming this item.
 *
 * Queries notice STATUS rather than scanning for `active:false` items with a
 * `changeOrderId`: `item.changeOrderId` survives release permanently, and
 * cancelling a notice is a bare status flip with no cleanup, so the item-row
 * shape reports cancelled and released notices as in-flight forever.
 */
async function findOpenNoticesForItem(
  carbon: CarbonClient,
  args: { itemId: string; companyId: string }
): Promise<OpenNotice[]> {
  // NB: changeOrderAffectedItem."changeOrderId" is the FK to changeOrder."id",
  // while changeOrder."changeOrderId" is the HUMAN-READABLE number. Same column
  // name, different meaning — do not cross them.
  const affected = await carbon
    .from("changeOrderAffectedItem")
    .select("changeOrderId")
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId);
  if (affected.error) {
    throw new Error(
      `onshape-release-import: affected-item lookup failed: ${affected.error.message}`
    );
  }

  const noticeIds = [
    ...new Set((affected.data ?? []).map((row) => row.changeOrderId))
  ];
  if (noticeIds.length === 0) return [];

  const notices = await carbon
    .from("changeOrder")
    .select("id, changeOrderId, status")
    .in("id", noticeIds)
    .eq("companyId", args.companyId)
    .in("status", CHANGE_NOTICE_OPEN_STATUSES);
  if (notices.error) {
    throw new Error(
      `onshape-release-import: open-notice lookup failed: ${notices.error.message}`
    );
  }

  return (notices.data ?? []).map((notice) => ({
    id: notice.id,
    readableId: notice.changeOrderId,
    status: notice.status
  }));
}

/**
 * Which Carbon item a released Onshape element maps to.
 *
 * Mirrors the sibling-selection Phase 1 established for the BOM route: the
 * latest existing revision of the same `readableId`, preferring NAMED revisions
 * over the initial `'0'`/empty one, newest first. Every query carries
 * `companyId` by hand — these jobs run on the service role, so RLS gives no
 * tenancy backstop.
 */
async function resolveReleaseTarget(
  carbon: CarbonClient,
  args: { companyId: string; partNumber: string; revision: string }
): Promise<
  | { kind: "already-imported" }
  | { kind: "not-found" }
  | {
      kind: "revision";
      item: Record<string, unknown> & { id: string; type: string };
    }
> {
  const siblings = await carbon
    .from("item")
    .select(
      "id, readableId, revision, readableIdWithRevision, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode, sourcingType, thumbnailPath, mpn, modelUploadId, active, companyId, createdAt"
    )
    .eq("companyId", args.companyId)
    .eq("readableId", args.partNumber);
  if (siblings.error) {
    throw new Error(
      `onshape-release-import: sibling lookup failed: ${siblings.error.message}`
    );
  }

  // Selection itself is a pure helper in onshape-matching.ts so its edge cases
  // (re-release, inactive draft siblings, the '0'/'' initial revision) are
  // unit-pinned rather than left to convention.
  const selected = selectReleaseTarget(siblings.data ?? [], args.revision);
  if (selected.kind !== "revision") return { kind: selected.kind };
  return { kind: "revision", item: selected.item as never };
}

/**
 * The released revision's LETTER and Onshape-side NAME.
 *
 * Resolved from the revisions API rather than the webhook payload, because the
 * payload carries no name and the name is what makes the resulting change notice
 * show a real diff instead of "No changes yet." Costs one Onshape call per
 * element — the same order the existing asset sync already spends, against the
 * same quota. Falls back to the payload's letter if the lookup finds nothing, so
 * a synthetic/replayed event still works without network access.
 */
async function resolveReleasedRevision(
  carbon: CarbonClient,
  payload: OnshapeReleaseImportInput
): Promise<{ revision: string; name?: string } | null> {
  const payloadRevision = payload.revision?.trim();

  try {
    const onshape = await getOnshapeClient(
      carbon,
      payload.companyId,
      payload.userId
    );
    if (onshape.error || !onshape.client) {
      throw new Error(
        `getOnshapeClient failed: ${onshape.error ?? "no client"}`
      );
    }
    const client = onshape.client;

    const onshapeCompanyId =
      payload.onshapeCompanyId ??
      (await resolveOnshapeCompanyId(carbon, payload));

    const revisions = await withRateLimitRetry(
      () =>
        client.getRevisions(
          onshapeCompanyId,
          payload.partNumber,
          payload.elementType
        ),
      `revisions ${payload.partNumber}`
    );
    const list = revisions.items ?? [];
    // Prefer the revision whose version AND element match this event exactly;
    // fall back to a version match, mirroring onshape-revision-sync.
    const released =
      list.find(
        (revision) =>
          revision.versionId === payload.versionId &&
          revision.elementId === payload.elementId
      ) ?? list.find((revision) => revision.versionId === payload.versionId);

    if (released?.revision) {
      return { revision: released.revision, name: released.name ?? undefined };
    }
  } catch (lookupError) {
    // A rate limit must stay a rate limit — Inngest suspends and resumes on it.
    if (lookupError instanceof RetryAfterError) throw lookupError;
    // Otherwise: the webhook's own revision letter came from Onshape and is
    // authoritative, so a dead token or an Onshape outage should not lose the
    // release. We just import without the Onshape-side name.
    if (!payloadRevision) throw lookupError;
    console.warn(
      "onshape-release-import: revision lookup failed; using the letter from the webhook",
      {
        companyId: payload.companyId,
        partNumber: payload.partNumber,
        revision: payloadRevision,
        error: errorMessage(lookupError)
      }
    );
  }

  return payloadRevision ? { revision: payloadRevision } : null;
}

// --- marker row -------------------------------------------------------------
// `externalIntegrationMapping` has SELECT and INSERT policies only, no UPDATE
// (20260204001831). A PostgREST UPDATE from a user-scoped client matches zero
// rows and returns { data: [], error: null } — no error, no signal. Every marker
// mutation here therefore runs on the service role.

interface ReleaseMarker {
  id: string;
  changeNoticeId?: string;
  claimedByMessageId?: string;
  items: string[];
}

async function readReleaseMarker(
  carbon: CarbonClient,
  args: { releaseId: string; companyId: string }
): Promise<ReleaseMarker | null> {
  const existing = await carbon
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("entityType", MARKER_ENTITY_TYPE)
    .eq("entityId", args.releaseId)
    .eq("integration", MARKER_INTEGRATION)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `onshape-release-import: marker read failed: ${existing.error.message}`
    );
  }
  if (!existing.data) return null;

  const metadata = (existing.data.metadata ?? {}) as Record<string, unknown>;
  return {
    id: existing.data.id,
    changeNoticeId:
      typeof metadata.changeNoticeId === "string"
        ? metadata.changeNoticeId
        : undefined,
    claimedByMessageId:
      typeof metadata.claimedByMessageId === "string"
        ? metadata.claimedByMessageId
        : undefined,
    items: Array.isArray(metadata.items)
      ? (metadata.items as unknown[]).filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []
  };
}

// --- the job ----------------------------------------------------------------

export interface OnshapeReleaseImportInput {
  companyId: string;
  userId: string;
  messageId: string;
  releaseId: string;
  /** ONSHAPE's part number — what the revisions API is asked about. */
  partNumber: string;
  /**
   * CARBON's readableId for the family, when the caller already resolved it by
   * id. Defaults to `partNumber`, which is the legacy behaviour: v1 joins by
   * number, so the two are the same value there.
   */
  carbonReadableId?: string;
  documentId: string;
  versionId: string;
  elementId: string;
  elementType: number;
  revisionId?: string;
  revision?: string;
  releaseName?: string;
  onshapeCompanyId?: string;
  /**
   * The decision already made by a v2 caller, replacing the settings read.
   *
   * `getOnshapeReleaseImportSettings` reads the LEGACY `releaseImportEnabled` /
   * `releaseImportMode` keys, which a v2 company necessarily has off — the v2
   * setting group tells the user the legacy settings are ignored, and the
   * webhook kills the legacy consumers outright. Without this the v2 job
   * delegates here and is refused as "disabled", so `releaseImportV2` never
   * imports anything.
   */
  gate?: { enabled: boolean; mode: "changeNotice" | "revision" };
  /**
   * The release package, already fetched by the v2 caller. Passed in rather
   * than re-fetched: `onshape-release-v2` needs it too, and one release means
   * one call however many elements fan out of it.
   */
  releasePackage?: OnshapeReleasePackage;
  /**
   * Write Onshape's own release name and notes into Carbon, and stamp the
   * notice's source columns. V2 ONLY.
   *
   * Gated rather than unconditional because the branch's acceptance criterion
   * is that a company with no `pipeline` key behaves exactly as today. Legacy
   * callers pass neither this nor `releasePackage`, and take the byte-identical
   * path they always did.
   */
  writeProvenance?: boolean;
}

export async function runOnshapeReleaseImport(
  carbon: CarbonClient,
  payload: OnshapeReleaseImportInput
): Promise<OnshapeReleaseImportResult> {
  // Backstop for the receiver's filter: a drawing resolves to the SAME Carbon
  // item as the model it documents, so it must never claim a release or become a
  // second affected item.
  if (payload.elementType === 2) {
    return { imported: false, skippedReason: "drawing-element" };
  }

  const settings =
    payload.gate ??
    (await getOnshapeReleaseImportSettings(carbon, payload.companyId));
  if (!settings.enabled) {
    return { imported: false, skippedReason: "disabled" };
  }

  const released = await resolveReleasedRevision(carbon, payload);
  if (!released) {
    return { imported: false, skippedReason: "revision-not-found" };
  }
  const { revision, name: onshapeName } = released;

  // v2 only. Built once and reused by both modes; `undefined` on legacy leaves
  // applyOnshapeAttributes doing exactly what it did before.
  const notesBlock = payload.writeProvenance
    ? buildOnshapeItemNotesBlock({
        releaseName:
          readReleasePackageName(payload.releasePackage) ??
          payload.releaseName ??
          null,
        releaseNotes: readReleasePackageNotes(payload.releasePackage),
        partNumber: payload.partNumber,
        revision,
        documentId: payload.documentId,
        versionId: payload.versionId,
        elementId: payload.elementId,
        releaseId: payload.releaseId
      })
    : undefined;

  const target = await resolveReleaseTarget(carbon, {
    companyId: payload.companyId,
    partNumber: payload.carbonReadableId ?? payload.partNumber,
    revision
  });

  if (target.kind === "not-found") {
    // A release of a part Carbon has never seen is a CREATION, not a change, so
    // it never becomes a change notice. Minting it here would land it with
    // Carbon's blanket defaults (Inventory / Make), which poisons MRP for
    // purchased leaf parts.
    //
    // v2 does now mint, but in the RELEASE JOB and behind the
    // `createItemsOnRelease` toggle, using the element type to reach the same
    // Make/Buy answer the BOM import derives from having children
    // (`onshape-mint.ts`). It deliberately does not route through here.
    return { imported: false, skippedReason: "no-matching-item", revision };
  }

  if (target.kind === "already-imported") {
    // Idempotent by construction: a redelivery, a retry, or a genuine
    // re-release of a revision Carbon already holds. Skipping beats a 23505 on
    // item_unique, which would roll back the affected row and leave an EMPTY
    // notice behind a marker claiming a successful import.
    return {
      imported: false,
      skippedReason: "revision-already-imported",
      revision
    };
  }

  const dispatch = getWorkflowDispatch();
  if (!dispatch) {
    // The ERP fills this slot lazily on the first request to /api/inngest.
    throw new Error(
      "onshape-release-import: no dispatcher registered; cannot reach items services"
    );
  }
  const context = {
    client: carbon,
    companyId: payload.companyId,
    companyGroupId: "",
    userId: payload.userId
  };

  const sourceItem = target.item;

  if (settings.mode === "revision") {
    // Direct mode: exactly what the manual "New Revision" button does. Passing
    // the Onshape letter explicitly matters — `getNextRevision` returns its
    // input unchanged for anything that is not pure digits or one-to-two
    // uppercase letters, so an Onshape label like "A2" would be handed straight
    // back and collide on item_unique.
    //
    // `createdBy` is passed EXPLICITLY, not left to injectAuth. When a service's
    // parameter is literally named `args` (as createRevision's is), the MCP
    // direct executor pushes the payload through WITHOUT calling
    // enrichWithAuthContext (direct-executor.ts, the `paramName === "args"`
    // branch), so the declared injectAuth is silently skipped and the item
    // insert fails on createdBy's NOT NULL constraint. Logged as a separate
    // defect — it affects 224 tools, 65 of them writes.
    const created = unwrapDispatch(
      "items_createRevision",
      await dispatch("items_createRevision", context, {
        item: sourceItem,
        revision,
        createdBy: payload.userId,
        active: true
      })
    );
    if (!created.ok) {
      throw new Error(
        `onshape-release-import: createRevision failed: ${errorMessage(created.error)}`
      );
    }
    const newItemId = isRecord(created.data)
      ? String(created.data.id ?? "")
      : "";

    await applyOnshapeAttributes(carbon, {
      itemId: newItemId,
      companyId: payload.companyId,
      userId: payload.userId,
      name: sourceItem.name as string | null,
      onshapeName,
      notesBlock
    });

    return {
      imported: true,
      mode: "revision",
      itemId: sourceItem.id,
      newItemId: newItemId || undefined,
      revision
    };
  }

  // --- change-notice mode ---------------------------------------------------

  // Permit-and-warn parity with the UI. Carbon deliberately ALLOWS same-part
  // parallel change notices (the one-open-CO-per-part guard was dropped), and
  // the affected-item picker filters out inactive draft revisions entirely, so
  // targeting the live item is exactly what a human can do. What the UI also
  // does is WARN — ItemOpenChangeNoticeAlert lists every open notice on the
  // part. A headless import has no such surface, so record it on the marker.
  const openNoticeCollisions = await findOpenNoticesForItem(carbon, {
    itemId: sourceItem.id,
    companyId: payload.companyId
  });

  const marker = await readReleaseMarker(carbon, {
    releaseId: payload.releaseId,
    companyId: payload.companyId
  });

  let changeNoticeId = marker?.changeNoticeId;

  if (!changeNoticeId) {
    const timeZone = await getCompanyTimeZone(carbon, payload.companyId);
    // The package is authoritative for its own name; the webhook's copy is a
    // convenience field, and on a v2 run we already hold the package.
    const releaseLabel =
      (payload.writeProvenance
        ? readReleasePackageName(payload.releasePackage)
        : null) ??
      payload.releaseName?.trim() ??
      payload.releaseId;
    const inserted = unwrapDispatch(
      "items_insertChangeNotice",
      await dispatch("items_insertChangeNotice", context, {
        name: `Onshape release ${releaseLabel}`,
        // Provenance as DATA rather than prose. Nothing renders these yet, but
        // getChangeNotice selects * so a reader already receives them.
        ...(payload.writeProvenance
          ? { sourceType: "onshape", sourceId: payload.releaseId }
          : {}),
        openDate: datetime.today(timeZone).toString(),
        type: "Engineering",
        // An auto-created Draft notifies nobody — changeNoticeNotifyStages
        // (items.models.ts:1103) is Start/Implementation/Done only. The assignee
        // is what makes it land in a human's queue. NotificationEvent
        // .IntegrationSync is deliberately NOT used: it renders as "Accounting
        // sync needs attention".
        assignee: payload.userId,
        reasonForChange: reasonForChangeContent(payload, revision)
      })
    );
    if (!inserted.ok) {
      throw new Error(
        `onshape-release-import: insertChangeNotice failed: ${errorMessage(inserted.error)}`
      );
    }
    changeNoticeId = isRecord(inserted.data)
      ? String(inserted.data.id ?? "")
      : "";
    if (!changeNoticeId) {
      throw new Error(
        "onshape-release-import: insertChangeNotice returned no id"
      );
    }

    // Claim IMMEDIATELY, before any affected item is added: if this run dies
    // mid-way, the retry must find the notice rather than create a second one.
    const claim = await carbon
      .from("externalIntegrationMapping")
      .insert({
        entityType: MARKER_ENTITY_TYPE,
        entityId: payload.releaseId,
        integration: MARKER_INTEGRATION,
        externalId: payload.releaseId,
        companyId: payload.companyId,
        createdBy: payload.userId,
        metadata: {
          changeNoticeId,
          claimedByMessageId: payload.messageId,
          documentId: payload.documentId,
          versionId: payload.versionId,
          releaseName: payload.releaseName ?? null,
          items: []
        }
      })
      .select("id")
      .single();

    if (claim.error) {
      // UNIQUE (entityType, entityId, integration, companyId) is the claim. A
      // violation means a sibling — or an earlier attempt of THIS run — got
      // there first. Re-read and adopt its notice rather than using ours.
      if (errorCode(claim.error) !== UNIQUE_VIOLATION) {
        throw new Error(
          `onshape-release-import: marker claim failed: ${claim.error.message}`
        );
      }
      const raced = await readReleaseMarker(carbon, {
        releaseId: payload.releaseId,
        companyId: payload.companyId
      });
      if (!raced?.changeNoticeId) {
        throw new Error(
          "onshape-release-import: marker exists but names no change notice"
        );
      }
      changeNoticeId = raced.changeNoticeId;
    }
  }

  // Append this element as an affected item. Revision is the honest change type
  // when Onshape advanced the revision letter; Version would mean "same part
  // number, structure differs", which needs a BOM comparison v1 does not do.
  const added = unwrapDispatch(
    "items_addChangeNoticeAffectedItem",
    await dispatch("items_addChangeNoticeAffectedItem", context, {
      changeNoticeId,
      itemId: sourceItem.id,
      changeType: "Revision",
      revision,
      // injectAuth does NOT include userId, so anything needing input.userId
      // must be passed explicitly.
      userId: payload.userId
    })
  );

  let newItemId: string | undefined;
  if (!added.ok) {
    // UNIQUE (changeOrderId, itemId): this element is already on the notice —
    // our own retry, or two released elements resolving to one Carbon item.
    // Logged with identity so a genuine duplicate-derivation bug stays visible.
    if (errorCode(added.error) === UNIQUE_VIOLATION) {
      console.warn(
        "onshape-release-import: affected item already present; treating as done",
        {
          companyId: payload.companyId,
          partNumber: payload.partNumber,
          itemId: sourceItem.id,
          changeNoticeId
        }
      );
    } else {
      throw new Error(
        `onshape-release-import: addChangeNoticeAffectedItem failed: ${errorMessage(added.error)}`
      );
    }
  } else if (isRecord(added.data)) {
    // addChangeNoticeAffectedItem returns only { id, draftMakeMethodId }
    // (items.service.ts:6299-6305) — it WRITES newItemId onto the affected-item
    // row but does not return it. Read it back, or the attribute write below
    // silently never runs and the draft revision stays a byte-for-byte copy of
    // its base, which is exactly the "No changes yet." empty diff.
    const affectedItemId = String(added.data.id ?? "");
    if (affectedItemId) {
      const affectedRow = await carbon
        .from("changeOrderAffectedItem")
        .select("newItemId")
        .eq("id", affectedItemId)
        .eq("companyId", payload.companyId)
        .maybeSingle();
      if (affectedRow.error) {
        console.warn("onshape-release-import: affected-item read-back failed", {
          companyId: payload.companyId,
          affectedItemId,
          error: affectedRow.error.message
        });
      }
      newItemId = affectedRow.data?.newItemId ?? undefined;
    }
  }

  // Make the notice carry Onshape's content. Without this the draft revision is
  // a byte-for-byte copy of its base and the diff viewer renders the literal
  // string "No changes yet." — pre-populated in name only.
  if (newItemId) {
    await applyOnshapeAttributes(carbon, {
      itemId: newItemId,
      companyId: payload.companyId,
      userId: payload.userId,
      name: sourceItem.name as string | null,
      onshapeName,
      notesBlock
    });
  }

  await recordMarkerProgress(carbon, {
    releaseId: payload.releaseId,
    companyId: payload.companyId,
    userId: payload.userId,
    partNumber: payload.partNumber,
    collisions: openNoticeCollisions,
    itemId: sourceItem.id,
    changeNoticeId
  });

  return {
    imported: true,
    mode: "changeNotice",
    changeNoticeId,
    itemId: sourceItem.id,
    newItemId,
    revision,
    openNoticeCollisions:
      openNoticeCollisions.length > 0 ? openNoticeCollisions : undefined
  };
}

/**
 * What goes in `reasonForChange`.
 *
 * On v2 with a release package, this is ONSHAPE'S OWN NOTES — the text the
 * releaser wrote to explain the change, which is exactly what the field means.
 * Carbon's machine-generated provenance moves to `sourceType`/`sourceId`, two
 * columns that have existed unused since the change-order migration.
 *
 * The fallback matters: a release with no notes must NOT produce an empty
 * reason. An auto-created Draft whose reason is `{}` is a regression against
 * today, not a neutral change, so the provenance sentences stay as the default.
 */
function reasonForChangeContent(
  payload: OnshapeReleaseImportInput,
  revision: string
): Record<string, unknown> {
  if (payload.writeProvenance) {
    const notes = readReleasePackageNotes(payload.releasePackage);
    if (notes) return textToTiptap(notes) as Record<string, unknown>;
  }
  return onshapeProvenance(payload, revision);
}

/**
 * Release provenance as tiptap JSON. `reasonForChange` is a rich-text column
 * rendered on the notice detail page, so a plain string would not render.
 */
function onshapeProvenance(
  payload: OnshapeReleaseImportInput,
  revision: string
): Record<string, unknown> {
  const lines = [
    `Imported from Onshape release ${payload.releaseName?.trim() || payload.releaseId}.`,
    `Part ${payload.partNumber} at revision ${revision}.`,
    `Document ${payload.documentId} / version ${payload.versionId} / element ${payload.elementId}.`
  ];
  return {
    type: "doc",
    content: lines.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }]
    }))
  };
}

/**
 * Write Onshape-owned attributes onto the draft/new revision item.
 *
 * A narrow two-column update, NOT `items_updateItem`: that service runs the
 * payload through `sanitize()`, which turns a present-but-undefined key into
 * null, and its schema requires name + replenishmentSystem.
 */
async function applyOnshapeAttributes(
  carbon: CarbonClient,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    name: string | null;
    onshapeName?: string;
    /** v2 only — the release provenance block for this item's notes. */
    notesBlock?: ReturnType<typeof buildOnshapeItemNotesBlock>;
  }
): Promise<void> {
  if (!args.itemId) return;

  // Provenance first, and independent of the name: an item whose Onshape name
  // already matches Carbon's returns early below, and it still deserves to
  // record which release produced it. writeOnshapeItemNotes is non-fatal by
  // contract, so this cannot fail the import.
  if (args.notesBlock) {
    await writeOnshapeItemNotes(carbon, {
      companyId: args.companyId,
      itemId: args.itemId,
      userId: args.userId,
      block: args.notesBlock
    });
  }

  const name = args.onshapeName?.trim();
  if (!name || name === args.name) return;

  const updated = await carbon
    .from("item")
    .update({ name, updatedBy: args.userId })
    .eq("id", args.itemId)
    .eq("companyId", args.companyId);
  if (updated.error) {
    // Non-fatal: the notice and its affected item already exist and are the
    // point. Losing the name refresh must not fail (and retry) the import.
    console.warn("onshape-release-import: attribute write failed", {
      companyId: args.companyId,
      itemId: args.itemId,
      error: updated.error.message
    });
  }
}

async function recordMarkerProgress(
  carbon: CarbonClient,
  args: {
    releaseId: string;
    companyId: string;
    userId: string;
    partNumber: string;
    collisions: OpenNotice[];
    itemId: string;
    changeNoticeId: string;
  }
): Promise<void> {
  const marker = await readReleaseMarker(carbon, {
    releaseId: args.releaseId,
    companyId: args.companyId
  });
  if (!marker) return;

  const items = [...new Set([...marker.items, args.partNumber])];
  const existing = await carbon
    .from("externalIntegrationMapping")
    .select("metadata")
    .eq("id", marker.id)
    .eq("companyId", args.companyId)
    .maybeSingle();
  const metadata = (existing.data?.metadata ?? {}) as Record<string, unknown>;

  const priorCollisions = Array.isArray(metadata.openNoticeCollisions)
    ? (metadata.openNoticeCollisions as unknown[])
    : [];
  const collisions =
    args.collisions.length > 0
      ? [
          ...priorCollisions,
          {
            itemId: args.itemId,
            partNumber: args.partNumber,
            targetedNotice: args.changeNoticeId,
            priorOpenNotices: args.collisions
          }
        ]
      : priorCollisions;

  const updated = await carbon
    .from("externalIntegrationMapping")
    .update({
      metadata: {
        ...metadata,
        items,
        // Omit the key entirely when empty so the common path's shape is unchanged.
        ...(collisions.length > 0 ? { openNoticeCollisions: collisions } : {}),
        lastImportedAt: datetime.timestamp()
      },
      lastSyncedAt: datetime.timestamp(),
      updatedBy: args.userId ?? undefined
    } as never)
    .eq("id", marker.id)
    .eq("companyId", args.companyId);
  if (updated.error) {
    console.warn("onshape-release-import: marker progress write failed", {
      companyId: args.companyId,
      releaseId: args.releaseId,
      error: updated.error.message
    });
  }
}

const OnshapeReleaseImportPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  messageId: z.string(),
  releaseId: z.string(),
  partNumber: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  elementType: z.number(),
  revisionId: z.string().optional(),
  revision: z.string().optional(),
  releaseName: z.string().optional(),
  onshapeCompanyId: z.string().optional()
});

export const onshapeReleaseImportFunction = inngest.createFunction(
  {
    id: "onshape-release-import",
    retries: 3,
    idempotency: "event.data.messageId",
    // Serialise per RELEASE, not per element: the claim-then-append pattern
    // needs one writer at a time so two siblings cannot both create a notice.
    concurrency: { key: "event.data.releaseId", limit: 1 }
  },
  { event: "carbon/onshape-release-import" },
  async ({ event, step }) => {
    const payload = OnshapeReleaseImportPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    const result = await step.run("import-release", () =>
      runOnshapeReleaseImport(carbon, payload)
    );

    if (!result.imported) {
      console.log("onshape-release-import: skipped", {
        companyId: payload.companyId,
        partNumber: payload.partNumber,
        releaseId: payload.releaseId,
        reason: result.skippedReason
      });
    }

    return result;
  }
);
