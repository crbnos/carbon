import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // The list view is the default landing for picking lists.
  const search = url.search ? url.search : "";
  throw redirect(`${path.to.pickingListsTable}${search}`);
}
