import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import {
  DatePicker,
  Hidden,
  LocationEmployee,
  Submit
} from "~/components/Form";
import { peopleAbsenceRangeValidator } from "~/modules/production";
import { path } from "~/utils/path";

type TimeOffDialogProps = {
  onClose: () => void;
  /** initial value of both range ends — the board's selected day */
  date: string;
  locationId: string;
  shiftId: string | null;
};

/**
 * Time-off range: one action marks the person off for every day between the
 * two dates (`absent-range` intent — a week of vacation is one entry).
 */
export function TimeOffDialog({
  onClose,
  date,
  locationId,
  shiftId
}: TimeOffDialogProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<Record<string, never>>();
  const [fromDate, setFromDate] = useState(date);
  const [toDate, setToDate] = useState(date);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={peopleAbsenceRangeValidator}
          method="post"
          action={path.to.priorityPeopleUpdate}
          fetcher={fetcher}
          defaultValues={{
            employeeId: "",
            fromDate,
            toDate
          }}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Time off</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="absent-range" />
            <Hidden name="shiftId" value={shiftId ?? ""} />
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground text-pretty">
                <Trans>
                  Marks the person off for every day in the range. They won't be
                  scheduled while they're away.
                </Trans>
              </p>
              <LocationEmployee
                name="employeeId"
                label={t`Employee`}
                locationId={locationId}
              />
              <HStack className="w-full items-start" spacing={4}>
                <DatePicker
                  name="fromDate"
                  label={t`From`}
                  value={fromDate}
                  maxValue={parseDate(toDate)}
                  onChange={(value) => {
                    if (value) setFromDate(value);
                  }}
                />
                <DatePicker
                  name="toDate"
                  label={t`To`}
                  value={toDate}
                  minValue={parseDate(fromDate)}
                  onChange={(value) => {
                    if (value) setToDate(value);
                  }}
                />
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit>
                <Trans>Mark absent</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
