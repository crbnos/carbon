import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getOnshapeClient,
  getOnshapeV2Settings,
  readItemIdForRevision,
  readItemIdsForElement,
  resolveOnshapeRevision,
  writeElementMapping,
  writeRevisionMapping
} from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/lib/trigger";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  upsertPart
} from "~/modules/items";

const logger = getLogger("erp", "integrations-onshape-v2-create");

// The Onshape half of this payload is IDENTITY ONLY. Nothing the client sends
// about the part itself (its number, revision or name) is persisted — those are
// taken from Onshape's own response after the selection is verified, so a
// hand-posted form cannot mint an item under an arbitrary part number and stamp
// it with a mapping it never earned.
export const onshapeV2CreateValidator = z.object({
  partNumber: z.string().min(1, { message: "Part number is required" }),
  revision: z.string().min(1, { message: "Revision is required" }),
  elementType: zfd.numeric(z.number()),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  elementId: z.string().min(1),
  partId: zfd.text(z.string().optional()),
  revisionId: zfd.text(z.string().optional()),
  // Carbon-owned. Seeded by the picker, chosen by the user, never by Onshape:
  // these are business decisions, not CAD facts.
  replenishmentSystem: z.enum(itemReplenishmentSystems),
  itemTrackingType: z.enum(itemTrackingTypes),
  unitOfMeasureCode: z.string().min(1),
  defaultMethodType: z.enum([
    "Make to Order",
    "Purchase to Order",
    "Pull from Inventory"
  ])
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(onshapeV2CreateValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid Onshape selection" };
  }

  const input = validation.data;

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

  const ref = {
    documentId: input.documentId,
    elementId: input.elementId,
    partId: input.partId || null
  };

  // Refuse before creating anything if this CAD thing already has a Carbon
  // item. Without this the same part can be created twice under two numbers,
  // which is precisely the duplication the mapping is meant to prevent.
  let existing: string[];
  try {
    existing = await readItemIdsForElement(client, { companyId, ref });
  } catch (error) {
    logger.error("Failed to check existing Onshape mapping", { error });
    return {
      success: false,
      message: "Could not check whether this part is already linked"
    };
  }

  if (existing.length > 0) {
    // Two different situations, and conflating them produces a message that is
    // simply wrong. A company that has released A, B and C has three picker
    // entries per part, all sharing one elementId — so an element-level hit
    // usually means "a DIFFERENT revision of this part is already here", not
    // "you already imported this one".
    let sameRevisionItemId: string | null = null;
    if (input.revisionId) {
      try {
        sameRevisionItemId = await readItemIdForRevision(client, {
          companyId,
          revisionId: input.revisionId
        });
      } catch (error) {
        logger.error("Failed to check existing Onshape revision mapping", {
          error
        });
        return {
          success: false,
          message: "Could not check whether this revision is already imported"
        };
      }
    }

    if (sameRevisionItemId) {
      return {
        success: false,
        alreadyLinked: true,
        itemId: sameRevisionItemId,
        message:
          "This exact Onshape revision is already in Carbon. Open that item instead of creating a second one."
      };
    }

    return {
      success: false,
      alreadyLinked: true,
      itemId: existing[0],
      message:
        "Another revision of this Onshape part is already in Carbon. New revisions arrive through release import rather than by creating a second part here."
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

  // Everything below comes from Onshape's response, never from the form.
  const onshapeRevision = resolved.revision;

  const created = await upsertPart(client, {
    id: onshapeRevision.partNumber,
    revision: onshapeRevision.revision,
    name: onshapeRevision.name ?? onshapeRevision.partNumber,
    description: "",
    replenishmentSystem: input.replenishmentSystem,
    defaultMethodType: input.defaultMethodType,
    itemTrackingType: input.itemTrackingType,
    unitOfMeasureCode: input.unitOfMeasureCode,
    // Required by partValidator. `active` is NOT on the validator — upsertPart
    // hardcodes active: true on insert.
    shelfLifeCalculateFromBom: false,
    unitCost: 0,
    lotSize: 0,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data?.id) {
    logger.error("Failed to create part from Onshape", {
      error: created.error
    });
    return {
      success: false,
      message:
        created.error?.code === "23505"
          ? `A part numbered ${onshapeRevision.partNumber} revision ${onshapeRevision.revision} already exists in Carbon. Link it to Onshape instead of creating a new one.`
          : "Failed to create the part"
    };
  }

  const itemId = created.data.id;

  // The item exists; the link is what makes it an ONSHAPE item. A failure here
  // leaves an ordinary unlinked part rather than a wrong link, which is the
  // safe direction — but it must be reported, not swallowed, or the user is
  // told the part is connected when it is not.
  try {
    await writeElementMapping(serviceRole, {
      companyId,
      itemId,
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
    logger.error("Created part but failed to link it to Onshape", {
      error,
      itemId
    });
    return {
      success: false,
      itemId,
      message:
        "The part was created but could not be linked to Onshape. Open it and use Link to Onshape."
    };
  }

  // Revision-level provenance. Only released revisions carry a revisionId, and
  // a conflict means another Carbon item already claims this release — worth
  // reporting, but not worth discarding a part that is otherwise correct.
  const resolvedRevisionId =
    typeof onshapeRevision.id === "string" ? onshapeRevision.id : null;
  const revisionId = input.revisionId || resolvedRevisionId;
  if (revisionId) {
    const recorded = await writeRevisionMapping(serviceRole, {
      companyId,
      itemId,
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
      logger.warn("Could not record Onshape revision provenance", {
        itemId,
        revisionId,
        conflict: recorded.conflict,
        error: recorded.error
      });
    }
  }

  // Pull the geometry. The spec has create-from-Onshape doing this immediately,
  // and without it an item created from a released revision arrives with no
  // model while the SAME part imported through a BOM arrives with one — the
  // same pipeline giving two results depending on which button was pressed.
  //
  // Queued rather than awaited: an export is a translate-poll-download round
  // trip against Onshape, which is minutes in the worst case and rate-limitable.
  try {
    await trigger("onshape-v2-item-assets", {
      companyId,
      userId,
      itemId,
      documentId: onshapeRevision.documentId,
      versionId: onshapeRevision.versionId,
      elementId: onshapeRevision.elementId,
      partId: onshapeRevision.partId ?? null,
      // Stable across runs: the model filename is the attach idempotency key.
      assetBaseName: onshapeRevision.revision
        ? `${onshapeRevision.partNumber}.${onshapeRevision.revision}`
        : onshapeRevision.partNumber
    });
  } catch (error) {
    // The part and its link are correct; a queue failure must not undo them.
    logger.error("Could not queue the Onshape asset pull", { error, itemId });
  }

  return {
    success: true,
    itemId,
    readableId: onshapeRevision.partNumber,
    revision: onshapeRevision.revision,
    message: `Created ${onshapeRevision.partNumber} revision ${onshapeRevision.revision} from Onshape`
  };
}
