import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getAccountSubcategoriesByCategory } from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const accountCategoryId = searchParams.get("accountCategoryId") as string;

  if (!accountCategoryId || accountCategoryId === "undefined")
    return json({
      data: [],
    });

  const subcategories = await getAccountSubcategoriesByCategory(
    client,
    accountCategoryId
  );
  if (subcategories.error) {
    return json(
      subcategories,
      await flash(
        request,
        error(subcategories.error, "Failed to get account subcategories")
      )
    );
  }

  return json(subcategories);
}
