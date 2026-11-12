// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { actionOutcome, useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
import { useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { receiptLotIssueType } from "~/modules/quality/quality.utils";
import type { IssueTypeListItem } from "~/modules/quality/types";

export function IssueTypeField({
  issueTypes,
  value,
  onChange
}: {
  issueTypes: IssueTypeListItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLingui();
  if (issueTypes.length === 0) {
    return (
      <Alert variant="warning">
        <LuTriangleAlert className="size-4" />
        <AlertTitle>
          <Trans>No issue types configured</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>
            Configure at least one Issue Type. The rejected part of the lot
            needs an NCR.
          </Trans>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-2 w-full">
      <Label htmlFor="nonConformanceTypeId">
        <Trans>Issue Type</Trans>
      </Label>
      <Select value={value} onValueChange={onChange}>
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
  );
}

type OpenNcrModalProps = {
  action: string;
  issueTypes: IssueTypeListItem[];
  isTrackedLot: boolean;
  open?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
};

const OpenNcrModal = ({
  open = true,
  onCancel,
  ...props
}: OpenNcrModalProps) => {
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <OpenNcrBody onCancel={onCancel} {...props} />
      </ModalContent>
    </Modal>
  );
};

const OpenNcrBody = ({
  action,
  issueTypes,
  isTrackedLot,
  onCancel,
  onSubmit
}: Omit<OpenNcrModalProps, "open">) => {
  const fetcher = useAction<{}>({
    onSettled: (data) => {
      if (!submitted.current) return;
      submitted.current = false;
      if (data === undefined || actionOutcome(data) === "success") {
        onSubmit();
      }
    }
  });
  const submitted = useRef(false);
  const [issueTypeId, setIssueTypeId] = useState<string>(
    receiptLotIssueType(issueTypes)?.id ?? ""
  );

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          {isTrackedLot ? (
            <Trans>Open an NCR for the failed units</Trans>
          ) : (
            <Trans>Open NCR</Trans>
          )}
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          <p className="text-sm text-muted-foreground">
            {isTrackedLot ? (
              <Trans>
                This lot is partly accepted. An NCR records the failed units and
                decides what happens to them.
              </Trans>
            ) : (
              <Trans>
                This lot is partly accepted, but its NCR did not open. The NCR
                decides the rejected part of the lot.
              </Trans>
            )}
          </p>
          <IssueTypeField
            issueTypes={issueTypes}
            value={issueTypeId}
            onChange={setIssueTypeId}
          />
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
            name="nonConformanceTypeId"
            value={issueTypeId}
          />
          <input type="hidden" name="createNcr" value="true" />
          <Button
            type="submit"
            isLoading={fetcher.state !== "idle"}
            isDisabled={fetcher.state !== "idle" || !issueTypeId}
          >
            <Trans>Open NCR</Trans>
          </Button>
        </fetcher.Form>
      </ModalFooter>
    </>
  );
};

export default OpenNcrModal;
