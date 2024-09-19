import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");
  throw redirect(path.to.salesRfqDetails(rfqId));
}
