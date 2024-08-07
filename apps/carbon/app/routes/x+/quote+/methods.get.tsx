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
  const { data, error } = await supabaseServiceRole.functions.invoke(
    "get-method",
    {
      body: {
        type: "quote",
        sourceId: itemId,
        targetId: `${quoteId}:${quoteLineId}`,
        companyId,
        userId,
      },
    }
  );

  console.log({ data, error });

  return null;
}
