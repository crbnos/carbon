// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, hasPermission, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  requireOwnServiceVisit,
  ServiceOrderError
} from "~/modules/service/service.server";
import { updateServiceVisit } from "~/modules/service/service.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-visit-signature");

/** The largest signature PNG the route takes. */
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Saves the customer's signature on a visit: uploads the PNG to
 * `${companyId}/service/${orderId}/${visitId}/signature.png` in the company's
 * private bucket, then stores its path and the signer's name. A user without
 * `update: "service"` signs only their own open visit.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, visitId } = params;
  if (!id) throw new Error("Could not find id");
  if (!visitId) throw new Error("Could not find visitId");

  const formData = await request.formData();
  const signature = formData.get("signature");
  const signedByName = formData.get("signedByName");
  if (!(signature instanceof File) || signature.size === 0) {
    return failure("Sign before you save");
  }
  if (signature.type !== "image/png" || signature.size > MAX_SIGNATURE_BYTES) {
    return failure("The signature must be a PNG image");
  }
  if (typeof signedByName !== "string" || !signedByName.trim()) {
    return failure("Enter the name of the person who signed");
  }

  const canUpdateAny = hasPermission(
    (await getUserClaims(userId, companyId))?.permissions,
    "service",
    "update",
    companyId
  );
  try {
    if (!canUpdateAny) {
      await requireOwnServiceVisit(getDatabaseClient(), {
        companyId,
        serviceOrderId: id,
        serviceVisitId: visitId,
        userId
      });
    }
  } catch (err) {
    if (err instanceof ServiceOrderError) return failure(err.message);
    throw err;
  }

  const signaturePath = `${companyId}/service/${id}/${visitId}/signature.png`;
  const upload = await storage(client)
    .company(companyId)
    .upload(signaturePath, signature, {
      contentType: "image/png",
      upsert: true
    });
  if (upload.error) {
    logger.error("Failed to upload a visit signature", {
      companyId,
      serviceVisitId: visitId,
      error: upload.error
    });
    return failure("Failed to upload the signature");
  }

  const update = await updateServiceVisit(client, {
    id: visitId,
    serviceOrderId: id,
    companyId,
    updatedBy: userId,
    signaturePath,
    signedByName: signedByName.trim()
  });
  if (update.error) {
    logger.error("Failed to save a visit signature", {
      companyId,
      serviceVisitId: visitId,
      error: update.error
    });
    return failure("Failed to save the signature");
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Signature saved"))
  );
}
