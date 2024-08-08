import { type ActionFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { requirePermissions } from "~/services/auth/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const itemId = formData.get("itemId") as string;
  const quoteId = formData.get("quoteId") as string;
  const quoteLineId = formData.get("quoteLineId") as string;

  if (!itemId || !quoteId || !quoteLineId) {
    throw new Error("Missing required fields");
  }

  const supabaseServiceRole = getSupabaseServiceRole();
  const { error } = await supabaseServiceRole.functions.invoke("get-method", {
    body: {
      type: "itemToQuoteLine",
      sourceId: itemId,
      targetId: `${quoteId}:${quoteLineId}`,
      companyId,
      userId,
    },
  });

  return {
    error: error ? "Failed to get method" : null,
  };
}
