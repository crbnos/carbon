import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  throw redirect(path.to.serviceDetails(itemId));
}
