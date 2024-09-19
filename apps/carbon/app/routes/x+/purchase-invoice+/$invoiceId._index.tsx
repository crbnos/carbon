import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { invoiceId } = params;
  if (!invoiceId) throw notFound("Could not find invoiceId");
  throw redirect(path.to.purchaseInvoiceDetails(invoiceId));
}
