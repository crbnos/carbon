// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { FinancingOverride } from "@carbon/ee/contract-financing";
import {
  ESTIMATE_MAX_AGE_MONTHS,
  financingApproveValidator,
  financingOverrideValidator,
  SF1443_LINE_LABELS,
  SF1443_LINES,
  SF1443_OVERRIDABLE_LINES,
  type Sf1443Line,
  type Sf1443OverridableLine
} from "@carbon/ee/contract-financing";
import type { FinancingRequestDetail } from "@carbon/ee/contract-financing.server";
import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  Hidden,
  Number as NumberField,
  Submit,
  TextArea
} from "~/components/Form";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import { FinancingStatus } from "./ContractFinancing.ee";

const PBP_VALUES = ["1a", "1b", "1c", "2"] as const;

/**
 * One financing request: the SF 1443 lines with the computed value and any
 * override beside it, or the events a PBP request bills. Actions follow the
 * status: Submit and Withdraw on a Draft, Approve and Withdraw once
 * Submitted, Record Payment once Approved, Print always.
 */
export default function ContractFinancingRequest({
  contractId,
  request,
  onClose
}: {
  contractId: string;
  request: FinancingRequestDetail;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const formatMoney = useCurrencyFormatter({ currency });
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "sales");
  const fetcher = useFetcher();
  const [editing, setEditing] = useState<Sf1443OverridableLine | null>(null);
  const [approving, setApproving] = useState(false);
  const action = path.to.contractFinancingRequest(contractId, request.id);
  const isPbp = request.financingMethod === "Performance-Based Payments";
  const lines = (request.lines ?? {}) as Record<string, number | boolean>;
  const overrides = (request.overrides ?? {}) as Record<
    string,
    FinancingOverride
  >;
  const isDraft = request.status === "Draft";
  const busy = fetcher.state !== "idle";

  const estimateIsOld =
    !isPbp &&
    request.estimateDate !== null &&
    parseDate(request.estimateDate)
      .add({ months: ESTIMATE_MAX_AGE_MONTHS })
      .compare(parseDate(request.requestDate)) < 0;

  const submit = (intent: string) =>
    fetcher.submit({ intent }, { method: "post", action });

  const amount = (value: number | boolean | undefined) =>
    typeof value === "number" ? formatMoney.format(value) : "—";

  const visibleLines = SF1443_LINES.filter(
    (line) =>
      lines.hasSection3 === true ||
      !(
        line.startsWith("20") ||
        line.startsWith("21") ||
        ["22", "23", "24", "25"].includes(line)
      )
  );

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            {request.requestNumber
              ? t`Request ${request.requestNumber}`
              : t`Draft Request`}
          </DrawerTitle>
          <HStack spacing={2}>
            <FinancingStatus status={request.status} />
            <span className="text-sm text-muted-foreground">
              <Trans>
                {request.financingMethod} · costs through{" "}
                {formatDate(request.costsThroughDate)}
              </Trans>
            </span>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            {estimateIsOld && (
              <Alert variant="warning">
                <AlertDescription>
                  <Trans>
                    The estimate to complete is more than{" "}
                    {ESTIMATE_MAX_AGE_MONTHS} months old. Update it before you
                    submit.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
            {request.paymentReadableId && request.paymentId && (
              <p className="text-sm">
                <Trans>Payment</Trans>{" "}
                <Link
                  to={path.to.payment(request.paymentId)}
                  className="font-medium hover:underline"
                >
                  {request.paymentReadableId}
                </Link>{" "}
                ({request.paymentStatus})
              </p>
            )}
            {isPbp ? (
              <>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Event</Trans>
                      </Th>
                      <Th>
                        <Trans>Description</Trans>
                      </Th>
                      <Th>
                        <Trans>CLIN</Trans>
                      </Th>
                      <Th className="text-right">
                        <Trans>Amount</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {request.events.map((event) => (
                      <Tr key={event.id}>
                        <Td className="tabular-nums">{event.eventCode}</Td>
                        <Td>{event.description}</Td>
                        <Td>{event.lineItemNumber ?? t`Whole contract`}</Td>
                        <Td className="text-right tabular-nums">
                          {formatMoney.format(event.amount)}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
                <Table>
                  <Tbody>
                    {PBP_VALUES.map((key) => (
                      <Tr key={key}>
                        <Td className="w-12 tabular-nums">{key}</Td>
                        <Td>
                          {key === "1a"
                            ? t`Value of events completed earlier`
                            : key === "1b"
                              ? t`Value of the events in this request`
                              : key === "1c"
                                ? t`Cumulative value`
                                : t`Total costs incurred to date`}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {amount(lines[key])}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th className="w-12">
                      <Trans>Line</Trans>
                    </Th>
                    <Th />
                    <Th className="text-right">
                      <Trans>Computed</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Override</Trans>
                    </Th>
                    <Th className="w-10" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visibleLines.map((line) => {
                    const override = overrides[line];
                    const canOverride =
                      isDraft &&
                      canUpdate &&
                      (SF1443_OVERRIDABLE_LINES as readonly string[]).includes(
                        line
                      );
                    return (
                      <Tr key={line}>
                        <Td className="tabular-nums">{line}</Td>
                        <Td>
                          <span>{SF1443_LINE_LABELS[line as Sf1443Line]}</span>
                          {override && (
                            <span className="block text-xs text-muted-foreground">
                              {override.reason}
                            </span>
                          )}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {amount(lines[line])}
                        </Td>
                        <Td className="text-right tabular-nums font-medium">
                          {override ? formatMoney.format(override.value) : ""}
                        </Td>
                        <Td>
                          {canOverride && (
                            <IconButton
                              aria-label={t`Override line ${line}`}
                              icon={<LuPencil />}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setEditing(line as Sf1443OverridableLine)
                              }
                            />
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
            <div className="flex w-full justify-between border-t border-border pt-2 text-sm font-medium">
              <span>
                <Trans>Amount of this request</Trans>
              </span>
              <span className="tabular-nums">
                {formatMoney.format(Number(request.requestedAmount))}
              </span>
            </div>
            {request.approvedAmount !== null && (
              <div className="flex w-full justify-between text-sm">
                <span>
                  <Trans>Approved</Trans>
                </span>
                <span className="tabular-nums">
                  {formatMoney.format(Number(request.approvedAmount))}
                </span>
              </div>
            )}
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            <Button variant="secondary" asChild>
              <a
                href={path.to.file.contractFinancingRequest(request.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>Print</Trans>
              </a>
            </Button>
            {(isDraft || request.status === "Submitted") && (
              <Button
                variant="secondary"
                isDisabled={!canUpdate || busy}
                onClick={() => submit("withdraw")}
              >
                {isDraft ? <Trans>Delete</Trans> : <Trans>Withdraw</Trans>}
              </Button>
            )}
            {isDraft && (
              <Button
                isDisabled={!canUpdate || busy}
                isLoading={busy}
                onClick={() => submit("submit")}
              >
                <Trans>Submit</Trans>
              </Button>
            )}
            {request.status === "Submitted" && (
              <Button
                isDisabled={!canUpdate}
                onClick={() => setApproving(true)}
              >
                <Trans>Approve</Trans>
              </Button>
            )}
            {request.status === "Approved" && !request.paymentId && (
              <Button
                isDisabled={
                  !canUpdate || !permissions.can("create", "invoicing") || busy
                }
                isLoading={busy}
                onClick={() => submit("record-payment")}
              >
                <Trans>Record Payment</Trans>
              </Button>
            )}
          </HStack>
        </DrawerFooter>
      </DrawerContent>

      {editing && (
        <Modal open onOpenChange={(open) => !open && setEditing(null)}>
          <ModalContent>
            <ValidatedForm
              method="post"
              action={action}
              validator={financingOverrideValidator}
              defaultValues={{
                line: editing,
                value: overrides[editing]?.value,
                reason: overrides[editing]?.reason ?? ""
              }}
              onSubmit={() => setEditing(null)}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>
                    Line {editing}: {SF1443_LINE_LABELS[editing]}
                  </Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <VStack spacing={4}>
                  <Hidden name="intent" value="override" />
                  <Hidden name="line" />
                  <NumberField
                    name="value"
                    label={t`Value (blank uses the computed value)`}
                    formatOptions={INPUT_FORMAT.money(currency, decimals)}
                    step={INPUT_STEP.money(decimals)}
                  />
                  <TextArea name="reason" label={t`Reason`} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit>
                  <Trans>Save</Trans>
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {approving && (
        <Modal open onOpenChange={(open) => !open && setApproving(false)}>
          <ModalContent>
            <ValidatedForm
              method="post"
              action={action}
              validator={financingApproveValidator}
              defaultValues={{
                approvedAmount: Number(request.requestedAmount)
              }}
              onSubmit={() => setApproving(false)}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Approve Request</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="intent" value="approve" />
                <NumberField
                  name="approvedAmount"
                  label={t`Amount the contracting officer approved`}
                  formatOptions={INPUT_FORMAT.money(currency, decimals)}
                  step={INPUT_STEP.money(decimals)}
                  minValue={0}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={() => setApproving(false)}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit>
                  <Trans>Approve</Trans>
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </Drawer>
  );
}
