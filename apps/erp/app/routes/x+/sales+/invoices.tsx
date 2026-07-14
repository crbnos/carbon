import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Sales invoices now live solely in the invoicing module. This legacy Sales-module
// URL redirects there, preserving any filter query string (e.g. ?filter=customerId:eq:...).
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(`${path.to.invoicingSales}${url.search}`);
}
