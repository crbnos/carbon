import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { learnCertificateRevokeValidator } from "~/modules/resources";
import { revokeCertificate } from "~/modules/resources/learn/engine.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "resources",
    role: "employee"
  });

  const validation = await validator(learnCertificateRevokeValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  try {
    const revoked = await revokeCertificate({
      companyId,
      certificateId: validation.data.certificateId,
      revokedBy: userId,
      reason: validation.data.reason
    });

    if (!revoked) {
      return data(
        {},
        await flash(request, error(null, "Certificate not found"))
      );
    }
  } catch (err) {
    return data(
      {},
      await flash(request, error(err, "Failed to revoke the certificate"))
    );
  }

  throw redirect(
    path.to.learnAdmin,
    await flash(request, success("Certificate revoked"))
  );
}
