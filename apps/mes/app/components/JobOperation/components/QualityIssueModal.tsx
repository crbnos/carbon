import type { Result } from "@carbon/auth";
import { Hidden, Select, Submit, TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { qualityIssuePriority, qualityIssueValidator } from "~/services/models";
import { path } from "~/utils/path";

export function QualityIssueModal({
  operationId,
  trackedEntityId,
  isOpen,
  onClose
}: {
  operationId: string;
  trackedEntityId?: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<Result>();
  const issueTypeFetcher =
    useFetcher<PostgrestResponse<{ id: string; name: string }>>();

  const issueTypes = issueTypeFetcher.data?.data ?? [];

  useEffect(() => {
    if (isOpen) {
      issueTypeFetcher.load(path.to.api.qualityIssueTypes);
    }
  }, [isOpen, issueTypeFetcher.load]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(t`Quality issue created`);
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose, t]);

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.qualityIssueNew}
          validator={qualityIssueValidator}
          defaultValues={{
            jobOperationId: operationId,
            description: "",
            nonConformanceTypeId: issueTypes[0]?.id ?? "",
            priority: "Medium" as const,
            trackedEntityId: trackedEntityId ?? ""
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Quality Issue</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobOperationId" value={operationId} />
            {trackedEntityId && (
              <Hidden name="trackedEntityId" value={trackedEntityId} />
            )}
            <VStack spacing={4}>
              <Select
                name="nonConformanceTypeId"
                label={t`Issue Type`}
                size="lg"
                options={issueTypes.map((type) => ({
                  value: type.id,
                  label: type.name
                }))}
              />
              <Select
                name="priority"
                label={t`Priority`}
                size="lg"
                options={qualityIssuePriority.map((p) => ({
                  value: p,
                  label: p
                }))}
              />
              <TextArea
                name="description"
                label={t`Description`}
                placeholder={t`Describe the problem...`}
                size="lg"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" size="lg" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit size="lg" isLoading={fetcher.state !== "idle"}>
                <Trans>Create Issue</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
