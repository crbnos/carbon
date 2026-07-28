import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { IssueTypeListItem } from "~/modules/quality/types";

export type FailedFeatureSummary = {
  label: string;
  spec: string;
  failedValues: string[];
};

type RejectLotModalProps = {
  action: string;
  issueTypes: IssueTypeListItem[];
  summary: string;
  // Document-driven lots: the features that failed, previewed here and
  // written into the NCR description by the reject action.
  failedFeatureSummary?: FailedFeatureSummary[];
  onCancel: () => void;
  onSubmit: () => void;
};

const RejectLotModal = ({
  action,
  issueTypes,
  summary,
  failedFeatureSummary,
  onCancel,
  onSubmit
}: RejectLotModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  const [createNcr, setCreateNcr] = useState(true);
  const [issueTypeId, setIssueTypeId] = useState<string>(
    issueTypes[0]?.id ?? ""
  );

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  const hasIssueTypes = issueTypes.length > 0;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Reject Lot</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">{summary}</p>
            {failedFeatureSummary && failedFeatureSummary.length > 0 && (
              <div className="w-full rounded-md border p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  <Trans>Failed features</Trans>
                </p>
                <ul className="flex flex-col gap-0.5">
                  {failedFeatureSummary.map((feature) => (
                    <li
                      key={feature.label}
                      className="font-mono text-xs text-red-500"
                    >
                      {feature.label}
                      {feature.spec ? ` (${feature.spec})` : ""}
                      {feature.failedValues.length > 0
                        ? `: ${feature.failedValues.join(", ")}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="flex items-center gap-2 w-full cursor-pointer">
              <Checkbox
                isChecked={createNcr}
                onCheckedChange={(checked) => setCreateNcr(!!checked)}
              />
              <span className="text-sm font-medium">
                <Trans>Open an NCR for MRB disposition</Trans>
              </span>
            </label>
            {createNcr &&
              (hasIssueTypes ? (
                <div className="flex flex-col gap-2 w-full">
                  <Label htmlFor="nonConformanceTypeId">
                    <Trans>Issue Type</Trans>
                  </Label>
                  <Select value={issueTypeId} onValueChange={setIssueTypeId}>
                    <SelectTrigger id="nonConformanceTypeId">
                      <SelectValue placeholder={t`Select an issue type`} />
                    </SelectTrigger>
                    <SelectContent>
                      {issueTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Alert variant="warning">
                  <LuTriangleAlert className="size-4" />
                  <AlertTitle>
                    <Trans>No issue types configured</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      The lot will still be rejected, but an NCR cannot be
                      created until at least one Issue Type is configured.
                    </Trans>
                  </AlertDescription>
                </Alert>
              ))}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={action}
            onSubmit={() => (submitted.current = true)}
          >
            <input
              type="hidden"
              name="createNcr"
              value={createNcr ? "true" : "false"}
            />
            <input
              type="hidden"
              name="nonConformanceTypeId"
              value={createNcr ? issueTypeId : ""}
            />
            <Button
              variant="destructive"
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" ||
                (createNcr && hasIssueTypes && !issueTypeId)
              }
            >
              <Trans>Reject Lot</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RejectLotModal;
