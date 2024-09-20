import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getSupabaseServiceRole } from "~/lib/supabase";
import {
  quoteLineValidator,
  upsertQuoteLine,
  upsertQuoteLineMethod,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const formData = await request.formData();
  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const serviceRole = getSupabaseServiceRole();
  const createQuotationLine = await upsertQuoteLine(serviceRole, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createQuotationLine.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(
        request,
        error(createQuotationLine.error, "Failed to create quote line.")
      )
    );
  }

  const quoteLineId = createQuotationLine.data.id;
  if (data.methodType === "Make") {
    const upsertMethod = await upsertQuoteLineMethod(serviceRole, {
      quoteId,
      quoteLineId,
      itemId: data.itemId,
      companyId,
      userId,
    });

    if (upsertMethod.error) {
      throw redirect(
        path.to.quoteLine(quoteId, quoteLineId),
        await flash(
          request,
          error(upsertMethod.error, "Failed to create quote line method.")
        )
      );
    }
  }

  throw redirect(path.to.quoteLine(quoteId, quoteLineId));
}
