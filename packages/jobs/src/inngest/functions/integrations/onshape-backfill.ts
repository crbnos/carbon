import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  getOnshapeClient,
  OnshapeApiError,
  OnshapeAssetTooLargeError,
  type OnshapeRevision
} from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RetryAfterError } from "inngest";
import { z } from "zod";
import { inngest } from "../../client";
import {
  escapeLikePattern,
  releaseKey,
  sharedNumberSuffix
} from "./onshape-matching";
import {
  syncOnshapeDrawingAssetsToItem,
  syncOnshapeElementAssetsToItem
} from "./onshape-sync-element";
import {
  accumulateRunCounters,
  captureAmbiguousReleases,
  captureUnmatchedReleases,
  classifyOnshapeReleasedAsset,
  createRunProgress,
  finalizeRun,
  markRunRunning,
  type OnshapeAssetProvenance,
  type OnshapeItemSyncStatus,
  type OnshapeReleaseReference,
  type OnshapeSkipReason,
  type OnshapeSyncAssetKind,
  upsertItemSyncState,
  writeRunProgress
} from "./onshape-sync-state";

// Backfill / reconcile: pull released Onshape assets onto existing Carbon items.
// Onshape-DRIVEN and LINK-ONLY, and call-light: enumerate the company's released
// revisions from the list endpoint (a few paginated calls), match each to a
// Carbon item LOCALLY by part number (one DB query per page), and only spend
// export calls on matches. Never creates items.
//
// Two modes, same code:
//   - Full backfill: omit `after` — pages through all released revisions.
//   - Incremental reconcile: pass `after` (ISO date of the last sync) — the list
//     endpoint returns only revisions released since, so this is the cheap safety
//     net for anything a go-forward webhook missed (no full re-scan).
//
// Step granularity: each page is matched in one fast memoized step (list + DB
// join, no exports), then every matched export+attach runs as its OWN memoized
// step. Inngest executes each step as a separate HTTP call into the app, so a
// single step must stay well under request-timeout territory — one export
// (seconds) is safe where a whole page of exports (potentially many minutes)
// is not. On retry, completed steps replay from cache and work resumes at the
// first unfinished item. onshapeCompanyId auto-resolves via getCompanies when
// omitted.

type CarbonClient = SupabaseClient<Database>;

export interface OnshapeBackfillInput {
  companyId: string; // Carbon company
  userId: string; // Onshape integration installer (auth + audit)
  onshapeCompanyId?: string; // resolved via getCompanies if omitted
  after?: string; // ISO date — only revisions released after this (incremental)
  pageLimit?: number; // revisions per page (default 50)
  runId?: string; // the onshapeSyncRun row this run reports into (absent = untracked)
}

// One matched export+attach, produced by the page-match step and executed as
// its own Inngest step.
export interface OnshapeBackfillWorkItem {
  kind: OnshapeSyncAssetKind;
  label: string; // for logs, e.g. "model PRT-002033 rev A"
  itemId: string; // resolved Carbon item
  partNumber: string;
  revision: string;
  revisionId: string | null; // the release's own id, when Onshape reports one
  releaseState: string;
  documentId: string;
  versionId: string;
  elementId: string;
  modelElementKind?: "partstudio" | "assembly"; // kind === "model" only
  assetBaseName?: string;
}

// A release whose matched item ALREADY holds an asset of that kind that this
// sync cannot prove it fetched — a file uploaded by hand, or a sync from before
// the state table existed. The export is skipped (never clobber an attached
// asset, never spend Onshape quota on one) and the row says only what is true:
// the released revision we matched, and that an asset was already there.
export interface OnshapeBackfillObservedMatch {
  assetKind: OnshapeSyncAssetKind;
  itemId: string;
  // Carried on the entry rather than hardcoded at the write site, so the shape
  // of the row and the reason for it are decided in one place.
  status: Extract<OnshapeItemSyncStatus, "skipped">;
  skipReason: Extract<OnshapeSkipReason, "existing-asset">;
  observedOnly: true;
  partNumber: string;
  revision: string;
  revisionId: string | null;
  releaseState: string;
  documentId: string;
  versionId: string;
  elementId: string;
}

export interface OnshapeBackfillPageResult {
  revisionsScanned: number;
  skippedNoItem: number; // released in Onshape but no matching Carbon item (link-only)
  skippedAlreadySynced: number; // item already holds this asset (ours or not) — skipped to save API calls
  skippedNonModel: number; // unknown element type (not part studio / assembly / drawing)
  workItems: OnshapeBackfillWorkItem[]; // matched exports for the per-item sync steps
  observedMatches: OnshapeBackfillObservedMatch[]; // matched, asset attached from an unproven source
  unmatchedReleases: OnshapeReleaseReference[]; // released with no matching item
  ambiguousReleases: OnshapeReleaseReference[]; // released matching several items
  hasMore: boolean;
  nextCursor: string | null; // Onshape `next` cursor URL for the following page
}

// Every revision that reaches the match loop survived the isObsolete filter, so
// the release state recorded for it is Onshape's released state.
const RELEASED_STATE = "Released";

const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 60;
// Clamp Onshape's Retry-After so a bad/huge value can't schedule an absurd wait.
const RATE_LIMIT_MAX_WAIT_SECONDS = 300;
const MAX_CONSECUTIVE_FAILURES = 5;

// On a 429, surface it to Inngest as a RetryAfterError rather than blocking the
// step with an in-process sleep. Inngest SUSPENDS the function — releasing its
// compute window and the per-company concurrency slot — and reschedules it after
// the delay; the memoized steps mean it resumes at the first unfinished item, and
// every export/attach is idempotent so a re-run is safe. The wait honors Onshape's
// Retry-After (default 60s), clamped to a sane maximum. Anything else rethrows.
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OnshapeApiError && error.status === 429) {
      const waitSeconds = Math.min(
        error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS,
        RATE_LIMIT_MAX_WAIT_SECONDS
      );
      throw new RetryAfterError(
        `onshape: rate limited on ${label}; retrying after ${waitSeconds}s`,
        waitSeconds * 1000,
        { cause: error }
      );
    }
    throw error;
  }
}

// Shared gate for the Onshape asset-sync jobs: run only when the integration is
// active AND asset sync is enabled. One definition so the backfill and go-forward
// gates can't silently drift apart.
export async function isOnshapeAssetSyncEnabled(
  carbon: CarbonClient,
  companyId: string
): Promise<boolean> {
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
  return (
    Boolean(integration.data?.active) && metadata.assetSyncEnabled === true
  );
}

export async function resolveOnshapeCompanyId(
  carbon: CarbonClient,
  input: Pick<OnshapeBackfillInput, "companyId" | "userId">
): Promise<string> {
  // Prefer the company id captured at connect (explicit + stable) over guessing
  // getCompanies()[0], which is ambiguous for multi-company Onshape accounts.
  const stored = await carbon
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "onshape")
    .eq("companyId", input.companyId)
    .maybeSingle();
  const storedCompanyId = (
    stored.data?.metadata as Record<string, unknown> | undefined
  )?.onshapeCompanyId;
  if (typeof storedCompanyId === "string" && storedCompanyId) {
    return storedCompanyId;
  }

  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `resolveOnshapeCompanyId: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const companies = await onshape.client.getCompanies();
  const onshapeCompanyId = companies[0]?.id;
  if (!onshapeCompanyId) {
    throw new Error(
      "resolveOnshapeCompanyId: could not resolve an Onshape company id — pass onshapeCompanyId explicitly"
    );
  }
  return onshapeCompanyId;
}

// Is SOME PDF attached to this item? Deliberately loose, and used for one
// question only: may the backfill overwrite what is there / spend an export
// call? It says nothing about where the file came from — a quality certificate
// someone uploaded by hand counts, which is exactly why provenance is read from
// the sync-state table instead (classifyOnshapeReleasedAsset). Do not promote
// this to a "we synced it" signal.
async function itemHasPdfDocument(
  carbon: CarbonClient,
  companyId: string,
  itemId: string
): Promise<boolean> {
  const docs = await carbon
    .from("document")
    .select("id")
    .eq("companyId", companyId)
    .eq("type", "PDF")
    .like("path", `${escapeLikePattern(`${companyId}/parts/${itemId}/`)}%`)
    .limit(1);
  return (docs.data?.length ?? 0) > 0;
}

// One matched release, resolved to exactly one Carbon item — before the decision
// about whether it needs an export. The whole page is matched first so the
// sync-state provenance for every matched item is read in ONE query.
interface OnshapeBackfillMatch {
  assetKind: OnshapeSyncAssetKind;
  label: string;
  itemId: string;
  partNumber: string;
  revision: string;
  revisionId: string | null;
  releaseState: string;
  documentId: string;
  versionId: string;
  elementId: string;
  modelElementKind?: "partstudio" | "assembly";
  assetBaseName?: string;
  /** What the item row holds for a model match; always null for a drawing. */
  modelUploadId: string | null;
}

// The revision's own id, when the revisions list carries one. Not guaranteed, so
// the provenance check falls back to the released element id without it.
function releasedRevisionId(revision: OnshapeRevision): string | null {
  return revision.id ? revision.id : null;
}

function provenanceKey(itemId: string, assetKind: string): string {
  return `${itemId}:${assetKind}`;
}

// The page's provenance read: one query for every matched item, keyed by item x
// asset kind. A failed read is not evidence of anything, so it throws — the page
// step replays rather than silently demoting rows that ARE proven.
async function readMatchedItemProvenance(
  carbon: CarbonClient,
  companyId: string,
  matches: OnshapeBackfillMatch[]
): Promise<Map<string, OnshapeAssetProvenance>> {
  const provenanceByItemAsset = new Map<string, OnshapeAssetProvenance>();
  const matchedItemIds = Array.from(
    new Set(matches.map((match) => match.itemId))
  );
  if (matchedItemIds.length === 0) {
    return provenanceByItemAsset;
  }
  const stateRows = await carbon
    .from("onshapeItemSyncState")
    .select("itemId, assetKind, status, revisionId, elementId")
    .eq("companyId", companyId)
    .in("itemId", matchedItemIds);
  if (stateRows.error) {
    throw new Error(
      `matchOnshapeBackfillPage: sync state query failed: ${stateRows.error.message}`
    );
  }
  for (const stateRow of stateRows.data ?? []) {
    provenanceByItemAsset.set(
      provenanceKey(stateRow.itemId, stateRow.assetKind),
      {
        status: stateRow.status,
        revisionId: stateRow.revisionId,
        elementId: stateRow.elementId
      }
    );
  }
  return provenanceByItemAsset;
}

// One page of the backfill: fetch a page of released revisions and match them to
// Carbon items locally (no exports here — those run as per-item steps). Exported
// so the Inngest function can run each page match as its own memoized step.
export async function matchOnshapeBackfillPage(
  carbon: CarbonClient,
  input: OnshapeBackfillInput & { onshapeCompanyId: string },
  cursor: string | null
): Promise<OnshapeBackfillPageResult> {
  const pageLimit = input.pageLimit ?? 50;

  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `matchOnshapeBackfillPage: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const client = onshape.client;

  // Follow Onshape's own `next` cursor rather than incrementing offset — Onshape
  // caps `offset` at 100, and its `next` advances via `after=<date>&offset=1`. The
  // first page (cursor === null) starts from the given `after`; each subsequent
  // page is fetched from the previous page's `next` URL.
  const page = await withRateLimitRetry(
    () =>
      cursor
        ? client.getCompanyRevisionsPage(cursor)
        : client.getCompanyRevisions(input.onshapeCompanyId, {
            limit: pageLimit,
            after: input.after
          }),
    cursor ? "revisions next page" : "revisions first page"
  );
  const pageItems = page.items ?? [];
  // Onshape's `next` presence is authoritative for whether more pages exist (a
  // full page can be entirely obsolete revisions and still have more behind it).
  const nextCursor = page.next ?? null;
  const hasMore = Boolean(nextCursor);
  const revisions = pageItems.filter((revision) => !revision.isObsolete);

  const result: OnshapeBackfillPageResult = {
    revisionsScanned: 0,
    skippedNoItem: 0,
    skippedAlreadySynced: 0,
    skippedNonModel: 0,
    workItems: [],
    observedMatches: [],
    unmatchedReleases: [],
    ambiguousReleases: [],
    hasMore,
    nextCursor
  };
  if (revisions.length === 0) {
    return result;
  }

  // Match this page's MODEL revisions (part studios/assemblies) to Carbon items
  // in one query (local join). modelUploadId lets us skip already-synced models
  // without an Onshape call. Drawings are matched separately by shared number.
  const modelKeys = Array.from(
    new Set(
      revisions
        .filter(
          (revision) => revision.elementType === 0 || revision.elementType === 1
        )
        .map((revision) => releaseKey(revision.partNumber, revision.revision))
    )
  );
  const itemByKey = new Map<
    string,
    { id: string; modelUploadId: string | null }
  >();
  if (modelKeys.length > 0) {
    const carbonItems = await carbon
      .from("item")
      .select("id, readableIdWithRevision, modelUploadId")
      .eq("companyId", input.companyId)
      .in("readableIdWithRevision", modelKeys);
    if (carbonItems.error) {
      throw new Error(
        `matchOnshapeBackfillPage: item match query failed: ${carbonItems.error.message}`
      );
    }
    for (const item of carbonItems.data ?? []) {
      if (item.readableIdWithRevision) {
        itemByKey.set(item.readableIdWithRevision, {
          id: item.id,
          modelUploadId: item.modelUploadId
        });
      }
    }
  }

  // Phase 1: resolve every release on this page to at most one Carbon item.
  const matches: OnshapeBackfillMatch[] = [];

  for (const revision of revisions) {
    result.revisionsScanned++;
    const releaseReference: OnshapeReleaseReference = {
      partNumber: revision.partNumber,
      revision: revision.revision,
      state: RELEASED_STATE
    };

    // DRAWING (elementType 2): released as its own DRW-xxxx element. Attach its
    // PDF to the model item sharing its number (PRT/ASM); never create a DRW item.
    if (revision.elementType === 2) {
      const suffix = sharedNumberSuffix(revision.partNumber);
      if (suffix.length < 2) {
        result.skippedNoItem++;
        result.unmatchedReleases.push(releaseReference);
        continue;
      }
      const candidates = await carbon
        .from("item")
        .select("id, readableIdWithRevision")
        .eq("companyId", input.companyId)
        .eq("revision", revision.revision)
        .ilike("readableId", `%${escapeLikePattern(suffix)}`);
      if (candidates.error) {
        throw new Error(
          `matchOnshapeBackfillPage: drawing item match query failed: ${candidates.error.message}`
        );
      }
      const items = candidates.data ?? [];
      // Exactly-one match only; 0 or >1 (ambiguous) is not safe to attach.
      const target = items.length === 1 ? items[0] : undefined;
      if (!target) {
        result.skippedNoItem++;
        // An ambiguous match is its own release exception: several parts share
        // this number + revision, so no single item row may claim the skip.
        if (items.length > 1) {
          result.ambiguousReleases.push(releaseReference);
        } else {
          result.unmatchedReleases.push(releaseReference);
        }
        continue;
      }
      matches.push({
        assetKind: "drawing",
        label: `drawing ${revision.partNumber} rev ${revision.revision}`,
        itemId: target.id,
        partNumber: revision.partNumber,
        revision: revision.revision,
        revisionId: releasedRevisionId(revision),
        releaseState: RELEASED_STATE,
        documentId: revision.documentId,
        versionId: revision.versionId,
        elementId: revision.elementId,
        assetBaseName: target.readableIdWithRevision ?? undefined,
        modelUploadId: null
      });
      continue;
    }

    // MODEL (elementType 0 = part studio, 1 = assembly). Anything else is an
    // element type we don't export.
    if (revision.elementType !== 0 && revision.elementType !== 1) {
      result.skippedNonModel++;
      continue;
    }
    const matchedItem = itemByKey.get(
      releaseKey(revision.partNumber, revision.revision)
    );
    if (!matchedItem) {
      result.skippedNoItem++;
      result.unmatchedReleases.push(releaseReference);
      continue;
    }
    matches.push({
      assetKind: "model",
      label: `model ${revision.partNumber} rev ${revision.revision}`,
      itemId: matchedItem.id,
      partNumber: revision.partNumber,
      revision: revision.revision,
      revisionId: releasedRevisionId(revision),
      releaseState: RELEASED_STATE,
      documentId: revision.documentId,
      versionId: revision.versionId,
      elementId: revision.elementId,
      modelElementKind: revision.elementType === 1 ? "assembly" : "partstudio",
      assetBaseName: releaseKey(revision.partNumber, revision.revision),
      modelUploadId: matchedItem.modelUploadId
    });
  }

  // Phase 2: decide what each match needs. Three outcomes, and the sync-state
  // table is the ONLY evidence that separates the first two (see
  // classifyOnshapeReleasedAsset): a proven sync of this released revision, an
  // asset of unknown origin, or nothing attached at all.
  const provenanceByItemAsset = await readMatchedItemProvenance(
    carbon,
    input.companyId,
    matches
  );

  for (const match of matches) {
    const assetAttached =
      match.assetKind === "model"
        ? match.modelUploadId !== null
        : await itemHasPdfDocument(carbon, input.companyId, match.itemId);
    const disposition = classifyOnshapeReleasedAsset(
      {
        assetAttached,
        revisionId: match.revisionId,
        elementId: match.elementId
      },
      provenanceByItemAsset.get(provenanceKey(match.itemId, match.assetKind))
    );

    // A proven sync of this exact released revision: skip the export and write
    // nothing — the row that proved it is already accurate.
    if (disposition === "already-synced") {
      result.skippedAlreadySynced++;
      continue;
    }

    // An asset is attached that we cannot attribute to ourselves. Still skipped,
    // but recorded as the observation it is. An item whose only PDF is a quality
    // certificate lands here rather than reading as a synced drawing — that is
    // the point, so leave it: skipping keeps a hand-attached file safe, and the
    // row must not claim a sync that never happened.
    if (disposition === "existing-asset") {
      result.skippedAlreadySynced++;
      result.observedMatches.push({
        assetKind: match.assetKind,
        itemId: match.itemId,
        status: "skipped",
        skipReason: "existing-asset",
        observedOnly: true,
        partNumber: match.partNumber,
        revision: match.revision,
        revisionId: match.revisionId,
        releaseState: match.releaseState,
        documentId: match.documentId,
        versionId: match.versionId,
        elementId: match.elementId
      });
      continue;
    }

    result.workItems.push({
      kind: match.assetKind,
      label: match.label,
      itemId: match.itemId,
      partNumber: match.partNumber,
      revision: match.revision,
      revisionId: match.revisionId,
      releaseState: match.releaseState,
      documentId: match.documentId,
      versionId: match.versionId,
      elementId: match.elementId,
      modelElementKind: match.modelElementKind,
      assetBaseName: match.assetBaseName
    });
  }

  return result;
}

// One matched export+attach — the body of a per-item Inngest step. An export
// that exceeds Carbon's upload limits returns `skippedTooLarge` instead of
// throwing: the skip is permanent (a retry can't shrink the asset), so it must
// not fail the step and burn retries/quota.
export async function syncOnshapeBackfillWorkItem(
  carbon: CarbonClient,
  input: Pick<OnshapeBackfillInput, "companyId" | "userId">,
  workItem: OnshapeBackfillWorkItem
): Promise<{
  modelUploadId: string | null;
  thumbnailAttached?: boolean; // Onshape-rendered thumbnail stored — no fallback event needed
  skippedTooLarge?: boolean;
}> {
  try {
    if (workItem.kind === "drawing") {
      const attached = await withRateLimitRetry(
        () =>
          syncOnshapeDrawingAssetsToItem(carbon, {
            companyId: input.companyId,
            userId: input.userId,
            itemId: workItem.itemId,
            sourceDocument: "Part",
            documentId: workItem.documentId,
            versionId: workItem.versionId,
            drawingElementId: workItem.elementId,
            assetBaseName: workItem.assetBaseName
          }),
        workItem.label
      );
      return { modelUploadId: attached.modelUploadId };
    }

    const attached = await withRateLimitRetry(
      () =>
        syncOnshapeElementAssetsToItem(carbon, {
          companyId: input.companyId,
          userId: input.userId,
          itemId: workItem.itemId,
          sourceDocument: "Part", // v1: released items are parts/assemblies
          documentId: workItem.documentId,
          versionId: workItem.versionId,
          modelElementId: workItem.elementId,
          modelElementKind: workItem.modelElementKind ?? "partstudio",
          assetBaseName: workItem.assetBaseName
        }),
      workItem.label
    );
    return {
      modelUploadId: attached.modelUploadId,
      thumbnailAttached: attached.thumbnailAttached
    };
  } catch (syncError) {
    if (syncError instanceof OnshapeAssetTooLargeError) {
      console.warn(
        `syncOnshapeBackfillWorkItem: skipping oversized ${workItem.label}: ${syncError.message}`
      );
      return { modelUploadId: null, skippedTooLarge: true };
    }
    throw syncError;
  }
}

// --- Sync-state bookkeeping -------------------------------------------------
// Every write below goes through the helpers in onshape-sync-state.ts, which
// catch and log rather than throw: a bookkeeping failure must never turn a
// completed export into an Inngest retry. Tracking is skipped wholesale for a
// run without a `runId` (an event queued before sync tracking existed).

// The identity + provenance every item row for this run shares.
function itemStateForWorkItem(
  input: OnshapeBackfillInput,
  workItem: OnshapeBackfillWorkItem
) {
  return {
    companyId: input.companyId,
    userId: input.userId, // the user who started the run
    itemId: workItem.itemId,
    assetKind: workItem.kind,
    source: "backfill" as const,
    partNumber: workItem.partNumber,
    revision: workItem.revision,
    revisionId: workItem.revisionId,
    releaseState: workItem.releaseState,
    documentId: workItem.documentId,
    versionId: workItem.versionId,
    elementId: workItem.elementId,
    runId: input.runId ?? null
  };
}

// The work-item step body: the v1 export+attach plus this item's sync-state row,
// written INSIDE the step so it neither replays nor can fail the export.
async function syncBackfillWorkItemWithState(
  carbon: CarbonClient,
  input: OnshapeBackfillInput,
  workItem: OnshapeBackfillWorkItem
) {
  const tracked = Boolean(input.runId);
  try {
    const attached = await syncOnshapeBackfillWorkItem(carbon, input, workItem);
    if (tracked) {
      await upsertItemSyncState(carbon, {
        ...itemStateForWorkItem(input, workItem),
        status: attached.skippedTooLarge ? "skipped" : "synced",
        skipReason: attached.skippedTooLarge ? "asset-too-large" : null,
        modelUploadId: workItem.kind === "model" ? attached.modelUploadId : null
      });
    }
    return attached;
  } catch (syncError) {
    // A rate-limit reschedule is not an outcome — the same step runs again after
    // the wait, so it must not surface as a failed item.
    if (tracked && !(syncError instanceof RetryAfterError)) {
      await upsertItemSyncState(carbon, {
        ...itemStateForWorkItem(input, workItem),
        status: "failed",
        error:
          syncError instanceof Error ? syncError.message : String(syncError)
      });
    }
    throw syncError;
  }
}

// Matches whose asset was already attached from somewhere this sync cannot
// name: recorded as skipped for that reason, by observation. The released
// revision's identifiers ARE true of the release we matched (and are what makes
// the sidebar's open-in-Onshape link work), so they are kept; `modelUploadId` is
// not, because that column means "what this sync attached".
async function recordObservedMatches(
  carbon: CarbonClient,
  input: OnshapeBackfillInput,
  observedMatches: OnshapeBackfillObservedMatch[]
): Promise<{ recorded: number }> {
  for (const observed of observedMatches) {
    await upsertItemSyncState(carbon, {
      companyId: input.companyId,
      userId: input.userId,
      itemId: observed.itemId,
      assetKind: observed.assetKind,
      status: observed.status,
      skipReason: observed.skipReason,
      source: "backfill",
      observedOnly: observed.observedOnly,
      partNumber: observed.partNumber,
      revision: observed.revision,
      revisionId: observed.revisionId,
      releaseState: observed.releaseState,
      documentId: observed.documentId,
      versionId: observed.versionId,
      elementId: observed.elementId,
      runId: input.runId ?? null
    });
  }
  return { recorded: observedMatches.length };
}

// --- Inngest function -------------------------------------------------------
// CONFIGURABLE: runs only when the company has explicitly enabled Onshape asset
// sync (companyIntegration.metadata.assetSyncEnabled === true) and the integration
// is active. Default is OFF — nothing runs unless turned on. Fired via
// trigger("onshape-backfill", { companyId, userId, runId?, after? }).

const OnshapeBackfillPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  onshapeCompanyId: z.string().optional(),
  after: z.string().optional(),
  pageLimit: z.number().optional(),
  runId: z.string().optional()
});

type OnshapeBackfillPayload = z.infer<typeof OnshapeBackfillPayloadSchema>;

export const onshapeBackfillFunction = inngest.createFunction(
  {
    id: "onshape-backfill",
    // Higher than the usual 3: a 429 now reschedules the run via RetryAfterError
    // (withRateLimitRetry), and that reschedule counts against this budget. A big
    // first-time backfill can hit the rate limit a few times, so give it headroom
    // to ride those out before giving up (a failed run resumes cleanly on re-run —
    // already-synced items are skipped).
    retries: 10,
    // One backfill per company at a time — stops a double-click (or a full run
    // overlapping an incremental reconcile) from racing on the "already synced"
    // check and double-exporting.
    concurrency: { key: "event.data.companyId", limit: 1 },
    // The cancel route records `cancelled` (with who cancelled) on the run row
    // BEFORE firing this event, so the killed run needs no cleanup of its own.
    cancelOn: [
      {
        event: "carbon/onshape-backfill.cancel",
        if: "async.data.runId == event.data.runId"
      }
    ],
    // Terminal failure is an explicit write, never inferred from the run's absence.
    onFailure: async ({ event }) => {
      const { companyId, userId, runId } = event.data.event
        .data as OnshapeBackfillPayload;
      await finalizeRun(getCarbonServiceRole(), {
        companyId,
        userId,
        runId,
        status: "failed",
        error: event.data.error.message
      });
    }
  },
  { event: "carbon/onshape-backfill" },
  async ({ event, step }) => {
    const payload = OnshapeBackfillPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();
    // Absent on events queued before sync tracking existed — those runs do all
    // of the syncing and none of the tracking.
    const runId = payload.runId;

    // Gate check runs on every execution (not inside a step) so flipping the
    // toggle off also kills an in-flight retry.
    if (!(await isOnshapeAssetSyncEnabled(carbon, payload.companyId))) {
      console.log("onshape-backfill: skipped (disabled or inactive)", {
        companyId: payload.companyId
      });
      // Close the run row out rather than leaving it `queued` forever — a
      // non-terminal run blocks every later start (the 409 guard yields only to
      // an explicit terminal state).
      if (runId) {
        await step.run("finalize-run-disabled", () =>
          finalizeRun(carbon, {
            companyId: payload.companyId,
            userId: payload.userId,
            runId,
            status: "failed",
            error: "Onshape asset sync is turned off — the sync did not run."
          })
        );
      }
      return { skipped: true as const };
    }

    if (runId) {
      await step.run("mark-run-running", () =>
        markRunRunning(carbon, {
          companyId: payload.companyId,
          userId: payload.userId,
          runId
        })
      );
    }

    const onshapeCompanyId =
      payload.onshapeCompanyId ??
      (await step.run("resolve-onshape-company", () =>
        resolveOnshapeCompanyId(carbon, payload)
      ));
    const input = { ...payload, onshapeCompanyId };

    // Single accumulator for both the run row's counters and this function's
    // return value. Folded from memoized step results only, so it rebuilds
    // identically on every replay of the function body.
    let runProgress = createRunProgress();
    // A failure streak means something systemic (auth, sustained rate limiting,
    // outage) — abort instead of marching the whole catalog burning quota.
    let consecutiveFailures = 0;
    // Follow Onshape's `next` cursor page by page (offset paging is capped at 100).
    let cursor: string | null = null;
    let pageIndex = 0;

    while (true) {
      const currentCursor: string | null = cursor;
      // Fast memoized step: list one page + match locally. No exports in here.
      const pageResult: OnshapeBackfillPageResult = await step.run(
        `backfill-page-${pageIndex}`,
        () => matchOnshapeBackfillPage(carbon, input, currentCursor)
      );

      runProgress = accumulateRunCounters(runProgress, {
        pagesProcessed: 1,
        revisionsScanned: pageResult.revisionsScanned,
        // Matched = every release resolved to exactly one item, whether it needs
        // an export or already has the asset.
        matched:
          pageResult.workItems.length + pageResult.observedMatches.length,
        skippedNoItem: pageResult.skippedNoItem,
        skippedAlreadySynced: pageResult.skippedAlreadySynced,
        skippedNonModel: pageResult.skippedNonModel
      });
      runProgress = captureUnmatchedReleases(
        runProgress,
        pageResult.unmatchedReleases
      );
      runProgress = captureAmbiguousReleases(
        runProgress,
        pageResult.ambiguousReleases
      );

      if (runId && pageResult.observedMatches.length > 0) {
        await step.run(`observed-page-${pageIndex}`, () =>
          recordObservedMatches(carbon, input, pageResult.observedMatches)
        );
      }

      // One memoized step per matched export+attach, so each Inngest HTTP call
      // stays short and a retry resumes at the first unfinished item. A step
      // that exhausts its own retries throws a catchable error here; count it
      // and keep going unless failures look systemic.
      const optimizeModelUploadIds: string[] = [];
      const syncedModelUploadIds: string[] = [];
      for (const [workIndex, workItem] of pageResult.workItems.entries()) {
        try {
          const attached = await step.run(
            `sync-page-${pageIndex}-item-${workIndex}`,
            () => syncBackfillWorkItemWithState(carbon, input, workItem)
          );
          consecutiveFailures = 0;
          runProgress = accumulateRunCounters(
            runProgress,
            attached.skippedTooLarge ? { skippedTooLarge: 1 } : { synced: 1 }
          );
          // Every attached model is a RAW export — the assembler compresses it
          // into the viewer GLB via model-optimize.
          if (attached.modelUploadId) {
            optimizeModelUploadIds.push(attached.modelUploadId);
          }
          // Fallback only: models whose Onshape-rendered thumbnail was stored
          // during the sync don't need the screenshot pipeline.
          if (attached.modelUploadId && !attached.thumbnailAttached) {
            syncedModelUploadIds.push(attached.modelUploadId);
          }
        } catch (syncError) {
          console.error(
            `onshape-backfill: ${workItem.label} failed`,
            syncError
          );
          runProgress = accumulateRunCounters(runProgress, { failed: 1 });
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            throw new Error(
              `onshape-backfill: aborting after ${consecutiveFailures} consecutive failures; last error: ${
                syncError instanceof Error
                  ? syncError.message
                  : String(syncError)
              }`
            );
          }
        }
      }

      if (optimizeModelUploadIds.length > 0) {
        // Same event the manual upload route fires: assembler → meshopt GLB.
        await step.sendEvent(
          `model-optimize-${pageIndex}`,
          optimizeModelUploadIds.map((modelUploadId) => ({
            name: "carbon/model-optimize" as const,
            data: {
              modelUploadId,
              companyId: payload.companyId,
              userId: payload.userId
            }
          }))
        );
      }

      if (syncedModelUploadIds.length > 0) {
        // Every other model path fires model-thumbnail on upload; keep parity.
        await step.sendEvent(
          `model-thumbnails-${pageIndex}`,
          syncedModelUploadIds.map((modelId) => ({
            name: "carbon/model-thumbnail" as const,
            data: { companyId: payload.companyId, modelId }
          }))
        );
      }

      if (runId) {
        // One memoized progress write per page — the memoization IS the dedupe,
        // so a replaying body never rewrites a page's progress.
        const pageProgress = runProgress;
        await step.run(`progress-page-${pageIndex}`, () =>
          writeRunProgress(carbon, {
            companyId: payload.companyId,
            userId: payload.userId,
            runId,
            progress: pageProgress
          })
        );
      }

      if (!pageResult.hasMore || !pageResult.nextCursor) {
        break;
      }
      cursor = pageResult.nextCursor;
      pageIndex++;
    }

    if (runId) {
      const finalProgress = runProgress;
      await step.run("finalize-run", () =>
        finalizeRun(carbon, {
          companyId: payload.companyId,
          userId: payload.userId,
          runId,
          status: "completed",
          progress: finalProgress
        })
      );
    }

    return {
      revisionsScanned: runProgress.revisionsScanned,
      synced: runProgress.synced,
      skippedNoItem: runProgress.skippedNoItem,
      skippedAlreadySynced: runProgress.skippedAlreadySynced,
      skippedNonModel: runProgress.skippedNonModel,
      skippedTooLarge: runProgress.skippedTooLarge, // export exceeds Carbon's upload limits
      failed: runProgress.failed
    };
  }
);
