import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import invariant from "tiny-invariant";
import { path } from "~/utils/path";

// The inbound inspection drawer moved to a full-screen execution view at
// /x/inspection/{id}. Keep old links (notifications, bookmarks)
// working with a redirect.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  invariant(id, "id is required");
  const search = new URL(request.url).search;
  throw redirect(`${path.to.inspection(id)}${search}`);
}
