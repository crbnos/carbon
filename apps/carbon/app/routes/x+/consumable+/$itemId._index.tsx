import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  throw redirect(path.to.consumableDetails(itemId));
}
