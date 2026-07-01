import { redirect } from "react-router";
import { path } from "~/utils/path";

// Board was retired — it's plan-only now. Keep this path working (old links,
// bookmarks) by redirecting to the plan page.
export function loader() {
  return redirect(path.to.getStartedPage("plan"));
}
