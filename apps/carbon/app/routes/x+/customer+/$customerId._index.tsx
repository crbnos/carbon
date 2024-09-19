import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");
  throw redirect(path.to.customerDetails(customerId));
}
