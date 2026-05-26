import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { generateEliminations } from "~/modules/accounting/accounting.service.server";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId } = await requirePermissions(request, {
    create: "accounting"
  });

  const result = await generateEliminations(companyGroupId);

  if (result.error) {
    throw redirect(
      `${path.to.intercompany}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to generate elimination entries")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?${getParams(request)}`,
    await flash(request, success("Elimination entries generated"))
  );
}
