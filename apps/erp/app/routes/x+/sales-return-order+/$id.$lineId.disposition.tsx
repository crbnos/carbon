import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  salesReturnOrderDispositionValidator,
  setSalesReturnOrderLineDisposition
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("Could not find id");
  if (!lineId) throw notFound("Could not find lineId");

  const redirectTo =
    requestReferrer(request) ?? path.to.salesReturnOrderLine(id, lineId);

  const validation = await validator(
    salesReturnOrderDispositionValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const { disposition } = validation.data;

  if (validation.data.lineId !== lineId) {
    throw redirect(
      redirectTo,
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }

  // Scrap and Rework are quality decisions — they escalate to an Issue (the
  // line's issue route), which sets the disposition after the NCR is created.
  if (disposition === "Scrap" || disposition === "Rework") {
    throw redirect(
      redirectTo,
      await flash(
        request,
        error(
          null,
          "Scrap and Rework are set by escalating the line to an Issue"
        )
      )
    );
  }

  const result = await setSalesReturnOrderLineDisposition(
    client,
    getDatabaseClient(),
    {
      lineId,
      companyId,
      disposition,
      userId
    }
  );

  if (result.error) {
    throw redirect(
      redirectTo,
      await flash(request, error(result.error, "Failed to update disposition"))
    );
  }

  throw redirect(
    redirectTo,
    await flash(request, success("Disposition updated"))
  );
}
