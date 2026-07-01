import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Purchase invoices now live solely in the invoicing module. This legacy
// Purchasing-module URL redirects there, preserving any filter query string
// (e.g. ?filter=supplierId:eq:...).
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${path.to.invoicingPurchasing}${url.search}`);
}
