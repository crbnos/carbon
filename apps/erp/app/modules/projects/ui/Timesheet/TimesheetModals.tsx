// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Switch,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuChevronRight, LuTriangleAlert } from "react-icons/lu";
import {
  ChargeNumber,
  Hidden,
  Location,
  Number as NumberFormField,
  Select,
  SelectControlled,
  Submit,
  TextArea,
  useChargeNumbers
} from "~/components/Form";
import { path } from "~/utils/path";
import type { RdActivityRole } from "../../projects.models";
import {
  rdActivityRoles,
  timesheetCorrectionValidator,
  timesheetRowValidator
} from "../../projects.models";
import { useRdActivityRoleLabels } from "../RdTax/useRdTaxLabels";

/** A row added to the week, empty until hours are entered. */
export type AddedRow = {
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
};

/**
 * Adds a charge number to the week. `pto` offers only the leave elements
 * (an Indirect project's elements marked Leave), and says how to set one up
 * when the company has none.
 */
export function AddRowModal({
  laborCategories,
  jobLocationId,
  pto = false,
  onAdd,
  onClose
}: {
  laborCategories: {
    id: string;
    name: string;
    rdActivityRole?: RdActivityRole | null;
  }[];
  jobLocationId: string | null;
  pto?: boolean;
  onAdd: (row: AddedRow) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const roleLabels = useRdActivityRoleLabels();
  const hasLeave = useChargeNumbers().some((row) => row.isLeave);
  const [showMore, setShowMore] = useState(false);
  // The user's picks; the defaults follow the chosen labor category.
  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [roleChoice, setRoleChoice] = useState<RdActivityRole | "" | null>(
    null
  );
  const categoryId = categoryChoice ?? laborCategories[0]?.id ?? "";
  const role =
    roleChoice ??
    laborCategories.find((category) => category.id === categoryId)
      ?.rdActivityRole ??
    "";

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetRowValidator}
          defaultValues={{
            projectId: "",
            projectElementId: "",
            laborCategoryId: laborCategories[0]?.id ?? "",
            workLocationId: jobLocationId ?? "",
            rdActivityRole: role
          }}
          onSubmit={(values, event) => {
            event.preventDefault();
            onAdd({
              projectId: values.projectId,
              projectElementId: values.projectElementId || null,
              laborCategoryId: values.laborCategoryId,
              workLocationId: values.workLocationId || null,
              rdActivityRole: values.rdActivityRole || null
            });
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {pto ? <Trans>Add PTO</Trans> : <Trans>Add Charge Number</Trans>}
            </ModalTitle>
            <ModalDescription>
              {pto ? (
                <Trans>Time off is charged to a leave element.</Trans>
              ) : (
                <Trans>It shows with no hours until you add some.</Trans>
              )}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {pto && !hasLeave && (
                <Alert>
                  <LuTriangleAlert />
                  <AlertDescription>
                    <Trans>
                      No leave element is set up. On an Indirect project, open
                      the element for time off and turn on Leave.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}
              <ChargeNumber
                label={pto ? t`Leave` : t`Charge Number`}
                leaveOnly={pto}
              />
              <Select
                name="laborCategoryId"
                label={t`Labor Category`}
                options={laborCategories.map((category) => ({
                  value: category.id,
                  label: category.name
                }))}
                onChange={(option) => {
                  setCategoryChoice(option?.value ?? null);
                  // A new category brings its own default role.
                  setRoleChoice(null);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                rightIcon={showMore ? <LuChevronDown /> : <LuChevronRight />}
                onClick={() => setShowMore((open) => !open)}
              >
                <Trans>More</Trans>
              </Button>
              {/* Hidden, not unmounted: the defaults still submit. */}
              <div
                className={cn(
                  "flex w-full flex-col gap-4",
                  !showMore && "hidden"
                )}
              >
                <Location
                  name="workLocationId"
                  label={t`Work location`}
                  helperText={t`Where the work took place. Decides domestic or foreign research for R&D tax.`}
                />
                <SelectControlled
                  name="rdActivityRole"
                  label={t`Research role`}
                  isOptional
                  value={role}
                  options={rdActivityRoles.map((value) => ({
                    value,
                    label: roleLabels[value]
                  }))}
                  onChange={(option) =>
                    setRoleChoice((option?.value as RdActivityRole) ?? "")
                  }
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false} isDisabled={pto && !hasLeave}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Corrects posted time: a reversal and the new hours. **Move to another
 * charge number** makes it a labor transfer, with the new charge number and
 * labor category defaulted to the original's.
 */
export function CorrectionModal({
  entryId,
  hours,
  label,
  original,
  laborCategories,
  onClose
}: {
  entryId: string;
  hours: number;
  label: string;
  original: {
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
  };
  laborCategories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [moving, setMoving] = useState(false);
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={timesheetCorrectionValidator}
          method="post"
          action={path.to.timesheetCorrect}
          fetcher={fetcher}
          defaultValues={{
            timesheetEntryId: entryId,
            hours,
            correctionReason: "",
            projectId: original.projectId,
            projectElementId: original.projectElementId ?? "",
            laborCategoryId: original.laborCategoryId
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Correct Posted Time</Trans>
            </ModalTitle>
            <ModalDescription>{label}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="timesheetEntryId" />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <NumberFormField
                name="hours"
                label={t`Correct hours`}
                minValue={0}
                maxValue={24}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
                helperText={t`The posted hours are reversed and these hours are charged instead`}
              />
              <Switch
                variant="small"
                label={t`Move to another charge number`}
                checked={moving}
                onCheckedChange={setMoving}
              />
              {/* Unrendered, the fields send nothing: the original's stay. */}
              {moving && (
                <>
                  <ChargeNumber label={t`Charge Number`} />
                  <Select
                    name="laborCategoryId"
                    label={t`Labor Category`}
                    options={laborCategories.map((category) => ({
                      value: category.id,
                      label: category.name
                    }))}
                  />
                </>
              )}
              <TextArea name="correctionReason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Submit Correction</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
