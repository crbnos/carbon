import { redirect } from "react-router";
import { path } from "~/utils/path";

// Legacy URL shim: /x/change-order/new → /x/change-notice/new
export async function loader() {
  throw redirect(path.to.newChangeNotice, 301);
}
