// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ContractFinancingView } from "@carbon/ee/contract-financing";
import {
  contractFinancingMethods,
  contractFinancingRateValidator,
  contractFinancingTermsValidator,
  financingRequestValidator,
  pbpEventCompleteValidator,
  pbpEventValidator,
  performanceBasedPaymentEventTypes,
  SUGGESTED_FINANCING_RATE
} from "@carbon/ee/contract-financing";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuLandmark, LuPlus } from "react-icons/lu";
import { Link, useParams } from "react-router";
import {
  Boolean,
  DatePicker,
  Hidden,
  Input,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  usePermissions
} from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";

type ContractLine = {
  id: string;
  lineItemNumber: string | null;
  description: string | null;
};

type ContractFinancingProps = {
  financing: ContractFinancingView;
  lines: ContractLine[];
  customerId: string | null;
};

/**
 * The contract's government financing: its terms and rate history, the
 * performance-based payment schedule, and the requests with the balance the
 * government has not yet liquidated. A company without government
 * contracting sees the section behind the upgrade overlay.
 */
export default function ContractFinancing(props: ContractFinancingProps) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });
  if (isGated) {
    return (
      <UpgradeOverlaySection
        icon={<LuLandmark className="size-6 text-muted-foreground" />}
        title={<Trans>Contract Financing</Trans>}
        description={
          <Trans>
            Progress payments with the SF 1443, performance-based payments, and
            their liquidation on delivery invoices.
          </Trans>
        }
      >
        <FinancingCards {...props} isDisabled />
      </UpgradeOverlaySection>
    );
  }
  return <FinancingCards {...props} />;
}

function FinancingCards({
  financing,
  lines,
  isDisabled: disabled
}: ContractFinancingProps & { isDisabled?: boolean }) {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const permissions = usePermissions();
  const isDisabled = disabled || !permissions.can("update", "sales");
  const formatMoney = useCurrencyFormatter({
    currency: financing.currencyCode
  });
  const formatPercent = usePercentFormatter();
  const { formatDate } = useDateFormatter();
  const [modal, setModal] = useState<
    "rate" | "event" | "request" | { complete: string } | null
  >(null);
  const terms = financing.terms;
  const isPbp = terms?.financingMethod === "Performance-Based Payments";
  const lineLabel = (lineId: string | null) => {
    if (!lineId) return t`Whole contract`;
    const line = lines.find((row) => row.id === lineId);
    return line?.lineItemNumber ?? line?.description ?? lineId;
  };

  return (
    <VStack spacing={4} className="w-full">
      <TermsCard
        financing={financing}
        isDisabled={isDisabled || !financing.isBaseCurrency}
      />

      {terms && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Rates</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                The rates the contract clause sets. A modification adds a rate
                from its effective date.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {financing.rates.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Effective</Trans>
                    </Th>
                    {!isPbp && (
                      <Th className="text-right">
                        <Trans>Progress payment rate</Trans>
                      </Th>
                    )}
                    <Th className="text-right">
                      <Trans>Liquidation rate</Trans>
                    </Th>
                    <Th>
                      <Trans>Modification</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {financing.rates.map((rate) => (
                    <Tr key={rate.id}>
                      <Td className="tabular-nums">
                        {formatDate(rate.effectiveDate)}
                      </Td>
                      {!isPbp && (
                        <Td className="text-right tabular-nums">
                          {rate.progressPaymentRate === null
                            ? "—"
                            : formatPercent.format(
                                Number(rate.progressPaymentRate)
                              )}
                        </Td>
                      )}
                      <Td className="text-right tabular-nums">
                        {formatPercent.format(Number(rate.liquidationRate))}
                      </Td>
                      <Td>{rate.modificationNumber ?? "—"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>Add the rates before the first request.</Trans>
              </p>
            )}
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              className="self-start"
              isDisabled={isDisabled}
              onClick={() => setModal("rate")}
            >
              <Trans>Add Rate</Trans>
            </Button>
          </CardContent>
        </Card>
      )}

      {terms && isPbp && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Payment Events</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                A Cumulative event bills only after every event before it.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {financing.events.length > 0 ? (
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
                      <Trans>Type</Trans>
                    </Th>
                    <Th>
                      <Trans>CLIN</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Amount</Trans>
                    </Th>
                    <Th>
                      <Trans>Completed</Trans>
                    </Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {financing.events.map((event) => (
                    <Tr key={event.id}>
                      <Td className="tabular-nums">{event.eventCode}</Td>
                      <Td>{event.description}</Td>
                      <Td>{event.eventType}</Td>
                      <Td>{lineLabel(event.customerContractLineId)}</Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney.format(Number(event.amount))}
                      </Td>
                      <Td className="tabular-nums">
                        {event.completedDate
                          ? formatDate(event.completedDate)
                          : "—"}
                      </Td>
                      <Td className="text-right">
                        {event.billed ? (
                          <Badge variant="secondary">
                            <Trans>Billed</Trans>
                          </Badge>
                        ) : !event.completedDate ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            isDisabled={isDisabled}
                            onClick={() => setModal({ complete: event.id })}
                          >
                            <Trans>Complete</Trans>
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No payment events yet.</Trans>
              </p>
            )}
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              className="self-start"
              isDisabled={isDisabled}
              onClick={() => setModal("event")}
            >
              <Trans>Add Event</Trans>
            </Button>
          </CardContent>
        </Card>
      )}

      {terms && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <CardTitle>
                  <Trans>Requests</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Unliquidated: {formatMoney.format(financing.unliquidated)}
                  </Trans>
                </CardDescription>
              </div>
              <Button
                leftIcon={<LuPlus />}
                isDisabled={isDisabled || financing.rates.length === 0}
                onClick={() => setModal("request")}
              >
                <Trans>New Request</Trans>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {financing.requests.length > 0 ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Request</Trans>
                    </Th>
                    <Th>
                      <Trans>Date</Trans>
                    </Th>
                    <Th>
                      <Trans>Costs through</Trans>
                    </Th>
                    <Th>
                      <Trans>Status</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Requested</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Approved</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {financing.requests.map((request) => (
                    <Tr key={request.id}>
                      <Td>
                        <Link
                          to={path.to.contractFinancingRequest(id, request.id)}
                          className="font-medium hover:underline"
                        >
                          {request.requestNumber ?? t`Draft`}
                        </Link>
                      </Td>
                      <Td className="tabular-nums">
                        {formatDate(request.requestDate)}
                      </Td>
                      <Td className="tabular-nums">
                        {formatDate(request.costsThroughDate)}
                      </Td>
                      <Td>
                        <FinancingStatus status={request.status} />
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney.format(Number(request.requestedAmount))}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {request.approvedAmount === null
                          ? "—"
                          : formatMoney.format(Number(request.approvedAmount))}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Trans>No requests yet.</Trans>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {modal === "rate" && (
        <RateModal
          contractId={id}
          isPbp={isPbp}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "event" && (
        <EventModal
          contractId={id}
          lines={lines}
          nextSequence={financing.events.length + 1}
          currencyCode={financing.currencyCode}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "request" && (
        <RequestModal
          contractId={id}
          isPbp={isPbp}
          currencyCode={financing.currencyCode}
          onClose={() => setModal(null)}
        />
      )}
      {modal !== null && typeof modal === "object" && (
        <CompleteEventModal
          contractId={id}
          eventId={modal.complete}
          onClose={() => setModal(null)}
        />
      )}
    </VStack>
  );
}

export function FinancingStatus({ status }: { status: string }) {
  const variant =
    status === "Paid"
      ? "green"
      : status === "Approved"
        ? "blue"
        : status === "Withdrawn"
          ? "gray"
          : status === "Submitted"
            ? "yellow"
            : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function TermsCard({
  financing,
  isDisabled
}: {
  financing: ContractFinancingView;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { id } = useParams();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(financing.currencyCode);
  const terms = financing.terms;
  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.contractFinancing(id!)}
        validator={contractFinancingTermsValidator}
        defaultValues={{
          financingMethod: terms?.financingMethod ?? "Progress Payments",
          contractPrice: terms ? Number(terms.contractPrice) : undefined,
          initialAwardDate: terms?.initialAwardDate ?? today,
          isSmallBusiness: terms?.isSmallBusiness ?? false,
          maximumPaymentShare: terms ? Number(terms.maximumPaymentShare) : 0.9
        }}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Financing Terms</Trans>
          </CardTitle>
          <CardDescription>
            {financing.isBaseCurrency ? (
              <Trans>
                Customary progress payments (SF 1443) or performance-based
                payments, as the contract clause sets them.
              </Trans>
            ) : (
              <Trans>
                Contract financing needs a contract in the company's base
                currency.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="terms" />
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
            <Select
              name="financingMethod"
              label={t`Method`}
              options={contractFinancingMethods.map((method) => ({
                value: method,
                label: method
              }))}
              isReadOnly={isDisabled}
            />
            <NumberField
              name="contractPrice"
              label={t`Contract price`}
              formatOptions={INPUT_FORMAT.money(
                financing.currencyCode,
                decimals
              )}
              step={INPUT_STEP.money(decimals)}
              minValue={0}
              isReadOnly={isDisabled}
            />
            <DatePicker
              name="initialAwardDate"
              label={t`Initial award`}
              isDisabled={isDisabled}
            />
            <NumberField
              name="maximumPaymentShare"
              label={t`Maximum share of price (PBP)`}
              formatOptions={INPUT_FORMAT.percent}
              step={INPUT_STEP.percent}
              minValue={0}
              maxValue={1}
              isReadOnly={isDisabled}
            />
            <Boolean
              name="isSmallBusiness"
              label={t`Small business`}
              isDisabled={isDisabled}
            />
          </div>
          <div className="pt-4">
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </div>
        </CardContent>
      </ValidatedForm>
    </Card>
  );
}

function FormModal({
  title,
  action,
  validator,
  defaultValues,
  onClose,
  children
}: {
  title: string;
  action: string;
  validator: Parameters<typeof ValidatedForm>[0]["validator"];
  defaultValues: Record<string, unknown>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={action}
          validator={validator}
          defaultValues={defaultValues}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>{children}</VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function RateModal({
  contractId,
  isPbp,
  onClose
}: {
  contractId: string;
  isPbp: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  return (
    <FormModal
      title={t`Add Rate`}
      action={path.to.contractFinancing(contractId)}
      validator={contractFinancingRateValidator}
      defaultValues={{
        effectiveDate: today,
        progressPaymentRate: isPbp ? undefined : SUGGESTED_FINANCING_RATE,
        liquidationRate: SUGGESTED_FINANCING_RATE
      }}
      onClose={onClose}
    >
      <Hidden name="intent" value="rate" />
      <DatePicker name="effectiveDate" label={t`Effective`} />
      {!isPbp && (
        <NumberField
          name="progressPaymentRate"
          label={t`Progress payment rate`}
          formatOptions={INPUT_FORMAT.percent}
          step={INPUT_STEP.percent}
          minValue={0}
          maxValue={1}
        />
      )}
      <NumberField
        name="liquidationRate"
        label={t`Liquidation rate`}
        formatOptions={INPUT_FORMAT.percent}
        step={INPUT_STEP.percent}
        minValue={0}
        maxValue={1}
      />
      <Input name="modificationNumber" label={t`Modification`} />
    </FormModal>
  );
}

function EventModal({
  contractId,
  lines,
  nextSequence,
  currencyCode,
  onClose
}: {
  contractId: string;
  lines: ContractLine[];
  nextSequence: number;
  currencyCode: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const decimals = useCurrencyDecimals(currencyCode);
  return (
    <FormModal
      title={t`Add Event`}
      action={path.to.contractFinancing(contractId)}
      validator={pbpEventValidator}
      defaultValues={{
        sequence: nextSequence,
        eventType: "Cumulative"
      }}
      onClose={onClose}
    >
      <Hidden name="intent" value="event" />
      <NumberField name="sequence" label={t`Order`} minValue={1} />
      <Input name="eventCode" label={t`Event code`} />
      <Input name="description" label={t`Description`} />
      <TextArea name="completionCriteria" label={t`Completion criteria`} />
      <Select
        name="eventType"
        label={t`Type`}
        options={performanceBasedPaymentEventTypes.map((type) => ({
          value: type,
          label: type
        }))}
      />
      <Select
        name="customerContractLineId"
        label={t`CLIN`}
        options={lines.map((line) => ({
          value: line.id,
          label: line.lineItemNumber ?? line.description ?? line.id
        }))}
        isClearable
      />
      <NumberField
        name="amount"
        label={t`Amount`}
        formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
        step={INPUT_STEP.money(decimals)}
        minValue={0}
      />
      <DatePicker name="plannedDate" label={t`Planned`} />
    </FormModal>
  );
}

function CompleteEventModal({
  contractId,
  eventId,
  onClose
}: {
  contractId: string;
  eventId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  return (
    <FormModal
      title={t`Complete Event`}
      action={path.to.contractFinancing(contractId)}
      validator={pbpEventCompleteValidator}
      defaultValues={{ id: eventId, completedDate: today }}
      onClose={onClose}
    >
      <Hidden name="intent" value="complete-event" />
      <Hidden name="id" />
      <DatePicker name="completedDate" label={t`Completed`} />
      <TextArea name="evidence" label={t`Evidence`} />
    </FormModal>
  );
}

function RequestModal({
  contractId,
  isPbp,
  currencyCode,
  onClose
}: {
  contractId: string;
  isPbp: boolean;
  currencyCode: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(currencyCode);
  return (
    <FormModal
      title={isPbp ? t`New PBP Request` : t`New Progress Payment Request`}
      action={path.to.contractFinancing(contractId)}
      validator={financingRequestValidator}
      defaultValues={{ requestDate: today, costsThroughDate: today }}
      onClose={onClose}
    >
      <Hidden name="intent" value="request" />
      <DatePicker name="requestDate" label={t`Request date`} />
      <DatePicker name="costsThroughDate" label={t`Costs through`} />
      {!isPbp && (
        <>
          <NumberField
            name="estimateToComplete"
            label={t`Estimated cost to complete`}
            helperText={t`Blank uses the estimate at completion of the contract's projects`}
            formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
            step={INPUT_STEP.money(decimals)}
            minValue={0}
          />
          <DatePicker name="estimateDate" label={t`Estimated on`} />
        </>
      )}
    </FormModal>
  );
}
