import { redirect } from "react-router";
import { path } from "~/utils/path";

// Renamed to Supplier Credits — Carbon says "supplier"; only third-party
// integrations say "vendor". Kept so bookmarks and older links still land.
export async function loader() {
  throw redirect(path.to.supplierCredits);
}
