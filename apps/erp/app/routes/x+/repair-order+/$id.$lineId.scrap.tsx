import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getDatabaseClient } from "~/services/database.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { scrapRepairOrderLine } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id || !lineId) throw new Error("Could not find id");

  // The scrap posting date is a business date, so it belongs to the company's
  // calendar rather than the server's.
  const timezone = await getCompanyTimeZone(client, companyId);
  const today = datetime.today(timezone).toString();

  try {
    await scrapRepairOrderLine(getDatabaseClient(), {
      id: lineId,
      companyId,
      userId,
      today
    });
  } catch (err) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(err, (err as Error)?.message ?? "Failed to scrap the unit")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Unit scrapped"))
  );
}
