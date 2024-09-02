import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import {
  quoteMaterialValidator,
  upsertQuoteMaterial,
  upsertQuoteMaterialMakeMethod,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) {
    throw new Error("quoteId not found");
  }
  if (!lineId) {
    throw new Error("lineId not found");
  }

  const formData = await request.formData();
  const validation = await validator(quoteMaterialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const serviceRole = getSupabaseServiceRole();
  const insertQuoteMaterial = await upsertQuoteMaterial(serviceRole, {
    ...data,
    quoteId,
    quoteLineId: lineId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertQuoteMaterial.error) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial.error, "Failed to insert quote material")
      )
    );
  }

  const quoteMaterialId = insertQuoteMaterial.data?.id;
  if (!quoteMaterialId) {
    return json(
      {
        id: null,
      },
      await flash(
        request,
        error(insertQuoteMaterial, "Failed to insert quote material")
      )
    );
  }

  if (data.methodType === "Make") {
    const makeMethod = await upsertQuoteMaterialMakeMethod(serviceRole, {
      ...data,
      quoteMaterialId,
      companyId,
      createdBy: userId,
    });

    if (makeMethod.error) {
      return json(
        {
          id: quoteMaterialId,
        },
        await flash(
          request,
          error(makeMethod.error, "Failed to insert quote material make method")
        )
      );
    }
  }

  return json({ id: quoteMaterialId });
}
