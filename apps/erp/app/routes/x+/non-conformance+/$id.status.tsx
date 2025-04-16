import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  nonConformanceStatus,
  updateNonConformanceStatus,
} from "~/modules/quality";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof nonConformanceStatus)[number];

  if (!status || !nonConformanceStatus.includes(status)) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const [update] = await Promise.all([
    updateNonConformanceStatus(client, {
      id,
      status,
      assignee: ["Closed"].includes(status) ? null : undefined,
      updatedBy: userId,
    }),
  ]);
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quote(id),
      await flash(
        request,
        error(update.error, "Failed to update non-conformance status")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.nonConformanceDetails(id),
    await flash(request, success("Updated non-conformance status"))
  );
}
