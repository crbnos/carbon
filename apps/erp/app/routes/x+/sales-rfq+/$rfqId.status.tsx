import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { salesRFQStatusType, updateSalesRFQStatus } from "~/modules/sales";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

const logger = getLogger("erp", "rfqid-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status") as (typeof salesRFQStatusType)[number];
  const noQuoteReasonId = formData.get("noQuoteReasonId") as string | null;

  if (!status || !salesRFQStatusType.includes(status)) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const companySettings = await getCompanySettings(client, companyId);
  if (
    status === "Ready for Quote" &&
    companySettings.data &&
    Array.isArray(companySettings.data.rfqReadyNotificationGroup) &&
    companySettings.data.rfqReadyNotificationGroup.length > 0
  ) {
    const rfqReadyNotificationGroup =
      companySettings.data.rfqReadyNotificationGroup;
    try {
      await trigger("notify", {
        companyId: companySettings.data.id,
        documentId: id,
        event: NotificationEvent.SalesRfqReady,
        recipient: {
          type: "group",
          groupIds: rfqReadyNotificationGroup
        }
      });
    } catch (err) {
      logger.error("Failed to trigger notification", { error: err });
      return {
        success: false,
        message: "Failed to send notification"
      };
    }
  }

  const update = await updateSalesRFQStatus(client, {
    id,
    status,
    noQuoteReasonId,
    assignee: status === "Closed" ? null : undefined,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(update.error, "Failed to update RFQ status"))
    );
  }

  throw redirect(
    path.to.salesRfq(id),
    await flash(request, success("Updated RFQ status"))
  );
}
