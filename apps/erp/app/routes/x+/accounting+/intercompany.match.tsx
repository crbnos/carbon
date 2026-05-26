import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { runIntercompanyMatching } from "~/modules/accounting/accounting.service.server";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId } = await requirePermissions(request, {
    create: "accounting"
  });

  const result = await runIntercompanyMatching(companyGroupId);

  if (result.error) {
    throw redirect(
      `${path.to.intercompany}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to run IC matching"))
    );
  }

  const matched = (result.data ?? []).filter(
    (r: any) => r.status === "Matched"
  ).length;
  const unmatched = (result.data ?? []).filter(
    (r: any) => r.status === "Unmatched"
  ).length;

  throw redirect(
    `${path.to.intercompany}?${getParams(request)}`,
    await flash(
      request,
      success(`Matching complete: ${matched} matched, ${unmatched} unmatched`)
    )
  );
}
