import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  HStack,
  Textarea,
  VStack
} from "@carbon/react";
import { useState } from "react";
import { LuSend } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { data, useFetcher, useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import {
  maintenanceDispatchCommentValidator,
  upsertMaintenanceDispatchComment
} from "~/modules/resources";
import type { MaintenanceDispatchComment } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("dispatchId not found");

  const formData = await request.formData();
  const validation = await validator(
    maintenanceDispatchCommentValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const upsertComment = await upsertMaintenanceDispatchComment(client, {
    ...validation.data,
    maintenanceDispatchId: dispatchId,
    createdBy: validation.data.id ? undefined : userId,
    // @ts-expect-error - stfu typescript
    updatedBy: validation.data.id ? userId : undefined
  });

  if (upsertComment.error) {
    return data(
      {},
      await flash(request, error(upsertComment.error, "Failed to save comment"))
    );
  }

  return data({}, await flash(request, success("Comment saved")));
}

export default function MaintenanceDispatchCommentsRoute() {
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const permissions = usePermissions();
  const fetcher = useFetcher();
  const [comment, setComment] = useState("");

  const routeData = useRouteData<{
    comments: MaintenanceDispatchComment[];
  }>(path.to.maintenanceDispatch(dispatchId));

  const comments = routeData?.comments ?? [];

  const handleSubmit = () => {
    if (!comment.trim()) return;

    const formData = new FormData();
    formData.append("comment", comment);
    fetcher.submit(formData, { method: "post" });
    setComment("");
  };

  return (
    <VStack spacing={4}>
      <HStack className="justify-between w-full">
        <h2 className="text-lg font-semibold">Comments</h2>
      </HStack>

      {permissions.can("update", "resources") && (
        <Card>
          <CardContent className="py-4">
            <VStack spacing={2}>
              <Textarea
                placeholder="Add a comment..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
              />
              <HStack className="justify-end w-full">
                <Button
                  variant="primary"
                  leftIcon={<LuSend />}
                  onClick={handleSubmit}
                  isDisabled={!comment.trim()}
                  isLoading={fetcher.state !== "idle"}
                >
                  Post Comment
                </Button>
              </HStack>
            </VStack>
          </CardContent>
        </Card>
      )}

      {comments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No comments yet. Be the first to add a comment.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-4">
                <VStack spacing={2}>
                  <HStack className="justify-between w-full">
                    <HStack>
                      <EmployeeAvatar employeeId={c.createdBy.id} size="xs" />
                    </HStack>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </HStack>
                  <p className="text-sm">{c.comment}</p>
                </VStack>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </VStack>
  );
}
