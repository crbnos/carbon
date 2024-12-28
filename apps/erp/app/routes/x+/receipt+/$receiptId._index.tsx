import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");
  throw redirect(path.to.receiptDetails(receiptId));
}
