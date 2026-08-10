import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { clearConsolePinIn } from "~/services/console.server";
import { endProductionEvents } from "~/services/operations.service";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId, consoleMode } = await requirePermissions(
    request,
    {}
  );
  await request.formData();

  const updates = await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime: datetime.timestamp()
  });

  if (updates.error) {
    return data(
      { success: false, message: updates.error.message },
      { status: 500 }
    );
  }

  // Clock out the operator if time card is enabled
  const serviceRole = await getCarbonServiceRole();
  const settings = await serviceRole
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();

  if ((settings.data as any)?.timeCardEnabled) {
    const clockOutResult = await serviceRole
      .from("timeCardEntry")
      .update({
        clockOut: datetime.timestamp(),
        updatedBy: userId
      } as any)
      .eq("employeeId", userId)
      .eq("companyId", companyId)
      .is("clockOut", null);

    if (clockOutResult.error) {
      log.error("Failed to clock out on end shift", {
        error: clockOutResult.error
      });
    }
  }

  // In console mode, pin out the operator after ending their shift
  const headers = new Headers();
  if (consoleMode) {
    headers.append("Set-Cookie", clearConsolePinIn(companyId));
  }

  return data(
    { success: true, message: "Successfully ended shift" },
    headers.has("Set-Cookie") ? { headers } : undefined
  );
}
