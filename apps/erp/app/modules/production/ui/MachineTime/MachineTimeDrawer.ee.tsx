// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Separator,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Combobox, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  assignMachineTimeValidator,
  dismissMachineTimeValidator
} from "../../production.models";
import type { UnattributedMachineTime } from "./MachineTimeTable.ee";
import {
  MachineTimeInstant,
  MachineTimeStatus,
  useMachineTimeDuration,
  useMachineTimeZone
} from "./MachineTimeTable.ee";

type MachineTimeDrawerProps = {
  machineTime: UnattributedMachineTime;
  operationOptions: { value: string; label: string; helper?: string }[];
  onClose: () => void;
};

function Detail({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

const MachineTimeDrawer = ({
  machineTime,
  operationOptions,
  onClose
}: MachineTimeDrawerProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const duration = useMachineTimeDuration();
  const timeZoneOf = useMachineTimeZone();

  const timeZone = timeZoneOf(machineTime);
  const isRunning = !machineTime.endTime;
  const isOpen = machineTime.status === "Open";
  const isDisabled = !permissions.can("update", "production");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Unattributed machine time</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <VStack spacing={2} className="w-full">
              <Detail label={<Trans>Work Center</Trans>}>
                {machineTime.workCenter?.name ?? machineTime.workCenterId}
              </Detail>
              <Detail label={<Trans>Start</Trans>}>
                <MachineTimeInstant
                  value={machineTime.startTime}
                  timeZone={timeZone}
                />
              </Detail>
              <Detail label={<Trans>End</Trans>}>
                {machineTime.endTime ? (
                  <MachineTimeInstant
                    value={machineTime.endTime}
                    timeZone={timeZone}
                  />
                ) : (
                  <Trans>Running</Trans>
                )}
              </Detail>
              <Detail label={<Trans>Duration</Trans>}>
                {duration(machineTime.startTime, machineTime.endTime) ?? (
                  <Trans>Running</Trans>
                )}
              </Detail>
              <Detail label={<Trans>Status</Trans>}>
                <MachineTimeStatus status={machineTime.status} />
              </Detail>
              {!isOpen && machineTime.resolvedAt && (
                <Detail label={<Trans>Resolved</Trans>}>
                  <MachineTimeInstant
                    value={machineTime.resolvedAt}
                    timeZone={timeZone}
                  />
                </Detail>
              )}
              {machineTime.status === "Dismissed" &&
                machineTime.dismissReason && (
                  <Detail label={<Trans>Reason</Trans>}>
                    {machineTime.dismissReason}
                  </Detail>
                )}
              {machineTime.status === "Assigned" && (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This time was recorded as a machine production event on the
                    job.
                  </Trans>
                </p>
              )}
            </VStack>

            {isOpen && isRunning && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  The machine is still running. Assign or dismiss this time
                  after it stops.
                </Trans>
              </p>
            )}

            {isOpen && !isRunning && (
              <>
                <Separator />
                <ValidatedForm
                  id="assignMachineTime"
                  validator={assignMachineTimeValidator}
                  method="post"
                  defaultValues={{ intent: "assign", jobOperationId: "" }}
                  className="w-full"
                >
                  <VStack spacing={4}>
                    <Hidden name="intent" value="assign" />
                    <Combobox
                      name="jobOperationId"
                      label={t`Operation`}
                      termId="operation"
                      options={operationOptions}
                    />
                    <Submit isDisabled={isDisabled}>
                      <Trans>Assign</Trans>
                    </Submit>
                  </VStack>
                </ValidatedForm>
                <Separator />
                <ValidatedForm
                  id="dismissMachineTime"
                  validator={dismissMachineTimeValidator}
                  method="post"
                  defaultValues={{ intent: "dismiss", dismissReason: "" }}
                  className="w-full"
                >
                  <VStack spacing={4}>
                    <Hidden name="intent" value="dismiss" />
                    <TextArea
                      name="dismissReason"
                      label={t`Reason`}
                      placeholder={t`For example warm-up, prove-out or maintenance`}
                    />
                    <Submit isDisabled={isDisabled} variant="secondary">
                      <Trans>Dismiss</Trans>
                    </Submit>
                  </VStack>
                </ValidatedForm>
              </>
            )}
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default MachineTimeDrawer;
