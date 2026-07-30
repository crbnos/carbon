import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// The Inbound Inspections submodule was renamed to Inspections.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  throw redirect(`${path.to.inspections}${search}`);
}
