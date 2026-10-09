// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Textarea
} from "@carbon/react";
import { tiptapToText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  LuArrowLeft,
  LuCheck,
  LuMessageSquare,
  LuPencil,
  LuTrash2,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { Hidden, Submit, TextArea } from "~/components/Form";
import { useDateFormatter, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type {
  ProjectChangeRequestIntent,
  ProjectPlanTable
} from "../../projects.models";
import { projectChangeRequestCommentValidator } from "../../projects.models";
import type { ChangeRequestReview as Review } from "../../projects.server";
import type { ProjectChangeRequestComment } from "../../types";
import { PlanDiffGroups, planDiffGroups } from "../Baselines/PlanDiffViewer";
import ChangeRequestStatus from "./ChangeRequestStatus";

type ChangeRequestReviewProps = {
  projectId: string;
  review: Review;
  /** The user may approve or reject: an approver of the pending request, else `update: projects`. */
  canDecide: boolean;
  canUpdate: boolean;
};

type CommentTarget = {
  targetTable: ProjectPlanTable | null;
  targetId: string | null;
  field: string | null;
  label: string;
};

/**
 * The review page of a change request: its header with the lifecycle
 * actions, then one card per changed element with a Viewed mark, its changed
 * fields (each with a comment action), its plan lines and links, and the
 * comments on it.
 */
const ChangeRequestReview = ({
  projectId,
  review,
  canDecide,
  canUpdate
}: ChangeRequestReviewProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { changeRequest, diff, comments, conflicts } = review;
  const statusFetcher = useFetcher();
  const viewedFetcher = useFetcher();
  const [commenting, setCommenting] = useState<CommentTarget | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const groups = useMemo(() => planDiffGroups(diff), [diff]);
  const elementIds = useMemo(
    () => new Set(groups.map(({ entry }) => (entry.after ?? entry.before)!.id)),
    [groups]
  );
  // A pending mark shows at once; the loader's list is the rest.
  const pendingViewed =
    viewedFetcher.formData?.get("targetId")?.toString() ?? null;
  const viewed = new Set(
    review.viewedElementIds.filter((id) => elementIds.has(id))
  );
  if (pendingViewed) {
    if (viewedFetcher.formData?.get("viewed") === "true") {
      viewed.add(pendingViewed);
    } else {
      viewed.delete(pendingViewed);
    }
  }

  const status = changeRequest.status;
  const statusAction = path.to.projectChangeRequestStatus(
    projectId,
    changeRequest.id
  );
  const isBusy = statusFetcher.state !== "idle";
  const post = (intent: ProjectChangeRequestIntent) =>
    statusFetcher.submit({ intent }, { method: "post", action: statusAction });

  const commentsOf = (
    targetTable: string | null,
    targetId: string | null,
    field: string | null
  ) =>
    comments.filter(
      (comment) =>
        (comment.targetTable ?? null) === targetTable &&
        (comment.targetId ?? null) === targetId &&
        (comment.field ?? null) === field
    );

  const reason = tiptapToText(changeRequest.reason as never);
  const liveElementIds = new Set(review.liveElementIds);

  return (
    <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          aria-label={t`Back to change requests`}
          icon={<LuArrowLeft />}
          variant="ghost"
          size="sm"
          onClick={() => navigate(path.to.projectChangeRequests(projectId))}
        />
        <span className="whitespace-nowrap text-base font-medium">
          {changeRequest.readableId}
        </span>
        <span className="min-w-0 truncate text-base">
          {changeRequest.title}
        </span>
        <ChangeRequestStatus status={status} />
        <EmployeeAvatar employeeId={changeRequest.createdBy} size="xs" />
        <span className="text-xs text-muted-foreground tabular-nums">
          <Trans>Items changed {groups.length}</Trans>
          {" · "}
          <Trans>
            {viewed.size}/{groups.length} viewed
          </Trans>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status === "Draft" && (
            <>
              <Button variant="secondary" leftIcon={<LuPencil />} asChild>
                <Link
                  to={`${path.to.projectElements(projectId)}?cr=${changeRequest.id}`}
                >
                  <Trans>Edit Plan</Trans>
                </Link>
              </Button>
              <Button
                variant="secondary"
                isDisabled={!canUpdate || isBusy}
                onClick={() => post("cancel")}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isDisabled={!canUpdate || isBusy || groups.length === 0}
                isLoading={isBusy}
                onClick={() => post("submit")}
              >
                <Trans>Submit</Trans>
              </Button>
            </>
          )}
          {status === "In Review" && (
            <>
              <Button
                variant="secondary"
                isDisabled={!canUpdate || isBusy}
                onClick={() => post("cancel")}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="destructive"
                isDisabled={!canDecide || isBusy}
                onClick={() => setRejecting(true)}
              >
                <Trans>Reject</Trans>
              </Button>
              <Button
                isDisabled={!canDecide || isBusy}
                isLoading={isBusy}
                onClick={() => post("approve")}
              >
                <Trans>Approve</Trans>
              </Button>
            </>
          )}
          {(status === "Rejected" || status === "Approved") && (
            <Button
              isDisabled={!canUpdate || isBusy}
              isLoading={isBusy}
              onClick={() => post("reopen")}
            >
              <Trans>Reopen</Trans>
            </Button>
          )}
        </div>
      </div>

      {(reason || changeRequest.decisionNotes) && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          {reason && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                <Trans>Reason</Trans>
              </span>
              <p className="whitespace-pre-wrap">{reason}</p>
            </div>
          )}
          {changeRequest.decisionNotes && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                <Trans>Decision notes</Trans>
              </span>
              <p className="whitespace-pre-wrap">
                {changeRequest.decisionNotes}
              </p>
            </div>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>The live plan changed under this change request</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>
              <Trans>
                It is approved but cannot apply. Reopen it, check these rows,
                then submit it again.
              </Trans>
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {conflicts.map((conflict) => (
                <li key={`${conflict.targetTable}:${conflict.targetId}`}>
                  {conflict.elementId &&
                  liveElementIds.has(conflict.elementId) ? (
                    <Link
                      className="font-medium underline"
                      to={path.to.projectElement(projectId, conflict.elementId)}
                    >
                      {conflict.elementLabel}
                    </Link>
                  ) : (
                    <span className="font-medium">{conflict.elementLabel}</span>
                  )}{" "}
                  {conflict.missing ? (
                    <Trans>no longer exists in the live plan</Trans>
                  ) : (
                    <Trans>changed live: {conflict.fields.join(", ")}</Trans>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <PlanDiffGroups
        diff={diff}
        laborCategoryNames={review.laborCategoryNames}
        extras={{
          element: (elementId, entry) => {
            const row = (entry.after ?? entry.before)!;
            const label = String(row.readableId || row.name || "");
            const rowComments = commentsOf("projectElement", elementId, null);
            return (
              <div className="flex w-full flex-col gap-2 pb-1">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      isChecked={viewed.has(elementId)}
                      onCheckedChange={(checked) =>
                        viewedFetcher.submit(
                          {
                            targetTable: "projectElement",
                            targetId: elementId,
                            viewed: checked === true ? "true" : "false"
                          },
                          {
                            method: "post",
                            action: path.to.projectChangeRequestViewed(
                              projectId,
                              changeRequest.id
                            )
                          }
                        )
                      }
                    />
                    <Trans>Viewed</Trans>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<LuMessageSquare />}
                    onClick={() =>
                      setCommenting({
                        targetTable: "projectElement",
                        targetId: elementId,
                        field: null,
                        label
                      })
                    }
                  >
                    <Trans>Comment</Trans>
                  </Button>
                </div>
                <CommentList
                  projectId={projectId}
                  changeRequestId={changeRequest.id}
                  comments={rowComments}
                  canUpdate={canUpdate}
                />
              </div>
            );
          },
          field: (target, field, fieldLabel) => ({
            action: (
              <IconButton
                aria-label={t`Comment on ${fieldLabel}`}
                icon={<LuMessageSquare />}
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCommenting({
                    targetTable: target.table,
                    targetId: target.id,
                    field,
                    label: fieldLabel
                  })
                }
              />
            ),
            below: (
              <CommentList
                projectId={projectId}
                changeRequestId={changeRequest.id}
                comments={commentsOf(target.table, target.id, field)}
                canUpdate={canUpdate}
              />
            )
          })
        }}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            <Trans>Comments</Trans>
          </span>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuMessageSquare />}
            onClick={() =>
              setCommenting({
                targetTable: null,
                targetId: null,
                field: null,
                label: changeRequest.readableId
              })
            }
          >
            <Trans>Comment</Trans>
          </Button>
        </div>
        <CommentList
          projectId={projectId}
          changeRequestId={changeRequest.id}
          comments={commentsOf(null, null, null)}
          canUpdate={canUpdate}
          empty={
            <span className="text-xs text-muted-foreground">
              <Trans>No comments on the change request as a whole.</Trans>
            </span>
          }
        />
      </div>

      {commenting && (
        <CommentForm
          projectId={projectId}
          changeRequestId={changeRequest.id}
          target={commenting}
          onClose={() => setCommenting(null)}
        />
      )}
      {rejecting && (
        <RejectForm
          onReject={(notes) => {
            statusFetcher.submit(
              { intent: "reject", notes },
              { method: "post", action: statusAction }
            );
            setRejecting(false);
          }}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  );
};

function CommentList({
  projectId,
  changeRequestId,
  comments,
  canUpdate,
  empty = null
}: {
  projectId: string;
  changeRequestId: string;
  comments: ProjectChangeRequestComment[];
  canUpdate: boolean;
  empty?: ReactNode;
}) {
  const { t } = useLingui();
  const user = useUser();
  const fetcher = useFetcher();
  const { formatDateTime } = useDateFormatter();
  const action = path.to.projectChangeRequestComments(
    projectId,
    changeRequestId
  );
  if (comments.length === 0) return <>{empty}</>;

  return (
    <div className="flex w-full flex-col gap-1.5 pl-2">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="flex w-full min-w-0 items-start gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
        >
          <EmployeeAvatar employeeId={comment.createdBy} size="xxs" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="whitespace-pre-wrap break-words text-sm">
              {comment.comment}
            </p>
            <span className="text-muted-foreground tabular-nums">
              {formatDateTime(comment.createdAt)}
              {comment.resolvedAt && (
                <>
                  {" · "}
                  <Trans>Resolved</Trans>
                </>
              )}
            </span>
          </div>
          {!comment.resolvedAt && (
            <IconButton
              aria-label={t`Resolve`}
              icon={<LuCheck />}
              variant="ghost"
              size="sm"
              isDisabled={!canUpdate}
              onClick={() =>
                fetcher.submit(
                  { intent: "resolve", id: comment.id },
                  { method: "post", action }
                )
              }
            />
          )}
          {comment.createdBy === user.id && (
            <IconButton
              aria-label={t`Delete comment`}
              icon={<LuTrash2 />}
              variant="ghost"
              size="sm"
              onClick={() =>
                fetcher.submit(
                  { intent: "delete", id: comment.id },
                  { method: "post", action }
                )
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Adds a comment on the change request, an element or one changed field. */
function CommentForm({
  projectId,
  changeRequestId,
  target,
  onClose
}: {
  projectId: string;
  changeRequestId: string;
  target: CommentTarget;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={projectChangeRequestCommentValidator}
            method="post"
            action={path.to.projectChangeRequestComments(
              projectId,
              changeRequestId
            )}
            defaultValues={{ comment: "" }}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Comment on {target.label}</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="intent" value="create" />
              <Hidden name="targetTable" value={target.targetTable ?? ""} />
              <Hidden name="targetId" value={target.targetId ?? ""} />
              <Hidden name="field" value={target.field ?? ""} />
              <TextArea name="comment" label={t`Comment`} autoFocus />
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>
                  <Trans>Comment</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}

/** Asks for the notes for the author, then rejects the change request. */
function RejectForm({
  onReject,
  onClose
}: {
  onReject: (notes: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [notes, setNotes] = useState("");

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Reject Change Request</Trans>
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <Textarea
              aria-label={t`Notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t`What should the author change?`}
              autoFocus
            />
          </ModalDrawerBody>
          <ModalDrawerFooter>
            <HStack>
              <Button variant="destructive" onClick={() => onReject(notes)}>
                <Trans>Reject</Trans>
              </Button>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </ModalDrawerFooter>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}

export default ChangeRequestReview;
