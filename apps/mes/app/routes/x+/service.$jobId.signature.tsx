// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { isServiceJobLocked } from "@carbon/utils";
import { type ActionFunctionArgs, data } from "react-router";
import { updateServiceJobFields } from "~/services/service.service";

const log = getLogger("mes", "service-job-signature");

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Saves the customer's signature on a service job: the PNG at
 * `${companyId}/service-job/${jobId}/signature.png` in the company's private
 * bucket, then its path and the signer's name on the job. Completing the job
 * carries both into `post-service-job`.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { jobId } = params;
  if (!jobId) return failure("Service job is required");

  const formData = await request.formData();
  const signature = formData.get("signature");
  const signedByName = formData.get("signedByName");
  const name = typeof signedByName === "string" ? signedByName.trim() : "";

  if (!(signature instanceof File) || signature.size === 0) {
    return failure("Sign before you save");
  }
  if (signature.type !== "image/png" || signature.size > MAX_SIGNATURE_BYTES) {
    return failure("The signature must be a PNG image");
  }
  if (!name) return failure("Enter the name of the person who signed");

  const serviceRole = await getCarbonServiceRole();

  // The upload and the write are service-role: the job must be this
  // company's, and still open.
  const job = await serviceRole
    .from("serviceJob")
    .select("id, status")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!job.data) return failure("Service job not found");
  if (isServiceJobLocked(job.data.status)) {
    return failure(`This job is ${job.data.status}`);
  }

  const signaturePath = `${companyId}/service-job/${jobId}/signature.png`;
  const upload = await storage(serviceRole)
    .company(companyId)
    .upload(signaturePath, signature, {
      contentType: "image/png",
      upsert: true
    });
  if (upload.error) {
    log.error("Failed to upload a service job signature", {
      companyId,
      jobId,
      error: upload.error
    });
    return failure("Failed to upload the signature");
  }

  const update = await updateServiceJobFields(serviceRole, {
    serviceJobId: jobId,
    companyId,
    updatedBy: userId,
    values: { signaturePath, signedByName: name }
  });
  if (update.error) {
    log.error("Failed to save a service job signature", {
      companyId,
      jobId,
      error: update.error
    });
    return failure("Failed to save the signature");
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Signature saved"))
  );
}
