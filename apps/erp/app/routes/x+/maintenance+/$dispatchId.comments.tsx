// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  HStack,
  Textarea,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuSend } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { data, useFetcher, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { maintenanceDispatchCommentValidator } from "~/modules/resources/resources.models";
import type { MaintenanceDispatchComment } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    maintenanceDispatchCommentValidator.omit({ maintenanceDispatchId: true })
  ).request(args, { params: ["dispatchId"] });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.resources.createMaintenanceDispatchComment({
    comment: input.data.comment,
    maintenanceDispatchId: input.params.dispatchId
  });
  // The comment box posts through a plain fetcher: the flash is its toast.
  return data(
    result,
    await flash(
      args.request,
      result.error
        ? error(null, result.error.message)
        : success("Comment saved")
    )
  );
}

export default function MaintenanceDispatchCommentsRoute() {
  const { t } = useLingui();
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
        <h2 className="text-lg font-semibold">
          <Trans>Comments</Trans>
        </h2>
      </HStack>

      {permissions.has({ "resources.dispatches": "Edit" }) && (
        <Card>
          <CardContent className="py-4">
            <VStack spacing={2}>
              <Textarea
                aria-label={t`Comment`}
                placeholder={t`Add a comment...`}
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
                  <Trans>Post Comment</Trans>
                </Button>
              </HStack>
            </VStack>
          </CardContent>
        </Card>
      )}

      {comments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Trans>No comments yet. Be the first to add a comment.</Trans>
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
                      <DateTime value={c.createdAt} variant="absolute" />
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
