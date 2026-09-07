import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  getTrack,
  LearnAssignmentForm,
  learnAssignmentValidator,
  upsertLearnAssignment
} from "~/modules/resources";
import { path } from "~/utils/path";

const logger = getLogger("erp", "learn-assignments-new");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources",
    role: "employee"
  });

  const validation = await validator(learnAssignmentValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, trackSlug, groupIds, dueDate } = validation.data;
  const track = getTrack(trackSlug);
  if (!track) {
    return data({}, await flash(request, error(null, "Unknown track")));
  }

  const result = await upsertLearnAssignment(client, {
    trackSlug,
    trackTitle: track.title,
    groupIds,
    dueDate: dueDate || null,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to create the assignment")
      )
    );
  }

  if (result.data?.id) {
    try {
      await trigger("notify", {
        companyId,
        documentId: result.data.id,
        event: NotificationEvent.LearnAssignment,
        recipient: { type: "group", groupIds },
        from: userId
      });
    } catch (err) {
      // A notification failure must never lose the assignment itself.
      logger.error("Failed to send learn assignment notifications", {
        error: err
      });
    }
  }

  throw redirect(
    path.to.learnAdmin,
    await flash(request, success("Track assigned"))
  );
}

export default function NewLearnAssignmentRoute() {
  const navigate = useNavigate();
  return (
    <LearnAssignmentForm
      initialValues={{ trackSlug: "fundamentals", groupIds: [], dueDate: "" }}
      onClose={() => navigate(path.to.learnAdmin)}
    />
  );
}
