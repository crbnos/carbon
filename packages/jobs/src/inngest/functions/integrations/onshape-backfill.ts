import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  getOnshapeClient,
  OnshapeApiError,
  OnshapeAssetTooLargeError
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
}

// One matched export+attach, produced by the page-match step and executed as
// its own Inngest step.
export interface OnshapeBackfillWorkItem {
  kind: "model" | "drawing";
  label: string; // for logs, e.g. "model PRT-002033 rev A"
  itemId: string; // resolved Carbon item
  documentId: string;
  versionId: string;
  elementId: string;
  modelElementKind?: "partstudio" | "assembly"; // kind === "model" only
  assetBaseName?: string;
}

export interface OnshapeBackfillPageResult {
  revisionsScanned: number;
  skippedNoItem: number; // released in Onshape but no matching Carbon item (link-only)
  skippedAlreadySynced: number; // item already has this asset — skipped to save API calls
  skippedNonModel: number; // unknown element type (not part studio / assembly / drawing)
  workItems: OnshapeBackfillWorkItem[]; // matched exports for the per-item sync steps
  hasMore: boolean;
  nextCursor: string | null; // Onshape `next` cursor URL for the following page
}

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

// Does this item already have a drawing PDF attached? Lets the backfill skip
// re-exporting a drawing it already has (Onshape API quota is limited).
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

  for (const revision of revisions) {
    result.revisionsScanned++;

    // DRAWING (elementType 2): released as its own DRW-xxxx element. Attach its
    // PDF to the model item sharing its number (PRT/ASM); never create a DRW item.
    if (revision.elementType === 2) {
      const suffix = sharedNumberSuffix(revision.partNumber);
      if (suffix.length < 2) {
        result.skippedNoItem++;
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
        continue;
      }
      // Already has a drawing PDF => skip the export (save an Onshape call).
      if (await itemHasPdfDocument(carbon, input.companyId, target.id)) {
        result.skippedAlreadySynced++;
        continue;
      }
      result.workItems.push({
        kind: "drawing",
        label: `drawing ${revision.partNumber} rev ${revision.revision}`,
        itemId: target.id,
        documentId: revision.documentId,
        versionId: revision.versionId,
        elementId: revision.elementId,
        assetBaseName: target.readableIdWithRevision ?? undefined
      });
      continue;
    }

    // MODEL (elementType 0 = part studio, 1 = assembly). Anything else is an
    // element type we don't export.
    if (revision.elementType !== 0 && revision.elementType !== 1) {
      result.skippedNonModel++;
      continue;
    }
    const match = itemByKey.get(
      releaseKey(revision.partNumber, revision.revision)
    );
    if (!match) {
      result.skippedNoItem++;
      continue;
    }
    // Already has a model => skip the export (save an Onshape call).
    if (match.modelUploadId) {
      result.skippedAlreadySynced++;
      continue;
    }
    result.workItems.push({
      kind: "model",
      label: `model ${revision.partNumber} rev ${revision.revision}`,
      itemId: match.id,
      documentId: revision.documentId,
      versionId: revision.versionId,
      elementId: revision.elementId,
      modelElementKind: revision.elementType === 1 ? "assembly" : "partstudio",
      assetBaseName: releaseKey(revision.partNumber, revision.revision)
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

// --- Inngest function -------------------------------------------------------
// CONFIGURABLE: runs only when the company has explicitly enabled Onshape asset
// sync (companyIntegration.metadata.assetSyncEnabled === true) and the integration
// is active. Default is OFF — nothing runs unless turned on. Fired via
// trigger("onshape-backfill", { companyId, userId, after? }).

const OnshapeBackfillPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  onshapeCompanyId: z.string().optional(),
  after: z.string().optional(),
  pageLimit: z.number().optional()
});

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
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/onshape-backfill" },
  async ({ event, step }) => {
    const payload = OnshapeBackfillPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Gate check runs on every execution (not inside a step) so flipping the
    // toggle off also kills an in-flight retry.
    if (!(await isOnshapeAssetSyncEnabled(carbon, payload.companyId))) {
      console.log("onshape-backfill: skipped (disabled or inactive)", {
        companyId: payload.companyId
      });
      return { skipped: true as const };
    }

    const onshapeCompanyId =
      payload.onshapeCompanyId ??
      (await step.run("resolve-onshape-company", () =>
        resolveOnshapeCompanyId(carbon, payload)
      ));
    const input = { ...payload, onshapeCompanyId };

    const totals = {
      revisionsScanned: 0,
      synced: 0,
      skippedNoItem: 0,
      skippedAlreadySynced: 0,
      skippedNonModel: 0,
      skippedTooLarge: 0, // export exceeds Carbon's upload limits
      failed: 0
    };
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

      totals.revisionsScanned += pageResult.revisionsScanned;
      totals.skippedNoItem += pageResult.skippedNoItem;
      totals.skippedAlreadySynced += pageResult.skippedAlreadySynced;
      totals.skippedNonModel += pageResult.skippedNonModel;

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
            () => syncOnshapeBackfillWorkItem(carbon, input, workItem)
          );
          consecutiveFailures = 0;
          if (attached.skippedTooLarge) {
            totals.skippedTooLarge++;
          } else {
            totals.synced++;
          }
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
          totals.failed++;
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

      if (!pageResult.hasMore || !pageResult.nextCursor) {
        break;
      }
      cursor = pageResult.nextCursor;
      pageIndex++;
    }

    return totals;
  }
);
