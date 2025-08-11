import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Input, Submit, ValidatedForm, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { LuCirclePlus } from "react-icons/lu";

import { assertIsPost, error } from "@carbon/auth";
import { useEffect, useRef } from "react";
import { useRouteData } from "~/hooks";
import type { Issue, IssueReviewer } from "~/modules/quality";
import {
  getIssueReviewers,
  insertIssueReviewer,
  nonConformanceReviewerValidator,
} from "~/modules/quality";
import { TaskItem, TaskProgress } from "~/modules/quality/ui/Issue/IssueTask";
import { path } from "~/utils/path";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const reviewers = await getIssueReviewers(client, id, companyId);

  return json({
    reviewers: reviewers.data || [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const formData = await request.formData();
  const validation = await validator(nonConformanceReviewerValidator).validate(
    formData
  );

  if (validation.error) {
    return json(
      {
        success: false,
      },
      await flash(request, error(validation.error, "Invalid reviewer"))
    );
  }

  const updateCurrency = await insertIssueReviewer(client, {
    ...validation.data,
    nonConformanceId: id,
    companyId,
    createdBy: userId,
  });

  if (updateCurrency.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(updateCurrency.error, "Failed to insert reviewer")
      )
    );
  }

  return json({
    success: true,
  });
}

export default function IssueReviewers() {
  const { reviewers } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Non-conformance ID is required");
  const routeData = useRouteData<{
    nonConformance: Issue;
  }>(path.to.issue(id));

  return (
    <VStack spacing={2} className="w-full">
      <ReviewersList
        reviewers={reviewers}
        isDisabled={routeData?.nonConformance.status === "Closed"}
      />
    </VStack>
  );
}

function ReviewersList({
  reviewers,
  isDisabled,
}: {
  reviewers: IssueReviewer[];
  isDisabled: boolean;
}) {
  const disclosure = useDisclosure();

  const fetcher = useFetcher<typeof action>();
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.data?.success && submitted.current) {
      disclosure.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data?.success]);

  return (
    <Card className="w-full min-h-[calc(100vh-115px)]" isCollapsible>
      <HStack className="justify-between w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Reviewers</CardTitle>
        </CardHeader>
        <TaskProgress tasks={reviewers} />
      </HStack>
      <CardContent>
        <VStack spacing={3}>
          {reviewers.map((reviewer) => (
            <TaskItem
              key={reviewer.id}
              task={reviewer}
              type="review"
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
                    <ModalTitle>Add Reviewer</ModalTitle>
                  </ModalHeader>
                  <ModalBody>
                    <Input name="title" label="Title" />
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      isDisabled={fetcher.state === "submitting"}
                      variant="secondary"
                      onClick={disclosure.onClose}
                    >
                      Cancel
                    </Button>
                    <Submit
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
          <HStack>
            {disclosure.isOpen ? (
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
            ) : (
              <Button leftIcon={<LuCirclePlus />} onClick={disclosure.onOpen}>
                Add Reviewer
              </Button>
            )}
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
}
