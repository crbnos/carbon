import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { priceResolutionInputValidator } from "~/modules/sales";
import { resolvePrice } from "~/modules/sales/sales.service.server";

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const payload = priceResolutionInputValidator.safeParse(await request.json());

  if (!payload.success) {
    return data(
      { errors: payload.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await resolvePrice(payload.data);

  return data(result);
}
