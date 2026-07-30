import { redirect } from "react-router";
import { path } from "~/utils/path";

// Legacy URL shim: /x/items/change-orders → /x/items/change-notices
export async function loader() {
  throw redirect(path.to.changeNotices, 301);
}
