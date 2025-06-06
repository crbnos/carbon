import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getMakeMethods } from "~/modules/items";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const makeMethods = await getMakeMethods(client, itemId, companyId);
  const makeMethod =
    makeMethods.data?.find((m) => m.status === "Active") ??
    makeMethods.data?.[0];
  if (!makeMethod) throw new Error("Could not find make method");

  throw redirect(path.to.toolMakeMethod(itemId, makeMethod.id));
}
