import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  createPurchaseReturnOrderCredit,
  getCreditableQuantitiesForPurchaseReturn,
  purchaseReturnOrderCreditValidator
} from "~/modules/purchasing";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await getCreditableQuantitiesForPurchaseReturn(
    client,
    id,
    companyId
  );

  if (result.error) {
    return { lines: [] };
  }

  return { lines: result.data ?? [] };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "invoicing"
    });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(
    purchaseReturnOrderCreditValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const memoDate = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  let memoId: string;
  try {
    // Throws on cap violations (creditable checks run under row locks)
    memoId = await createPurchaseReturnOrderCredit(
      client,
      getDatabaseClient(),
      {
        purchaseReturnOrderId: id,
        companyId,
        companyGroupId,
        userId,
        memoDate,
        lines: validation.data.lines
      }
    );
  } catch (err) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(id),
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
    await flash(request, success("Created draft credit memo"))
  );
}
