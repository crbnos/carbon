import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  throw redirect(path.to.quoteDetails(quoteId));
}
