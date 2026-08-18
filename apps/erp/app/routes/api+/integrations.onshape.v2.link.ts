import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  getOnshapeClient,
  getOnshapeV2Settings,
  parseElementExternalId,
  readElementMappingsForItems,
  readItemIdForRevision,
  readItemIdsForElement,
  resolveOnshapeRevision,
  revisionsMatch,
  writeElementMapping,
  writeRevisionMapping
} from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/lib/trigger";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const logger = getLogger("erp", "integrations-onshape-v2-link");

// Linking an item that already exists is BOTH the adoption path for hand-built
// items and the migration path off the legacy integration, where items were
// matched by part number and carry no mapping at all.
//
// It is destructive by consent on the fields Onshape owns, so the caller must
// send `confirmOverwrite` — the UI shows what will be replaced first.
export const onshapeV2LinkValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  partNumber: z.string().min(1, { message: "Part number is required" }),
  revision: z.string().min(1, { message: "Revision is required" }),
  elementType: zfd.numeric(z.number()),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  elementId: z.string().min(1),
  partId: zfd.text(z.string().optional()),
  revisionId: zfd.text(z.string().optional()),
  confirmOverwrite: zfd.checkbox()
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(onshapeV2LinkValidator).validate(formData);

  if (validation.error) {
    return { success: false, message: "Invalid Onshape selection" };
  }

  const input = validation.data;

  if (!input.confirmOverwrite) {
    return {
      success: false,
      message:
        "Linking replaces the fields Onshape owns. Confirm the overwrite to continue."
    };
  }

  const serviceRole = getCarbonServiceRole();
  // The gate is company CONFIGURATION, not user data. Reading it with the
  // user's client silently requires settings_view on top of the parts
  // permission this route declares.
  const settings = await getOnshapeV2Settings(serviceRole, companyId);
  // A failed READ is not an opt-out. Wording a transient error as a
  // configuration state sends the user to change a setting that was
  // never wrong — and re-saving it re-registers the release webhook.
  if (settings.readFailed) {
    return {
      success: false,
      message: "Could not read the Onshape settings just now. Try again."
    };
  }
  if (!settings.isV2) {
    return {
      success: false,
      message: "Onshape v2 is not enabled for this company"
    };
  }

  // Scope the item to this company explicitly. These routes read with the
  // user's client so RLS already applies, but the check also produces a clear
  // message instead of a confusing downstream failure.
  const item = await client
    .from("item")
    .select("id, readableId, revision, name")
    .eq("id", input.itemId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (item.error || !item.data) {
    return { success: false, message: "Item not found" };
  }

  const ref = {
    documentId: input.documentId,
    elementId: input.elementId,
    partId: input.partId || null
  };
  const externalId = buildElementExternalId(ref);

  // Two directions of collision, both of which silently corrupt data if
  // allowed: another item already owns this CAD thing, or this item already
  // points at a DIFFERENT one.
  let claimedBy: string[];
  let existingForItem: Awaited<ReturnType<typeof readElementMappingsForItems>>;
  try {
    [claimedBy, existingForItem] = await Promise.all([
      readItemIdsForElement(client, { companyId, ref }),
      readElementMappingsForItems(client, {
        companyId,
        itemIds: [input.itemId]
      })
    ]);
  } catch (error) {
    logger.error("Failed to read existing Onshape mappings", { error });
    return {
      success: false,
      message: "Could not check existing Onshape links"
    };
  }

  const otherClaimants = claimedBy.filter((id) => id !== input.itemId);
  if (otherClaimants.length > 0) {
    // A conflict only exists at the SAME revision. One Onshape part maps to
    // every Carbon revision of it — which is precisely why the element mapping
    // allows duplicate externalIds — so EL-402.A and EL-402.C both claiming one
    // element is correct, not a collision.
    const others = await client
      .from("item")
      .select("id, revision, readableIdWithRevision")
      .in("id", otherClaimants)
      .eq("companyId", companyId);

    if (others.error) {
      logger.error("Failed to read competing Onshape claims", {
        error: others.error
      });
      return {
        success: false,
        message: "Could not check which items already claim this Onshape part"
      };
    }

    // Prefer the REVISION MAPPING as the authority: item.revision is Carbon's
    // own label and need not equal Onshape's, so comparing the two only works
    // while the numbering happens to agree. The mapping is the fact.
    let claimedByRevisionMapping: string | null = null;
    if (input.revisionId) {
      claimedByRevisionMapping = await readItemIdForRevision(client, {
        companyId,
        revisionId: input.revisionId
      });
    }

    const sameRevision =
      (claimedByRevisionMapping && claimedByRevisionMapping !== input.itemId
        ? (others.data ?? []).find(
            (other) => other.id === claimedByRevisionMapping
          )
        : undefined) ??
      (others.data ?? []).find((other) =>
        revisionsMatch(other.revision, input.revision)
      );

    if (sameRevision) {
      return {
        success: false,
        message: `${sameRevision.readableIdWithRevision} is already linked to this Onshape part at revision ${input.revision}. Unlink it there first.`
      };
    }
  }

  const current = existingForItem.get(input.itemId);
  if (current && buildElementExternalId(current.ref) !== externalId) {
    const previous = parseElementExternalId(
      buildElementExternalId(current.ref)
    );
    return {
      success: false,
      message: `This item is already linked to a different Onshape element (${previous?.elementId}). Unlink it before linking a new one.`
    };
  }

  const onshape = await getOnshapeClient(serviceRole, companyId, userId);
  // Narrow on the client rather than on `error` — "" is a valid falsy error
  // string in that union, so a truthiness check does not discriminate it.
  if (!onshape.client) {
    return {
      success: false,
      message: onshape.error ?? "Onshape is not connected"
    };
  }
  const onshapeClient = onshape.client;

  let onshapeCompanyId = settings.onshapeCompanyId;
  if (!onshapeCompanyId) {
    const companies = await onshapeClient.getCompanies();
    onshapeCompanyId = Array.isArray(companies)
      ? (companies[0]?.id ?? null)
      : null;
  }
  if (!onshapeCompanyId) {
    return {
      success: false,
      message: "No Onshape company found for this connection"
    };
  }

  const resolved = await resolveOnshapeRevision(onshapeClient, {
    onshapeCompanyId,
    partNumber: input.partNumber,
    elementType: input.elementType,
    revision: input.revision,
    documentId: input.documentId,
    versionId: input.versionId,
    elementId: input.elementId,
    partId: input.partId || null
  });

  if (!resolved.ok) {
    return { success: false, message: resolved.message };
  }

  const onshapeRevision = resolved.revision;

  // Onshape owns the name. Carbon keeps everything Onshape does not have —
  // the whole BOP, costing, planning, tracking type, unit of measure, supplier
  // parts, posting groups, shelf life, storage, tags and custom fields.
  //
  // Deliberately a narrow two-column update rather than updateItem: that
  // service runs the payload through sanitize(), which turns a
  // present-but-undefined key into null, and its schema requires fields this
  // caller has no business supplying. Same reasoning as applyOnshapeAttributes
  // in the legacy release import.
  //
  // The part NUMBER is not touched. Once the mapping exists the number is a
  // label rather than a key, and rewriting readableId would break every
  // document, PO and job that already renders it.
  if (onshapeRevision.name && onshapeRevision.name !== item.data.name) {
    const renamed = await client
      .from("item")
      .update({
        name: onshapeRevision.name,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", input.itemId)
      .eq("companyId", companyId);

    if (renamed.error) {
      logger.error("Failed to apply Onshape name on link", {
        error: renamed.error
      });
      return {
        success: false,
        message: "Could not apply the Onshape name to this item"
      };
    }
  }

  try {
    await writeElementMapping(serviceRole, {
      companyId,
      itemId: input.itemId,
      ref: {
        documentId: onshapeRevision.documentId,
        elementId: onshapeRevision.elementId,
        partId: onshapeRevision.partId ?? null
      },
      metadata: {
        elementType: onshapeRevision.elementType,
        versionId: onshapeRevision.versionId,
        partNumber: onshapeRevision.partNumber,
        fromUnreleasedVersion: false,
        lastSyncedAt: new Date().toISOString()
      },
      createdBy: userId
    });
  } catch (error) {
    logger.error("Failed to link item to Onshape", {
      error,
      itemId: input.itemId
    });
    return { success: false, message: "Could not link this item to Onshape" };
  }

  const resolvedRevisionId =
    typeof onshapeRevision.id === "string" ? onshapeRevision.id : null;
  const revisionId = input.revisionId || resolvedRevisionId;
  if (revisionId) {
    const recorded = await writeRevisionMapping(serviceRole, {
      companyId,
      itemId: input.itemId,
      revisionId,
      metadata: {
        revision: onshapeRevision.revision,
        releaseId: onshapeRevision.releaseId,
        releaseName: onshapeRevision.releaseName,
        documentId: onshapeRevision.documentId,
        versionId: onshapeRevision.versionId,
        elementId: onshapeRevision.elementId,
        importedAt: new Date().toISOString()
      },
      createdBy: userId
    });

    if (!recorded.ok) {
      logger.warn("Could not record Onshape revision provenance on link", {
        itemId: input.itemId,
        revisionId,
        conflict: recorded.conflict,
        error: recorded.error
      });
      // ANY failure here leaves the link half-made, not just a conflict:
      // the element half is written and the provenance half is not, and the
      // user is told the link is complete. A conflict gets the specific
      // message because it names something the user can go and fix.
      return {
        success: false,
        itemId: input.itemId,
        message: recorded.conflict
          ? "Linked the part, but another Carbon item already claims this exact Onshape release. Unlink it there, then link again."
          : "Linked the part, but Carbon could not record which Onshape release it came from. Try linking again."
      };
    }
  }

  // A part-number mismatch is legal now — the mapping is the join, the number
  // is a label — but it is worth telling the user rather than letting them
  // discover it later.
  const numberMismatch =
    item.data.readableId !== onshapeRevision.partNumber ||
    (item.data.revision ?? "0") !== onshapeRevision.revision;

  // Pull the geometry, same as create-from-Onshape. Linking is the adoption
  // path off the legacy integration, and the whole point is that the item ends
  // up in the state a v2-created one would be in — which includes its model.
  //
  // Queued rather than awaited: an export is a translate-poll-download round
  // trip against Onshape, minutes in the worst case and rate-limitable.
  try {
    await trigger("onshape-v2-item-assets", {
      companyId,
      userId,
      itemId: input.itemId,
      documentId: onshapeRevision.documentId,
      versionId: onshapeRevision.versionId,
      elementId: onshapeRevision.elementId,
      partId: onshapeRevision.partId ?? null,
      assetBaseName: onshapeRevision.revision
        ? `${onshapeRevision.partNumber}.${onshapeRevision.revision}`
        : onshapeRevision.partNumber
    });
  } catch (error) {
    // The link is correct; a queue failure must not report it as broken.
    logger.error("Could not queue the Onshape asset pull", {
      error,
      itemId: input.itemId
    });
  }

  return {
    success: true,
    itemId: input.itemId,
    numberMismatch,
    carbonId: item.data.readableId,
    onshapePartNumber: onshapeRevision.partNumber,
    message: `Linked to ${onshapeRevision.partNumber} revision ${onshapeRevision.revision} in Onshape`
  };
}
