import { redirect } from "react-router";
import { path } from "~/utils/path";

// Inspection plans moved from Production to Quality; keep old links working.
export async function loader() {
  throw redirect(path.to.newInspectionDocument);
}
