import { cspReportAction } from "@carbon/auth/middleware/security.server";
import type { ActionFunctionArgs } from "react-router";

// CSP_REPORT_PATH: where browsers send report-only CSP violations.
export async function action({ request }: ActionFunctionArgs) {
  return cspReportAction(request);
}
