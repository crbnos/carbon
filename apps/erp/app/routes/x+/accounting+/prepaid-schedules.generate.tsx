import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { generatePrepaidAmortizationJournals } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const result = await generatePrepaidAmortizationJournals(client, {
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      `${path.to.prepaidSchedules}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to generate amortization journals")
      )
    );
  }

  const drafted = result.data?.drafted ?? 0;
  throw redirect(
    `${path.to.prepaidSchedules}?${getParams(request)}`,
    await flash(request, success(`${drafted} amortization journal(s) drafted`))
  );
}
