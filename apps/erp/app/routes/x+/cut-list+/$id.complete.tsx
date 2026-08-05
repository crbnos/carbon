import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { confirmCutList, cutListCompleteValidator } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const raw = formData.get("payload");
  if (typeof raw !== "string") {
    return data(
      { success: false },
      await flash(request, error(null, "Missing confirmation payload"))
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return data(
      { success: false },
      await flash(request, error(null, "Invalid confirmation payload"))
    );
  }

  const validation = cutListCompleteValidator.safeParse(parsed);
  if (!validation.success) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Invalid confirmation payload")
      )
    );
  }

  const result = await confirmCutList(client, {
    cutListId: id,
    companyId,
    userId,
    ...validation.data
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to complete cut list"))
    );
  }

  const payload = result.data as {
    remnantsCreated?: number;
    status?: string;
  } | null;

  const message =
    payload?.status === "Completed"
      ? payload?.remnantsCreated
        ? `Cut list completed — ${payload.remnantsCreated} remnant(s) returned to stock`
        : "Cut list completed"
      : "Progress recorded";

  return data({ success: true }, await flash(request, success(message)));
}
