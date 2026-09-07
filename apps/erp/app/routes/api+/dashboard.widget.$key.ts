import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDate } from "@internationalized/date";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  emptyPayload,
  getWidgetDefinition,
  MAX_WINDOW_DAYS,
  windowFromDates
} from "~/modules/dashboard/dashboard.models";
import { getWidgetData } from "~/modules/dashboard/dashboard.service";

/**
 * One widget's payload for an inclusive YYYY-MM-DD window. The permission
 * gate is the widget's own module, resolved from the registry — the route
 * cannot check a static module because widgets span modules. Unknown key →
 * 404; a malformed or over-long window → the kind's empty payload.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const definition = params.key ? getWidgetDefinition(params.key) : undefined;
  if (!definition) {
    throw data({ error: "Unknown widget" }, { status: 404 });
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    view: definition.module
  });

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const today = url.searchParams.get("today");

  let window: ReturnType<typeof windowFromDates>;
  try {
    if (!start || !end || !today) throw new Error("missing window");
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    parseDate(today);
    const span = endDate.compare(startDate);
    if (span < 0 || span > MAX_WINDOW_DAYS) throw new Error("bad window");
    window = windowFromDates(startDate, endDate);
  } catch {
    return emptyPayload(definition.kind);
  }

  return getWidgetData(client, {
    key: definition.key,
    companyId,
    userId,
    window: { ...window, today: today as string }
  });
}
