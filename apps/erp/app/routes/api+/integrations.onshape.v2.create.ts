import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getUserClaims } from "@carbon/auth/users.server";
import {
  buildOnshapeItemNotesBlock,
  getOnshapeClient,
  getOnshapeV2Settings,
  patchElementMappingMetadata,
  readItemIdForRevision,
  readItemIdsForElement,
  readReleasePackageName,
  readReleasePackageNotes,
  resolveOnshapeRevision,
  writeElementMapping,
  writeOnshapeItemNotes,
  writeRevisionMapping
} from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/lib/trigger";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  applyStorageAndShelfLifeRefines,
  getMakeMethods,
  partBaseValidator,
  upsertPart
} from "~/modules/items";
import { setCustomFields } from "~/utils/form";

const logger = getLogger("erp", "integrations-onshape-v2-create");

/** 0 Part Studio body, 1 Assembly, 2 Drawing. */
const ELEMENT_TYPE_ASSEMBLY = 1;

// The Onshape half of this payload is IDENTITY ONLY. Nothing the client sends
// about the part itself (its number, revision or name) is persisted — those are
// taken from Onshape's own response after the selection is verified, so a
// hand-posted form cannot mint an item under an arbitrary part number and stamp
// it with a mapping it never earned. `id`, `revision` and `name` are therefore
// OFF this schema entirely rather than accepted and ignored.
const onshapeIdentity = z.object({
  partNumber: z.string().min(1, { message: "Part number is required" }),
  revision: z.string().min(1, { message: "Revision is required" }),
  elementType: zfd.numeric(z.number()),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  elementId: z.string().min(1),
  partId: zfd.text(z.string().optional()),
  revisionId: zfd.text(z.string().optional()),
  /**
   * Also import this assembly's bill of materials, in the same action.
   *
   * Chaining the two routes from the browser was the tempting shape and is
   * wrong: a tab closed between them leaves a linked part with no BOM and
   * nothing recording that one was wanted.
   */
  importBom: zfd.checkbox()
});

/**
 * The whole New Part form, minus what Onshape owns.
 *
 * `PartForm` already collects posting group, storage, shelf life, description,
 * unit cost, batch size, tags and custom fields — the four fields the old
 * modal collected were never the problem, the twelve it could not reach were.
 * The storage/shelf-life refines come along so this route enforces the same
 * business rules the ordinary create route does.
 */
export const onshapeV2CreateValidator = applyStorageAndShelfLifeRefines(
  partBaseValidator
    .omit({
      id: true,
      revision: true,
      name: true,
      readableId: true,
      modelUploadId: true
    })
    .merge(onshapeIdentity)
);

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

  // A Part Studio body has no bill of materials. The form does not offer the
  // option for one, so this can only be a hand-posted request — refuse it here
  // rather than queue a job whose first act is to fail.
  if (input.importBom && input.elementType !== ELEMENT_TYPE_ASSEMBLY) {
    return {
      success: false,
      message:
        "Only an Onshape assembly has a bill of materials to import. Create the part without it."
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

  const {
    partNumber: _partNumber,
    revision: _revision,
    elementType: _elementType,
    documentId: _documentId,
    versionId: _versionId,
    elementId: _elementId,
    partId: _partId,
    revisionId: _revisionId,
    importBom,
    ...carbonFields
  } = input;

  const createdRevision = onshapeRevision.revision || "0";

  const created = await upsertPart(client, {
    // Everything Onshape owns comes from Onshape's own response, never from the
    // form — the form's copies are read-only decoration.
    ...carbonFields,
    id: onshapeRevision.partNumber,
    revision: createdRevision,
    name: onshapeRevision.name ?? onshapeRevision.partNumber,
    companyId,
    createdBy: userId,
    // `custom-*` keys are read straight off the FormData, exactly as the
    // ordinary new-part action does.
    customFields: setCustomFields(formData)
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

  // Re-read the row by its FULL key instead of trusting what upsertPart handed
  // back. Its insert branch finishes with a lookup against the `parts` VIEW,
  // which is DISTINCT ON (readableId, companyId) ordered so a NAMED revision
  // sorts first — so creating ABC rev "0" next to an existing unlinked ABC
  // rev "A" succeeds and returns rev A's id. Both mappings and the asset pull
  // would then land on the wrong item, permanently.
  const confirmed = await client
    .from("item")
    .select("id")
    .eq("readableId", onshapeRevision.partNumber)
    .eq("revision", createdRevision)
    .eq("companyId", companyId)
    .eq("type", "Part")
    .maybeSingle();

  if (confirmed.error || !confirmed.data?.id) {
    logger.error("Created a part but could not confirm which row it is", {
      error: confirmed.error,
      readableId: onshapeRevision.partNumber,
      revision: createdRevision
    });
    return {
      success: false,
      message:
        "The part was created but Carbon could not confirm which row it is, so it was not linked to Onshape. Open the part and use Link to Onshape."
    };
  }

  const itemId = confirmed.data.id;

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
        elementId: onshapeRevision.elementId
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

  // Provenance in the item's own notes, so someone reading the part two years
  // from now can see which Onshape release produced it without opening the
  // integration. `upsertPart` does not write notes, so this is its own narrow
  // update — the same reason applyOnshapeAttributes and v2.link write their
  // one column directly rather than through items_updateItem.
  //
  // Log-and-continue on failure: the part and both mappings are already correct,
  // and a missing note must not undo them.
  try {
    const releasePackage = onshapeRevision.releaseId
      ? await onshapeClient.getReleasePackage(onshapeRevision.releaseId)
      : undefined;
    await writeOnshapeItemNotes(serviceRole, {
      companyId,
      itemId,
      userId,
      block: buildOnshapeItemNotesBlock({
        releaseName:
          readReleasePackageName(releasePackage) ??
          onshapeRevision.releaseName ??
          null,
        releaseNotes: readReleasePackageNotes(releasePackage),
        partNumber: onshapeRevision.partNumber,
        revision: onshapeRevision.revision,
        documentId: onshapeRevision.documentId,
        versionId: onshapeRevision.versionId,
        elementId: onshapeRevision.elementId,
        partId: onshapeRevision.partId ?? null,
        releaseId: onshapeRevision.releaseId ?? null
      })
    });
  } catch (error) {
    logger.warn("Could not write Onshape provenance to item notes", {
      itemId,
      error
    });
  }

  // The bill of materials, when it was asked for.
  //
  // ONE action rather than the browser chaining create → import: a tab closed
  // between two requests leaves a linked part with no BOM and nothing recording
  // that one was wanted. The `makeMethodId` the import needs already exists —
  // every item insert of type Part fires
  // `sync_create_make_method_related_records`, which inserts a Draft method.
  let importQueued = false;
  let importRefusal: string | null = null;

  if (importBom) {
    // A SOFT permission check, not a second `requirePermissions`.
    //
    // `requirePermissions` THROWS a redirect on denial, so declaring
    // update + delete on this route would bounce a create-only user off the
    // page entirely — and the part they asked for would never be made. The
    // import is the optional half; the part is not.
    const claims = await getUserClaims(userId, companyId);
    const granted = (action: "create" | "update" | "delete") => {
      const forCompany = claims.permissions.parts?.[action] ?? [];
      return forCompany.includes("0") || forCompany.includes(companyId);
    };

    if (!granted("update") || !granted("delete")) {
      // The job mints parts and DELETES material lines, which is why it needs
      // more than `create`. Name what is missing rather than failing silently.
      importRefusal =
        "The part was created, but importing its bill of materials needs update and delete permission on parts.";
    } else {
      const methods = await getMakeMethods(client, itemId, companyId);
      const draft = (methods.data ?? []).find(
        (method) => method.status === "Draft" && !method.changeOrderId
      );

      if (!draft) {
        importRefusal =
          "The part was created, but Carbon could not find its draft method to import the bill of materials into. Open the part and import from its BoM explorer.";
      } else {
        try {
          // Mark the import in flight BEFORE dispatching, and on the mapping
          // this route just wrote — the job never rewrites the TOP-LEVEL item's
          // element mapping (it only writes them for rows it adopts or mints),
          // so this marker survives the run and the job stamps its finish onto
          // the same object.
          await patchElementMappingMetadata(serviceRole, {
            companyId,
            itemId,
            patch: {
              bomImport: {
                startedAt: new Date().toISOString(),
                // A re-import must not inherit the previous run's outcome.
                finishedAt: undefined,
                attentionCount: undefined
              }
            }
          });
        } catch (error) {
          // The marker is an affordance, not the import. Losing it costs the
          // badge, not the bill of materials.
          logger.warn("Could not mark the Onshape BOM import as started", {
            error,
            itemId
          });
        }

        try {
          await trigger("onshape-bom-import", {
            companyId,
            userId,
            makeMethodId: draft.id,
            documentId: onshapeRevision.documentId,
            versionId: onshapeRevision.versionId,
            elementId: onshapeRevision.elementId
          });
          importQueued = true;
        } catch (error) {
          logger.error("Could not queue the Onshape BOM import", {
            error,
            itemId
          });
          importRefusal =
            "The part was created, but the bill of materials import could not be started. Import it from the part's BoM explorer.";
        }
      }
    }
  }

  // Pull the geometry. The spec has create-from-Onshape doing this immediately,
  // and without it an item created from a released revision arrives with no
  // model while the SAME part imported through a BOM arrives with one — the
  // same pipeline giving two results depending on which button was pressed.
  //
  // Queued rather than awaited: an export is a translate-poll-download round
  // trip against Onshape, which is minutes in the worst case and rate-limitable.
  //
  // EXACTLY ONE asset path runs. The BOM import pulls the top-level item's own
  // model itself, and running both double-exports the same element against a
  // rate-limited API — worse, `attachOnshapeAssetsToItem` compare-and-sets
  // `item.modelUploadId`, so the loser files its model away as a document.
  if (!importQueued) {
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
          : onshapeRevision.partNumber,
        // Lets the drawing pass pick the right family member — the element
        // mapping spans every revision of the part.
        revision: onshapeRevision.revision ?? null
      });
    } catch (error) {
      // The part and its link are correct; a queue failure must not undo them.
      logger.error("Could not queue the Onshape asset pull", { error, itemId });
    }
  }

  const createdMessage = `Created ${onshapeRevision.partNumber} revision ${onshapeRevision.revision} from Onshape`;

  return {
    success: true,
    itemId,
    readableId: onshapeRevision.partNumber,
    revision: onshapeRevision.revision,
    importQueued,
    message: importRefusal
      ? `${createdMessage}. ${importRefusal}`
      : importQueued
        ? // Say the reload part out loud, the way the BoM explorer's import
          // already does. `methodMaterial` is not in the realtime publication
          // and nothing revalidates the route, so the header badge updates by
          // polling while the bill of materials itself does not appear until
          // the page is reloaded — which reads as a failed import.
          `${createdMessage}. The bill of materials is importing in the background — reload the page in a moment to see it.`
        : createdMessage
  };
}
