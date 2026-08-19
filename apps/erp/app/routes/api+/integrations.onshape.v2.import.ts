import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildElementExternalId,
  getOnshapeClient,
  getOnshapeV2Settings,
  readElementMappingsForItems,
  resolveOnshapeRevision,
  writeElementMapping
} from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const logger = getLogger("erp", "integrations-onshape-v2-import");

export const onshapeV2ImportValidator = z.object({
  makeMethodId: z.string().min(1),
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  elementId: z.string().min(1),
  /** Link the target item to this assembly as part of the import. */
  partNumber: zfd.text(z.string().optional()),
  revision: zfd.text(z.string().optional()),
  elementType: zfd.numeric(z.number().optional())
});

/**
 * Kick off a v2 BOM import.
 *
 * The write itself is an Inngest job — it makes real Onshape export calls and
 * walks a tree, so holding a request open for it is what made the legacy path
 * un-retryable. What happens HERE is only the cheap validation, so a user who
 * picked the wrong method finds out immediately rather than from a job that
 * failed somewhere they cannot see.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  // The job MINTS parts for unmapped rows, which every other surface gates
  // behind `create`, and it DELETES material lines, which the UI gates behind
  // `delete`. Asking only for `update` let this route do more than the
  // permission it checked.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts",
    create: "parts",
    delete: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(onshapeV2ImportValidator).validate(
    formData
  );
  if (validation.error) {
    return { success: false, message: "Invalid import request" };
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

  // An empty revision means the selection is an UNRELEASED version: Onshape
  // stamps a revision only on release. Such an import lands on Carbon's initial
  // revision and carries no released asset, so it is opt-in per company.
  const isUnreleasedSelection = !input.revision;
  if (isUnreleasedSelection && !settings.allowUnreleasedSync) {
    return {
      success: false,
      message:
        "That Onshape version has never been released, and this company only syncs released versions. Release it in Onshape, or turn on unreleased syncing in the integration settings."
    };
  }

  // Same FOUR refusals the job makes, checked up front so the user sees them
  // now. The job re-checks — this is for the message, not for safety.
  //
  // Keeping them in step matters more than it looks: the job's refusal throws
  // inside a step on a function declared `retries: 10`, so a deterministic
  // refusal the route did not catch is retried eleven times and then dies in
  // the job log — while the user was already told "Import started" and the
  // outcome notification only fires on the success path.
  const method = await client
    .from("makeMethod")
    .select("id, itemId, status, changeOrderId, item(revision, revisionStatus)")
    .eq("id", input.makeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (method.error || !method.data) {
    return { success: false, message: "Make method not found" };
  }
  if (method.data.status !== "Draft") {
    return {
      success: false,
      message: `Onshape can only import into a Draft method. This one is ${method.data.status} — create a new version first.`
    };
  }
  if (method.data.changeOrderId) {
    return {
      success: false,
      message:
        "This method belongs to an open change notice. Import into the item's own draft instead, so releasing the notice cannot ship what the import left."
    };
  }

  // Link the item being imported INTO to the assembly it came from, so the
  // next import resolves the parent by id like every other row. Without this
  // the top-level item is the one thing in the tree still joined by nothing.
  // Refuse an unreleased import into an item that already carries a NAMED
  // revision. Marking a released item as unreleased-sourced is a lie, and the
  // rows underneath it would all resolve revision-missing anyway.
  const targetItem = method.data.item as {
    revision?: string;
    revisionStatus?: string;
  } | null;
  const targetRevision = targetItem?.revision;
  if (
    isUnreleasedSelection &&
    targetRevision &&
    targetRevision !== "0" &&
    targetRevision !== ""
  ) {
    return {
      success: false,
      message: `This item is at revision ${targetRevision}. An unreleased Onshape version can only be imported into the initial revision — release it in Onshape first.`
    };
  }

  // The PLM revision lock, mirrored from the job. Under `enforce`, a
  // Production item's method is frozen: changing it here would alter what the
  // shop is already building.
  if (targetItem?.revisionStatus === "Production") {
    const companySettings = await client
      .from("companySettings")
      .select("plmReleaseControl")
      .eq("id", companyId)
      .maybeSingle();
    if ((companySettings.data?.plmReleaseControl ?? "enforce") === "enforce") {
      return {
        success: false,
        message:
          "This item is in Production and this company enforces PLM release control, so its method cannot be changed. Create a new revision first."
      };
    }
  }

  // The element mapping is written for every import, not only when a part
  // number came along. `partNumber` is provenance — an assembly that carries
  // none in Onshape is still importable, and gating the LINK on it left that
  // item silently unlinked, which is the one thing v2 exists to guarantee.
  {
    // Never write a mapping straight from the POST body. Every other v2 write
    // re-resolves the selection against Onshape first, so a hand-posted form
    // cannot stamp an item with an element it does not own.

    const existing = await readElementMappingsForItems(client, {
      companyId,
      itemIds: [method.data.itemId]
    });
    const current = existing.get(method.data.itemId);
    const incoming = buildElementExternalId({
      documentId: input.documentId,
      elementId: input.elementId,
      partId: null
    });
    if (current && buildElementExternalId(current.ref) !== incoming) {
      return {
        success: false,
        message:
          "This item is already linked to a different Onshape element. Unlink it before importing from another assembly."
      };
    }

    if (input.revision) {
      // A named revision is only verifiable against Onshape's company-wide
      // revision list, which is keyed by part number. Without one there is
      // nothing to check the claim against, so it is refused rather than
      // written unverified.
      if (!input.partNumber) {
        return {
          success: false,
          message:
            "This selection names a revision but no part number, so Carbon cannot verify it against Onshape."
        };
      }
      const onshape = await getOnshapeClient(serviceRole, companyId, userId);
      if (!onshape.client) {
        return {
          success: false,
          message: onshape.error ?? "Onshape is not connected"
        };
      }
      let onshapeCompanyId = settings.onshapeCompanyId;
      if (!onshapeCompanyId) {
        const companies = await onshape.client.getCompanies();
        onshapeCompanyId = Array.isArray(companies)
          ? (companies[0]?.id ?? null)
          : null;
      }
      if (onshapeCompanyId) {
        const resolved = await resolveOnshapeRevision(onshape.client, {
          onshapeCompanyId,
          partNumber: input.partNumber,
          elementType: input.elementType ?? 1,
          revision: input.revision,
          documentId: input.documentId,
          versionId: input.versionId,
          elementId: input.elementId,
          partId: null
        });
        if (!resolved.ok) {
          return { success: false, message: resolved.message };
        }
      }
    }

    try {
      await writeElementMapping(serviceRole, {
        companyId,
        itemId: method.data.itemId,
        ref: {
          documentId: input.documentId,
          elementId: input.elementId,
          partId: null
        },
        metadata: {
          elementType: input.elementType,
          versionId: input.versionId,
          partNumber: input.partNumber,
          fromUnreleasedVersion: !input.revision,
          lastSyncedAt: new Date().toISOString()
        },
        createdBy: userId
      });
    } catch (error) {
      logger.error("Failed to link the target item to its Onshape assembly", {
        error
      });
      return {
        success: false,
        message: "Could not link this item to the Onshape assembly"
      };
    }
  }

  await trigger("onshape-bom-import", {
    companyId,
    userId,
    makeMethodId: input.makeMethodId,
    documentId: input.documentId,
    versionId: input.versionId,
    elementId: input.elementId
  });

  return {
    success: true,
    message:
      "Import started. The bill of materials updates in the background — reload the page in a moment to see it."
  };
}
