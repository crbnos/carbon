// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Input, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useDisclosure,
  useViewport,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useRef, useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { IssueReviewer } from "~/modules/quality";
import { nonConformanceReviewerValidator } from "~/modules/quality";
import type { Issue } from "~/modules/quality/types";
import type { action as reviewAction } from "~/routes/x+/issue+/$id.review";
import { path } from "~/utils/path";
import { TaskItem, TaskProgress } from "./IssueTask";

export function ReviewersList({
  reviewers,
  isDisabled
}: {
  reviewers: IssueReviewer[];
  isDisabled: boolean;
}) {
  const disclosure = useDisclosure();
  const { isPhone } = useViewport();

  const { t } = useLingui();
  const fetcher = useAction<typeof reviewAction>({
    onSuccess: (data) => {
      if (data?.success && submitted.current) {
        disclosure.onClose();
        submitted.current = false;
      }
    }
  });
  const submitted = useRef(false);
  if (reviewers.length === 0) {
    if (!isPhone) return <NewApprovalRequirement isDisabled={isDisabled} />;
    // Phones: always a card. Its header "Add" opens the same modal as the
    // desktop tile.
    return (
      <Card className="w-full" isCollapsible>
        <HStack className="justify-between w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trans>Approval Requirements</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction className="px-0 pr-14">
            <NewApprovalRequirement isDisabled={isDisabled} trigger="button" />
          </CardAction>
        </HStack>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <Trans>No approval requirements yet.</Trans>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trans>Approval Requirements</Trans>
          </CardTitle>
        </CardHeader>
        {isPhone ? (
          <HStack spacing={0} className="pr-14">
            <TaskProgress tasks={reviewers} className="pr-2" />
            <CardAction className="px-0">
              <Button
                variant="secondary"
                leftIcon={<LuCirclePlus />}
                onClick={disclosure.onOpen}
              >
                <Trans>Add</Trans>
              </Button>
            </CardAction>
          </HStack>
        ) : (
          <TaskProgress tasks={reviewers} />
        )}
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {reviewers.map((reviewer) => (
            <TaskItem
              key={reviewer.id}
              task={reviewer}
              type="review"
              suppliers={[]}
              isDisabled={isDisabled}
            />
          ))}
          {disclosure.isOpen && (
            <Modal
              open
              onOpenChange={(open) => {
                if (!open) disclosure.onClose();
              }}
            >
              <ModalContent>
                <ValidatedForm
                  method="post"
                  validator={nonConformanceReviewerValidator}
                  fetcher={fetcher}
                  onSubmit={() => {
                    submitted.current = true;
                  }}
                >
                  <ModalHeader>
                    <ModalTitle>
                      <Trans>Add Approval Requirement</Trans>
                    </ModalTitle>
                  </ModalHeader>
                  <ModalBody>
                    <Input name="title" label={t`Title`} />
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      isDisabled={fetcher.state === "submitting"}
                      variant="secondary"
                      onClick={disclosure.onClose}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                    <Submit
                      hideShortcutKey
                      isLoading={fetcher.state === "submitting"}
                      isDisabled={fetcher.state === "submitting"}
                    >
                      Submit
                    </Submit>
                  </ModalFooter>
                </ValidatedForm>
              </ModalContent>
            </Modal>
          )}
          <HStack className="max-md:hidden">
            {disclosure.isOpen ? (
              <Button variant="secondary" onClick={disclosure.onClose}>
                <Trans>Cancel</Trans>
              </Button>
            ) : (
              <Button leftIcon={<LuCirclePlus />} onClick={disclosure.onOpen}>
                <Trans>Add Requirement</Trans>
              </Button>
            )}
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
}

function NewApprovalRequirement({
  isDisabled,
  trigger = "tile"
}: {
  isDisabled: boolean;
  /** `button`: a compact "Add" for a card header (phones) instead of the dashed tile. */
  trigger?: "tile" | "button";
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const [isOpen, setIsOpen] = useState(false);
  const [isMRBChecked, setIsMRBChecked] = useState(false);

  const routeData = useRouteData<{
    nonConformance: Issue;
  }>(path.to.issue(id));

  const fetcher = useAction({
    onSettled: (data) => {
      if (data) {
        setIsOpen(false);
        setIsMRBChecked(false);
      }
    }
  });

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "approvalRequirements");

    // Get existing approval requirements and add MRB
    const existingApprovals =
      routeData?.nonConformance?.approvalRequirements ?? [];
    const newApprovals = [...existingApprovals, "MRB"];
    formData.append("value", newApprovals.join(","));

    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateIssue
    });
  }, [id, routeData?.nonConformance?.approvalRequirements, fetcher]);

  return (
    <>
      {trigger === "button" ? (
        <Button
          variant="secondary"
          leftIcon={<LuCirclePlus />}
          isDisabled={isDisabled}
          onClick={() => setIsOpen(true)}
        >
          <Trans>Add</Trans>
        </Button>
      ) : (
        <button
          className="flex items-center justify-start bg-card border-2 border-dashed border-background w-full hover:bg-background/80 rounded-lg px-10 py-6 text-muted-foreground hover:text-foreground gap-2 transition-colors duration-200 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setIsOpen(true)}
          disabled={isDisabled}
        >
          <LuCirclePlus size={16} /> <span>Add Approval Requirement</span>
        </button>
      )}

      <Modal
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsOpen(false);
            setIsMRBChecked(false);
          }
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Approval Requirement</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={2}>
              <label
                htmlFor="mrb-checkbox"
                className="flex items-center gap-2 w-full px-4 py-3 rounded-lg hover:bg-accent hover:text-accent-foreground border border-border cursor-pointer"
              >
                <Checkbox
                  id="mrb-checkbox"
                  isChecked={isMRBChecked}
                  onCheckedChange={(checked) => setIsMRBChecked(!!checked)}
                />
                <span className="text-sm font-medium">MRB</span>
              </label>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsOpen(false);
                setIsMRBChecked(false);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              onClick={handleSubmit}
              isLoading={fetcher.state === "submitting"}
              disabled={!isMRBChecked || fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? (
                <Trans>Adding...</Trans>
              ) : (
                <Trans>Add Requirement</Trans>
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
