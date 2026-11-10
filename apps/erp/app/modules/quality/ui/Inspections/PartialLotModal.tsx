// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { actionOutcome, useAction } from "@carbon/query";
import {
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
  NumberField,
  NumberInput,
  Textarea,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, round } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { useQuantityFormatter } from "~/hooks";
import { receiptLotIssueType } from "~/modules/quality/quality.utils";
import type { IssueTypeListItem } from "~/modules/quality/types";
import { IssueTypeField } from "./OpenNcrModal";

type PartialLotModalProps = {
  action: string;
  issueTypes: IssueTypeListItem[];
  lotSize: number;
  // An untracked lot records how much passed, and its rejected rest stays
  // held until the NCR closes, so the NCR is not optional.
  isUntracked: boolean;
  open?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
};

const PartialLotModal = ({
  open = true,
  onCancel,
  ...props
}: PartialLotModalProps) => {
  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <PartialLotBody onCancel={onCancel} {...props} />
      </ModalContent>
    </Modal>
  );
};

const PartialLotBody = ({
  action,
  issueTypes,
  lotSize,
  isUntracked,
  onCancel,
  onSubmit
}: Omit<PartialLotModalProps, "open">) => {
  const fetcher = useAction<{}>({
    onSettled: (data) => {
      if (!submitted.current) return;
      submitted.current = false;
      // A refusal keeps the dialog open; useAction toasts it.
      if (data === undefined || actionOutcome(data) === "success") {
        onSubmit();
      }
    }
  });
  const submitted = useRef(false);
  const [acceptedQuantity, setAcceptedQuantity] = useState<number>(Number.NaN);
  const [createNcr, setCreateNcr] = useState(true);
  const [reason, setReason] = useState("");
  const [issueTypeId, setIssueTypeId] = useState<string>(
    receiptLotIssueType(issueTypes)?.id ?? ""
  );

  const formatQuantity = useQuantityFormatter();
  const hasIssueTypes = issueTypes.length > 0;
  const ncrRequired = isUntracked;
  const openNcr = ncrRequired || createNcr;
  const acceptedEntered = Number.isFinite(acceptedQuantity);
  const acceptedValid =
    !isUntracked ||
    (acceptedEntered && acceptedQuantity > 0 && acceptedQuantity < lotSize);
  const rejectedQuantity = acceptedEntered
    ? formatQuantity(round(lotSize - acceptedQuantity))
    : null;

  return (
    <>
      <ModalHeader>
        <ModalTitle>
          <Trans>Partial Lot</Trans>
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <VStack spacing={4}>
          <p className="text-sm text-muted-foreground">
            {isUntracked ? (
              <Trans>
                Enter how much of the lot of {lotSize} passed. The accepted
                quantity is ready for putaway. The rest stays held until its NCR
                is closed.
              </Trans>
            ) : (
              <Trans>
                Units that failed a sample stay Rejected. Every other unit,
                including units never sampled, is ready for putaway.
              </Trans>
            )}
          </p>
          {isUntracked && (
            <div className="flex flex-col gap-2 w-full">
              <Label htmlFor="acceptedQuantity">
                <Trans>Accepted quantity</Trans>
              </Label>
              <NumberField
                id="acceptedQuantity"
                value={acceptedQuantity}
                minValue={0}
                maxValue={lotSize}
                step={INPUT_STEP.quantity}
                formatOptions={INPUT_FORMAT.quantity}
                onChange={setAcceptedQuantity}
              >
                <NumberInput />
              </NumberField>
              {rejectedQuantity !== null && acceptedValid && (
                <p className="text-xs text-muted-foreground">
                  <Trans>{rejectedQuantity} will stay held as rejected.</Trans>
                </p>
              )}
              {acceptedEntered && acceptedQuantity >= lotSize && (
                <p className="text-xs text-muted-foreground">
                  <Trans>That is the whole lot. Use Accept Lot instead.</Trans>
                </p>
              )}
              {acceptedEntered && acceptedQuantity <= 0 && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    That is the whole lot rejected. Use Reject Lot instead.
                  </Trans>
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2 w-full">
            <Label htmlFor="partialReason">
              <Trans>Reason (optional)</Trans>
            </Label>
            <Textarea
              id="partialReason"
              value={reason}
              // partialInspection takes at most 2,000 characters.
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {!ncrRequired && (
            <label className="flex items-center gap-2 w-full cursor-pointer">
              <Checkbox
                isChecked={createNcr}
                onCheckedChange={(checked) => setCreateNcr(!!checked)}
              />
              <span className="text-sm font-medium">
                <Trans>Open an NCR for MRB disposition</Trans>
              </span>
            </label>
          )}
          {openNcr && (
            <IssueTypeField
              issueTypes={issueTypes}
              value={issueTypeId}
              onChange={setIssueTypeId}
            />
          )}
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
          {isUntracked && Number.isFinite(acceptedQuantity) && (
            <input
              type="hidden"
              name="acceptedQuantity"
              value={acceptedQuantity}
            />
          )}
          <input
            type="hidden"
            name="createNcr"
            value={openNcr ? "true" : "false"}
          />
          <input
            type="hidden"
            name="nonConformanceTypeId"
            value={openNcr ? issueTypeId : ""}
          />
          <input type="hidden" name="reason" value={reason.trim()} />
          <Button
            type="submit"
            isLoading={fetcher.state !== "idle"}
            isDisabled={
              fetcher.state !== "idle" ||
              !acceptedValid ||
              (openNcr && !hasIssueTypes) ||
              (openNcr && hasIssueTypes && !issueTypeId)
            }
          >
            <Trans>Mark Partial</Trans>
          </Button>
        </fetcher.Form>
      </ModalFooter>
    </>
  );
};

export default PartialLotModal;
