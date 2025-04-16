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
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { LuCirclePlus } from "react-icons/lu";

import { assertIsPost, error } from "@carbon/auth";
import { useEffect, useRef } from "react";
import type { NonConformanceReviewer } from "~/modules/quality";
import {
  getNonConformanceReviewers,
  insertNonConformanceReviewer,
  nonConformanceReviewerValidator,
} from "~/modules/quality";
import {
  TaskItem,
  TaskProgress,
} from "~/modules/quality/ui/NonConformance/NonConformanceTask";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Non-conformance ID is required");

  const reviewers = await getNonConformanceReviewers(client, id, companyId);

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

  const updateCurrency = await insertNonConformanceReviewer(client, {
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

export default function NonConformanceReviewers() {
  const { reviewers } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2} className="w-full">
      <ReviewersList reviewers={reviewers} />
    </VStack>
  );
}

function ReviewersList({ reviewers }: { reviewers: NonConformanceReviewer[] }) {
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
            <TaskItem key={reviewer.id} task={reviewer} type="review" />
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
