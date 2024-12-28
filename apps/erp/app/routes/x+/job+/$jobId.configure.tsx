import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee",
  });
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const configuration = await request.json();

  if (configuration) {
    const result = await client
      .from("job")
      .update({
        configuration,
        updatedAt: new Date().toISOString(),
        updatedBy: userId,
      })
      .eq("id", jobId);

    if (result.error) {
      throw redirect(
        requestReferrer(request) ?? path.to.job(jobId),
        await flash(request, error("Failed to update job"))
      );
    }
  } else {
    throw new Error("No configuration provided");
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(jobId),
    await flash(request, success("Updated job"))
  );
}
