import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Inspection plans moved from Production to Quality; keep old links working.
export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(
    `${path.to.inspectionDocuments}${new URL(request.url).search}`
  );
}
