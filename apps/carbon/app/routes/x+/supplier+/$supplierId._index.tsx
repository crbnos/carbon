import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");
  throw redirect(path.to.supplierDetails(supplierId));
}
