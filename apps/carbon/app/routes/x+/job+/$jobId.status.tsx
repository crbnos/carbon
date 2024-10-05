import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { jobStatus, updateJobStatus } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof jobStatus)[number];

  if (!status || !jobStatus.includes(status)) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  if (status === "Ready") {
    const { data } = await client
      .from("job")
      .select("item(itemReplenishment(manufacturingBlocked))")
      .eq("id", id)
      .single();

    if (data?.item?.itemReplenishment?.manufacturingBlocked) {
      throw redirect(
        path.to.job(id),
        await flash(request, error(null, "Manufacturing is blocked"))
      );
    }
  }

  const update = await updateJobStatus(client, {
    id,
    status,
    assignee: ["Cancelled"].includes(status) ? null : undefined,
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(request, error(update.error, "Failed to update job status"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(id),
    await flash(request, success("Updated job status"))
  );
}
