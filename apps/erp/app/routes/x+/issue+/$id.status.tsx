import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { nonConformanceStatus } from "~/modules/quality";
import { transitionIssueStatus } from "~/modules/quality/quality-transitions.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof nonConformanceStatus)[number];

  if (!status || !nonConformanceStatus.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.issueDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const result = await transitionIssueStatus(client, {
    id,
    companyId,
    userId,
    status
  });
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issueDetails(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issueDetails(id),
    await flash(request, success("Updated issue status"))
  );
}
