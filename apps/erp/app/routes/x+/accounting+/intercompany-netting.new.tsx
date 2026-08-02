import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  createNettingStatement,
  createNettingStatementValidator
} from "~/modules/accounting";
import { path } from "~/utils/path";

// Action-only route. The netting matrix "Create statement" button posts a
// company pair + currency here; we draft a statement and return to the netting
// tab with a flash message.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(createNettingStatementValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await createNettingStatement(client, {
    ...validation.data,
    companyGroupId,
    userId
  });

  if (result.error) {
    throw redirect(
      `${path.to.intercompany}?tab=netting`,
      await flash(
        request,
        error(result.error, "Failed to create netting statement")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?tab=netting`,
    await flash(request, success("Netting statement created"))
  );
}
