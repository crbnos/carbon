import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  createSalesReturnOrderCredit,
  getCreditableQuantities,
  salesReturnOrderCreditValidator
} from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Feeds the Issue Credit modal: per-line creditable pool (received − already
// credited over non-voided memos) with the pricing needed for the preview.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const creditable = await getCreditableQuantities(client, id, companyId);
  if (creditable.error) {
    console.error("Failed to load creditable quantities:", creditable.error);
  }

  return { lines: creditable.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing",
      view: "sales"
    });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(salesReturnOrderCreditValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const memoDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  let memoId: string;
  try {
    // Throws on cap violations (creditable-quantity checks run under row locks)
    memoId = await createSalesReturnOrderCredit(client, getDatabaseClient(), {
      salesReturnOrderId: id,
      companyId,
      companyGroupId,
      userId,
      memoDate,
      lines: validation.data.lines
    });
  } catch (err) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to issue credit"
        )
      )
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Credit memo created"))
  );
}
