import { redirect } from "react-router";
import { path } from "~/utils/path";

// The board is now a view of the combined Plan & Board page. Keep this path
// working (old links, bookmarks) by redirecting to the board view.
export function loader() {
  return redirect(`${path.to.getStartedPage("plan")}?view=board`);
}
