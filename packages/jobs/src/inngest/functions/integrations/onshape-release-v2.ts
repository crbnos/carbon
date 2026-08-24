// Onshape v2 release handling.
//
// One job for the whole `onshape.revision.created` event on a v2 company: it
// attaches the released geometry and, when configured to, brings the release
// into Carbon's engineering data. The legacy pipeline splits these across two
// jobs, which races — for a NEW revision the target item does not exist until
// the import creates it, so a parallel asset job resolves "revision-missing"
// and the model never lands. Doing both here, in order, removes the race.
//
// What makes it v2 rather than a copy of the legacy job: the Carbon part is
// resolved through the ELEMENT MAPPING, never by matching Onshape's part number
// against readableId. The mapping answers "which Carbon part family is this CAD
// thing"; the released revision letter then picks the member.
//
// The webhook cannot carry a partId (its payload has no such field), and one
// Part Studio holds many bodies behind ONE element id — so a Part Studio
// release is fanned out over every body whose revision matches, rather than
// assumed to be a single item.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { OnshapeClient, OnshapeReleasePackage } from "@carbon/ee/onshape";
import {
  buildOnshapeItemNotesBlock,
  getOnshapeClient,
  getOnshapeV2Settings,
  ONSHAPE_V2_INTEGRATION_ID,
  readItemIdsForElement,
  readReleasePackageName,
  readReleasePackageNotes,
  resolveBomRow,
  resolveDrawingModelItem,
  writeElementMapping,
  writeOnshapeItemNotes,
  writeRevisionMapping
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { RetryAfterError } from "inngest";
import { z } from "zod";
import { inngest } from "../../client";
import { withRateLimitRetry } from "./onshape-backfill";
import { pullOnshapeDrawingsForDocument } from "./onshape-drawings";
import { mintDefaultsForRelease } from "./onshape-mint";
import { runOnshapeReleaseImport } from "./onshape-release-import";
import { resolveReleasedRevision } from "./onshape-release-revision";
import { readOnshapePurchasingLevel } from "./onshape-replenishment";
import { syncOnshapeDrawingAssetsToItem } from "./onshape-sync-element";
import {
  isTransientExportError,
  pullOnshapeAssetsForElement
} from "./onshape-v2-assets";

const PayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  messageId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  elementType: z.number(),
  partNumber: z.string(),
  revisionId: z.string().optional(),
  releaseId: z.string().optional(),
  releaseName: z.string().optional(),
  revision: z.string().optional(),
  /**
   * releaseId when present, else elementId — the concurrency bucket Inngest
   * reads off the event.
   *
   * OPTIONAL here on purpose. Inngest evaluates the key itself, so the job
   * never reads this field; making it required would only mean an event queued
   * before the field existed fails to parse on delivery, which is a worse
   * outcome than the empty key it would otherwise get.
   */
  groupKey: z.string().optional()
});

const ELEMENT_TYPE_PART_STUDIO = 0;
const ELEMENT_TYPE_DRAWING = 2;

/** How many refusals to name in one notification before it stops reading. */
const MAX_REPORTED_SKIPS = 5;

/**
 * Tell the user why something was refused.
 *
 * A release is webhook-driven: nobody is watching a screen when it runs, so a
 * refusal recorded only in the Inngest return value reaches no one — the user
 * finds out when a revision turns out to have no model, no drawing, or no
 * change notice, with nothing anywhere saying why.
 */
async function notifyOnshapeSkips(
  payload: {
    companyId: string;
    userId: string;
    partNumber: string;
    revision?: string;
  },
  reasons: string[]
): Promise<void> {
  if (reasons.length === 0) return;
  if (!payload.userId || payload.userId === "system") return;
  try {
    await trigger("notify", {
      event: NotificationEvent.IntegrationSync,
      companyId: payload.companyId,
      documentId: "onshape",
      title:
        `Onshape release ${payload.partNumber} ${payload.revision ?? ""} needs attention`.trim(),
      body: reasons.slice(0, MAX_REPORTED_SKIPS).join("; "),
      recipient: { type: "user", userId: payload.userId }
    });
  } catch (error) {
    console.error(
      `[ONSHAPE RELEASE V2] ${payload.companyId}: could not notify ${payload.userId}`,
      error
    );
  }
}

/**
 * The released revision LETTER for this delivery.
 *
 * Onshape's webhook does NOT carry it — only `revisionId` — so it usually costs
 * one lookup. See `onshape-release-revision.ts` for the captured payload and
 * why the letter is never guessed at. Wrapped in `withRateLimitRetry` so a 429
 * reschedules the run rather than silently reading as "no revision".
 */
function readReleasedRevision(
  client: OnshapeClient,
  payload: { revision?: string; revisionId?: string }
): Promise<string> {
  return resolveReleasedRevision(payload, (revisionId) =>
    withRateLimitRetry(
      () => client.getRevision(revisionId),
      `revision ${revisionId}`
    )
  );
}

export const onshapeReleaseV2Function = inngest.createFunction(
  {
    id: "onshape-release-v2",
    // Every 429 reschedule consumes a retry, and this job both exports and
    // imports.
    retries: 10,
    idempotency: "event.data.messageId",
    // One in-flight run per RELEASE. Onshape has no release-level event: a
    // 9-element release arrives as 9 separate deliveries, and they all compete
    // to create the SAME change notice — the marker row is the claim, and
    // serializing on the release is what keeps the losers from racing into
    // duplicate Draft notices. Keying on the element lets siblings run at once,
    // which is the exact race the legacy job's releaseId key exists to prevent.
    // `groupKey` is releaseId when there is one, so a delivery without one
    // cannot collapse every company's releases into one bucket.
    concurrency: { key: "event.data.groupKey", limit: 1 }
  },
  { event: "carbon/onshape-release-v2" },
  async ({ event, step }) => {
    const payload = PayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    const settings = await getOnshapeV2Settings(carbon, payload.companyId);
    if (settings.readFailed) {
      throw new Error(
        "Could not read the Onshape integration settings; retrying."
      );
    }
    // The `onshape-v2` record itself is the opt-in: an absent or inactive one
    // means this company never installed v2. No pipeline field to read.
    if (!settings.active) {
      return { skipped: true as const, reason: "integration-not-installed" };
    }

    // A released DRAWING is its own element sharing the number of the model it
    // documents; it is never its own Carbon item. So it takes its own branch and
    // must NEVER reach runOnshapeReleaseImport — a drawing as a second affected
    // item violates UNIQUE(changeOrderId, itemId) on the first import of an
    // ordinary release, and deriving a change type from its readableId would
    // mint a junk DRW-xxxx part.
    //
    // The join is an id lookup through the element mapping, not v1's part-number
    // suffix match (which is disproved on real data: RD-410, DRW-410 and PK-410
    // all reduce to "-410", matching five items across two parts).
    if (payload.elementType === ELEMENT_TYPE_DRAWING) {
      if (!settings.attachAssetsOnRelease) {
        return { skipped: true as const, reason: "drawing-assets-disabled" };
      }
      return await step.run("handle-drawing", async () => {
        const connection = await getOnshapeClient(
          carbon,
          payload.companyId,
          payload.userId,
          ONSHAPE_V2_INTEGRATION_ID
        );
        if (!connection.client) {
          throw new Error(connection.error ?? "Onshape is not connected");
        }

        // Narrowing the model's revision family needs the LETTER, which the
        // webhook does not send. Without this the drawing branch resolved
        // against "" and could only ever match a revision-'0' member.
        const releasedRevision = await readReleasedRevision(
          connection.client as OnshapeClient,
          payload
        );

        const resolved = await withRateLimitRetry(
          () =>
            resolveDrawingModelItem(
              connection.client as OnshapeClient,
              carbon,
              {
                companyId: payload.companyId,
                documentId: payload.documentId,
                wvm: "v",
                wvmId: payload.versionId,
                drawingElementId: payload.elementId,
                releasedRevision
              }
            ),
          `drawing references for ${payload.partNumber}`
        );

        if (!resolved.ok) {
          await notifyOnshapeSkips({ ...payload, revision: releasedRevision }, [
            resolved.message
          ]);
          return {
            skipped: true as const,
            reason: resolved.reason,
            message: resolved.message
          };
        }

        // Name the document after the ITEM, not after the drawing's own part
        // number. The PDF lives on the model item, and the same drawing can
        // arrive either as its own release (this branch) or through a model
        // release's drawing pass — naming it two ways would file the same
        // drawing as two documents on one item, since the attach helper
        // de-duplicates on the storage path.
        const target = await carbon
          .from("item")
          .select("readableIdWithRevision")
          .eq("id", resolved.itemId)
          .eq("companyId", payload.companyId)
          .maybeSingle();
        const assetBaseName =
          target.data?.readableIdWithRevision ??
          (releasedRevision
            ? `${payload.partNumber}.${releasedRevision}`
            : payload.partNumber);

        try {
          await withRateLimitRetry(
            () =>
              syncOnshapeDrawingAssetsToItem(carbon, {
                integrationId: ONSHAPE_V2_INTEGRATION_ID,
                client: connection.client as OnshapeClient,
                companyId: payload.companyId,
                userId: payload.userId,
                itemId: resolved.itemId,
                sourceDocument: "Part",
                documentId: payload.documentId,
                versionId: payload.versionId,
                drawingElementId: payload.elementId,
                assetBaseName
              }),
            `drawing PDF for ${payload.partNumber}`
          );
        } catch (error) {
          if (isTransientExportError(error)) throw error;
          const message =
            error instanceof Error
              ? error.message
              : "Could not export this Onshape drawing.";
          await notifyOnshapeSkips({ ...payload, revision: releasedRevision }, [
            message
          ]);
          return {
            skipped: true as const,
            reason: "drawing-export-failed",
            message
          };
        }

        return {
          skipped: false as const,
          drawingAttachedTo: resolved.itemId
        };
      });
    }

    return await step.run("handle-release", async () => {
      const connection = await getOnshapeClient(
        carbon,
        payload.companyId,
        payload.userId,
        ONSHAPE_V2_INTEGRATION_ID
      );
      if (!connection.client) {
        throw new Error(connection.error ?? "Onshape is not connected");
      }
      const client = connection.client;

      // The letter, looked up from `revisionId` because the webhook does not
      // send it. The client is built FIRST for exactly this reason.
      const releasedRevision = await readReleasedRevision(client, payload);

      // A release ALWAYS names a revision. Reaching here without one means both
      // the event and the lookup came up empty — and treating that as the
      // initial revision would resolve the family to its revision-'0' member
      // and stamp the released geometry onto the item that predates every
      // release.
      if (!releasedRevision) {
        return {
          skipped: true as const,
          reason: "revision-missing-from-event"
        };
      }

      // Recover the partId(s) the webhook cannot carry. A Part Studio release
      // fans out: N bodies behind one element id are N Carbon items.
      let onshapeCompanyId = settings.onshapeCompanyId;
      if (!onshapeCompanyId) {
        const companies = await client.getCompanies();
        onshapeCompanyId = Array.isArray(companies)
          ? (companies[0]?.id ?? null)
          : null;
      }

      // The release package — the ONLY source of the release name and notes.
      // Fetched once per run and reused for every partId in the fan-out and by
      // the importer, so a 7-body Part Studio release costs one call, not seven.
      //
      // Non-fatal: provenance is worth a call, never worth failing a release
      // that has already produced correct items and geometry. A rate limit is
      // the exception and is rethrown by withRateLimitRetry.
      let releasePackage: OnshapeReleasePackage | undefined;
      if (payload.releaseId) {
        try {
          releasePackage = await withRateLimitRetry(
            () => client.getReleasePackage(payload.releaseId as string),
            `release package ${payload.releaseId}`
          );
        } catch (error) {
          if (error instanceof RetryAfterError) throw error;
          console.warn(
            `[ONSHAPE RELEASE V2] could not read release package ${payload.releaseId}`,
            error
          );
        }
      }

      const releaseName =
        readReleasePackageName(releasePackage) ?? payload.releaseName ?? null;
      const releaseNotes = readReleasePackageNotes(releasePackage);

      const partIds: Array<string | null> = [];
      if (onshapeCompanyId) {
        const revisions = await withRateLimitRetry(
          () =>
            client.getRevisions(
              onshapeCompanyId as string,
              payload.partNumber,
              payload.elementType
            ),
          `revisions for ${payload.partNumber}`
        );
        const candidates = revisions.items ?? [];

        // FIRST by revisionId, which the webhook carries and which identifies
        // this exact released revision on its own. Matching on
        // elementId + revision letter alone fails for a component pulled from a
        // LINKED document, whose revision entry names the SOURCE element rather
        // than the one the event reports — and a failed match here is what
        // sends a legitimate release into the refusal below.
        const exact = payload.revisionId
          ? candidates.filter((item) => item.id === payload.revisionId)
          : [];

        const matched =
          exact.length > 0
            ? exact
            : candidates.filter(
                (item) =>
                  item.elementId === payload.elementId &&
                  item.revision === releasedRevision
              );

        for (const item of matched) {
          partIds.push(item.partId ?? null);
        }
      }
      if (partIds.length === 0) {
        // A PART STUDIO release whose body we cannot identify is NOT actionable.
        //
        // The element-level ref (`doc:element`, no partId) addresses the STUDIO,
        // and a studio holds N bodies — it is not an item. Falling back to it
        // makes every unresolvable release from one studio address the SAME
        // ref, so they collapse onto one Carbon item: observed live, a second
        // part's geometry silently overwriting the first's, and with
        // auto-create on the bad mapping is minted and made permanent.
        //
        // Reachable in production even though a real release names a revision:
        // a failed or rate-limited getRevisions, a null onshapeCompanyId, or a
        // component pulled from a linked document all leave this list empty.
        //
        // An ASSEMBLY element IS one item, so a null partId is correct there.
        if (payload.elementType === ELEMENT_TYPE_PART_STUDIO) {
          const reason = `Onshape did not report which body of this part studio ${payload.partNumber} revision ${releasedRevision} refers to, so Carbon cannot tell which part it is. Import the assembly's bill of materials instead — that route reads the body ids from the BOM and does not depend on this lookup.`;
          await notifyOnshapeSkips({ ...payload, revision: releasedRevision }, [
            reason
          ]);
          return {
            skipped: true as const,
            reason: "part-studio-body-unresolved",
            message: reason
          };
        }
        partIds.push(null);
      }

      const attached: string[] = [];
      const imported: string[] = [];
      /** What Carbon ASSUMED about each part it minted, in the user's words. */
      const created: string[] = [];
      const skipped: Array<{ partId: string | null; reason: string }> = [];

      for (const partId of partIds) {
        const ref = {
          documentId: payload.documentId,
          elementId: payload.elementId,
          partId
        };

        // Set only when auto-create mints a part on this iteration. It short-
        // circuits the resolution below, which would otherwise re-read an
        // element mapping that describes the item we just made.
        let mintedItemId: string | null = null;

        const claimants = await readItemIdsForElement(carbon, {
          companyId: payload.companyId,
          ref
        });

        if (claimants.length === 0) {
          if (!settings.createItemsOnRelease) {
            // The default. Creating items is the BOM import's and the create
            // flow's job, where a human chose the replenishment and tracking a
            // release cannot tell us.
            skipped.push({
              partId,
              reason:
                "No Carbon item is linked to this Onshape part. Link it, or import its assembly, first."
            });
            continue;
          }

          // AUTO-CREATE. The company has accepted that Carbon will guess the
          // fields a release cannot carry, and be told what it guessed.
          //
          // No mapping exists — but that does NOT mean the part number is free.
          // An unmapped Carbon item at the same readableId is invisible to
          // readItemIdsForElement, and every item the LEGACY pipeline created is
          // exactly that. item_unique is on the RAW revision column and Postgres
          // treats NULL as distinct, so inserting 'A' against an existing '' or
          // NULL row raises no conflict and silently produces a second family
          // member with no lineage. Probe the family by number first, the same
          // way the BOM import does.
          const siblings = await carbon
            .from("item")
            .select("id, revision")
            .eq("readableId", payload.partNumber)
            .eq("type", "Part")
            .eq("companyId", payload.companyId);
          if (siblings.error) {
            throw new Error(
              `Could not check for existing parts numbered ${payload.partNumber}: ${siblings.error.message}`
            );
          }

          if ((siblings.data ?? []).length > 0) {
            skipped.push({
              partId,
              reason: `Carbon already has a part numbered ${payload.partNumber} that is not linked to Onshape. Link it instead, so its revisions stay one family.`
            });
            continue;
          }

          // Ask Onshape what it thinks this part is before guessing. The
          // release carries no BOM, so "Purchasing Level" — the company-defined
          // column the legacy integration reads — has to come from the
          // element's metadata. Most companies do not define it, in which case
          // this is one cheap call that returns nothing and the element type
          // decides instead.
          //
          // Non-fatal: a failed metadata read must not stop a part being
          // created, it only costs the better answer.
          let purchasingLevel: string | null = null;
          try {
            // PART level when this is a Part Studio body, element level
            // otherwise. A company property scoped to the Part category lives
            // on the BODY: with it set on one body, the element-level read
            // returns nothing at all, so reading the element here would make
            // the whole feature silently inert for every Part Studio part.
            const metadata = await withRateLimitRetry(
              () =>
                partId
                  ? client.getPartMetadata(
                      payload.documentId,
                      payload.versionId,
                      payload.elementId,
                      partId
                    )
                  : client.getElementMetadata(
                      payload.documentId,
                      payload.versionId,
                      payload.elementId
                    ),
              `metadata for ${payload.partNumber}`
            );
            const columns: Record<string, string> = {};
            for (const property of metadata?.properties ?? []) {
              if (typeof property?.name !== "string") continue;
              if (typeof property?.value !== "string") continue;
              columns[property.name] = property.value;
            }
            purchasingLevel = readOnshapePurchasingLevel(columns);
          } catch (error) {
            if (error instanceof RetryAfterError) throw error;
            console.warn(
              `[ONSHAPE RELEASE V2] could not read element metadata for ${payload.partNumber}`,
              error
            );
          }

          const defaults = mintDefaultsForRelease({
            elementType: payload.elementType,
            partNumber: payload.partNumber,
            purchasingLevel
          });

          const minted = await carbon
            .from("item")
            .insert({
              readableId: payload.partNumber,
              revision: releasedRevision,
              name: payload.partNumber,
              type: "Part",
              replenishmentSystem: defaults.replenishmentSystem,
              defaultMethodType: defaults.defaultMethodType,
              itemTrackingType: defaults.itemTrackingType,
              unitOfMeasureCode: defaults.unitOfMeasureCode,
              active: true,
              companyId: payload.companyId,
              createdBy: payload.userId
            })
            .select("id")
            .single();

          if (minted.error || !minted.data) {
            throw new Error(
              `Could not create ${payload.partNumber} from the Onshape release: ${minted.error?.message ?? "no row returned"}`
            );
          }

          // MANDATORY. The `parts` view inner-joins `part`, so an item with no
          // part row is invisible everywhere in the app.
          const partRow = await carbon.from("part").upsert({
            id: payload.partNumber,
            companyId: payload.companyId,
            createdBy: payload.userId
          });
          if (partRow.error) {
            throw new Error(
              `Created ${payload.partNumber} but failed to write its part row: ${partRow.error.message}`
            );
          }

          await writeElementMapping(carbon, {
            companyId: payload.companyId,
            itemId: minted.data.id,
            ref,
            metadata: {
              versionId: payload.versionId,
              partNumber: payload.partNumber,
              fromUnreleasedVersion: false,
              lastSyncedAt: new Date().toISOString(),
              replenishment: {
                source: defaults.replenishmentSource,
                seededSystem: defaults.replenishmentSystem,
                seededMethodType: defaults.defaultMethodType,
                purchasingLevel,
                seededAt: new Date().toISOString()
              }
            },
            createdBy: payload.userId
          });
          if (payload.revisionId) {
            await writeRevisionMapping(carbon, {
              companyId: payload.companyId,
              itemId: minted.data.id,
              revisionId: payload.revisionId,
              metadata: {
                documentId: payload.documentId,
                versionId: payload.versionId,
                elementId: payload.elementId,
                revision: releasedRevision,
                releaseId: payload.releaseId,
                releaseName: payload.releaseName
              },
              createdBy: payload.userId
            });
          }

          created.push(defaults.assumption);
          // Carry on into the normal flow: provenance and geometry both land on
          // the item just created, and a creation is NOT a change, so it must
          // never reach runOnshapeReleaseImport.
          mintedItemId = minted.data.id;
        }

        const items = mintedItemId
          ? { data: [], error: null }
          : await carbon
              .from("item")
              .select("id, readableId, revision")
              .in("id", claimants)
              .eq("companyId", payload.companyId);
        if (items.error) {
          throw new Error(
            `Failed to read linked items: ${items.error.message}`
          );
        }

        // Existence-checked: entityId has no FK to item, so a deleted item
        // leaves its mapping behind and would otherwise read as revision null.
        const live = items.data ?? [];
        if (!mintedItemId && live.length === 0) {
          skipped.push({
            partId,
            reason:
              "The Carbon item this Onshape part was linked to no longer exists."
          });
          continue;
        }

        const resolution = resolveBomRow(
          releasedRevision,
          live.map((i) => ({ itemId: i.id, revision: i.revision }))
        );

        let targetItemId: string | null =
          mintedItemId ??
          (resolution.kind === "matched" ? resolution.itemId : null);

        if (
          !mintedItemId &&
          !targetItemId &&
          settings.releaseImportV2 !== "off"
        ) {
          // The release is NEW to Carbon. The family is known from the
          // mapping, so the importer is given that family's own readableId
          // rather than Onshape's part number — the join stays id-derived even
          // though the proven import path takes a number.
          // The family's members are supposed to share a readableId — that is
          // what makes them a revision family. When they do not, the mapping is
          // pointing at two different parts, and picking whichever row came
          // back first silently imports the release against one of them.
          const readableIds = Array.from(
            new Set(
              live
                .map((i) => i.readableId)
                .filter((id): id is string => Boolean(id))
            )
          );
          const familyReadableId =
            readableIds.length === 1 ? readableIds[0] : undefined;
          if (readableIds.length > 1) {
            skipped.push({
              partId,
              reason: `This Onshape part is linked to Carbon items with different numbers (${readableIds.join(", ")}), so which one the release belongs to is ambiguous. Unlink the wrong one.`
            });
          }
          if (familyReadableId && payload.releaseId) {
            const result = await runOnshapeReleaseImport(carbon, {
              companyId: payload.companyId,
              userId: payload.userId,
              // v2's own record: this delegation shares the importer's body, not
              // the legacy record's grant.
              integrationId: ONSHAPE_V2_INTEGRATION_ID,
              messageId: payload.messageId,
              releaseId: payload.releaseId,
              // ONSHAPE's number, because the importer feeds it to Onshape's
              // /revisions/companies/{id}/partnumber/{n} lookup. Substituting
              // Carbon's readableId there asks Onshape about a part number that
              // may belong to something else — and a mismatch between the two
              // is legal in v2, where the mapping is the join and the number is
              // only a label.
              partNumber: payload.partNumber,
              // CARBON's number, used only to resolve the revision family.
              carbonReadableId: familyReadableId,
              documentId: payload.documentId,
              versionId: payload.versionId,
              elementId: payload.elementId,
              elementType: payload.elementType,
              revisionId: payload.revisionId,
              revision: releasedRevision,
              releaseName: payload.releaseName,
              onshapeCompanyId: onshapeCompanyId ?? undefined,
              // Reuse the package this run already fetched, and let the
              // importer write Onshape's own words rather than Carbon's
              // provenance sentence. Legacy callers pass neither.
              releasePackage,
              writeProvenance: true,
              // The decision is ALREADY made, by v2's own settings. Letting the
              // importer re-read them would read the LEGACY keys, which a v2
              // company necessarily has off — so v2 release import would refuse
              // itself as "disabled".
              gate: {
                enabled: true,
                mode:
                  settings.releaseImportV2 === "revision"
                    ? "revision"
                    : "changeNotice"
              }
            });
            if (result.imported) {
              imported.push(familyReadableId);

              // The import CREATED the item this release represents, so the
              // target has to be re-resolved — it was null a moment ago by
              // definition. Without this the attach below never runs, and
              // `items_createRevision` copies the source revision's
              // modelUploadId and thumbnailPath, so the new revision does not
              // merely lack geometry: it silently displays the PREVIOUS
              // revision's, presented as the released one.
              const createdItemId = result.newItemId ?? result.itemId ?? null;
              if (createdItemId) {
                targetItemId = createdItemId;

                // Link what was just created, or v2 stays blind to it: the next
                // release resolves the family from the element mapping, and an
                // item that has none is invisible to every v2 path.
                await writeElementMapping(carbon, {
                  companyId: payload.companyId,
                  itemId: createdItemId,
                  ref,
                  metadata: {
                    versionId: payload.versionId,
                    partNumber: payload.partNumber,
                    fromUnreleasedVersion: false,
                    lastSyncedAt: new Date().toISOString()
                  },
                  createdBy: payload.userId
                });
                if (payload.revisionId) {
                  await writeRevisionMapping(carbon, {
                    companyId: payload.companyId,
                    itemId: createdItemId,
                    revisionId: payload.revisionId,
                    metadata: {
                      documentId: payload.documentId,
                      versionId: payload.versionId,
                      elementId: payload.elementId,
                      revision: releasedRevision,
                      releaseId: payload.releaseId,
                      releaseName: payload.releaseName
                    },
                    createdBy: payload.userId
                  });
                }
              } else {
                skipped.push({
                  partId,
                  reason:
                    "The release was imported but Carbon could not identify the item it created, so no model was attached."
                });
              }
            } else if (result.skippedReason) {
              skipped.push({ partId, reason: result.skippedReason });
            }
          } else if (!payload.releaseId) {
            skipped.push({
              partId,
              reason:
                "The release event carried no releaseId, so its elements cannot be grouped into one change notice."
            });
          }
        }

        // Attach geometry to whichever item now represents this revision. A
        // still-missing target means the import was off or refused — reported,
        // not silently dropped.
        if (!targetItemId && settings.releaseImportV2 === "off") {
          skipped.push({
            partId,
            reason: `Carbon has this part but not at revision ${releasedRevision || "(initial)"}, and release import is off.`
          });
        }

        // Provenance for EVERY item this release touched — including the
        // matched-existing-revision case, which never reaches the importer and
        // would otherwise be the one path that records nothing.
        //
        // Deliberately NOT inside the asset pull below: that is gated on
        // attachAssetsOnRelease, and a company with assets off would then get
        // no provenance either.
        if (targetItemId) {
          const notes = await writeOnshapeItemNotes(carbon, {
            companyId: payload.companyId,
            itemId: targetItemId,
            userId: payload.userId,
            block: buildOnshapeItemNotesBlock({
              releaseName,
              releaseNotes,
              partNumber: payload.partNumber,
              revision: releasedRevision,
              documentId: payload.documentId,
              versionId: payload.versionId,
              elementId: payload.elementId,
              partId,
              releaseId: payload.releaseId
            })
          });
          if (notes.orphanedStart) {
            skipped.push({
              partId,
              reason:
                "This item's notes carry an unterminated Onshape block, so the release details were appended instead of replacing it."
            });
          }
        }

        if (targetItemId && settings.attachAssetsOnRelease) {
          const pulled = await withRateLimitRetry(
            () =>
              pullOnshapeAssetsForElement(carbon, client, {
                companyId: payload.companyId,
                userId: payload.userId,
                documentId: payload.documentId,
                versionId: payload.versionId,
                elementId: payload.elementId,
                targets: [
                  {
                    itemId: targetItemId as string,
                    partId,
                    assetBaseName: releasedRevision
                      ? `${payload.partNumber}.${releasedRevision}`
                      : payload.partNumber
                  }
                ]
              }),
            `assets for ${payload.partNumber}`
          );
          for (const ok of pulled.attached) {
            attached.push(ok.itemId);
            // Same chain the legacy sync fires: relocates the raw to durable
            // storage and renders the thumbnail from the GLB.
            try {
              await trigger("model-optimize", {
                companyId: payload.companyId,
                modelUploadId: ok.modelUploadId,
                userId: payload.userId
              });
            } catch (error) {
              console.error(
                `[ONSHAPE RELEASE V2] could not queue optimisation for ${ok.modelUploadId}`,
                error
              );
            }
          }
          for (const bad of pulled.skipped) {
            skipped.push({ partId, reason: bad.reason });
          }

          // MODEL-FIRST: pick up this element's drawing without waiting for a
          // separate drawing release event. Onshape has no inverse of the
          // references endpoint, so this lists the document's drawings and
          // keeps the ones pointing back at this item.
          const drawings = await withRateLimitRetry(
            () =>
              pullOnshapeDrawingsForDocument(carbon, client, {
                integrationId: ONSHAPE_V2_INTEGRATION_ID,
                companyId: payload.companyId,
                userId: payload.userId,
                documentId: payload.documentId,
                versionId: payload.versionId,
                targets: [
                  {
                    elementId: payload.elementId,
                    itemId: targetItemId as string,
                    revision: releasedRevision,
                    assetBaseName: releasedRevision
                      ? `${payload.partNumber}.${releasedRevision}`
                      : payload.partNumber
                  }
                ]
              }),
            `drawings for ${payload.partNumber}`
          );
          for (const bad of drawings.skipped) {
            skipped.push({ partId, reason: bad.reason });
          }
        }
      }

      // Creations are reported alongside refusals, not instead of them. A
      // release that mints 12 parts with nobody watching and says nothing is
      // the failure mode auto-create introduces; naming what was assumed is the
      // only mitigation for guessing at all.
      await notifyOnshapeSkips({ ...payload, revision: releasedRevision }, [
        ...created,
        ...skipped.map((entry) => entry.reason)
      ]);

      return {
        skipped: false as const,
        attachedCount: attached.length,
        importedCount: imported.length,
        createdCount: created.length,
        skippedDetails: skipped
      };
    });
  }
);
