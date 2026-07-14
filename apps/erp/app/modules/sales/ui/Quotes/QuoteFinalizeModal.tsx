import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { FetcherWithComponents } from "react-router";
import { useParams } from "react-router";
import {
  CustomerContact,
  EmailRecipients,
  SelectControlled
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { quoteFinalizeValidator } from "../../sales.models";
import {
  getQuoteLinePricesByQuoteId,
  getQuoteLines
} from "../../sales.service";
import type {
  Quotation,
  QuotationLine,
  QuotationPrice,
  QuotationShipment
} from "../../types";

type QuotationFinalizeModalProps = {
  onClose: () => void;
  quote?: Quotation;
  lines: QuotationLine[];
  pricing: QuotationPrice[];
  shipment: QuotationShipment | null;
  fetcher: FetcherWithComponents<{}>;
  defaultCc?: string[];
};

const QuotationFinalizeModal = ({
  quote,
  onClose,
  fetcher,
  shipment,
  defaultCc = [],
  pricing
}: QuotationFinalizeModalProps) => {
  const { t } = useLingui();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const { carbon } = useCarbon();

  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [prices, setPrices] = useState<QuotationPrice[]>([]);

  const fetchQuoteData = async () => {
    if (!carbon) return;

    try {
      const [lines, prices] = await Promise.all([
        getQuoteLines(carbon, quoteId),
        getQuoteLinePricesByQuoteId(carbon, quoteId)
      ]);
      setLines(lines.data ?? []);
      setPrices(prices.data ?? []);
    } catch {
      toast.error("Failed to load quote data");
    } finally {
      setLoading(false);
    }
  };

  useMount(() => {
    fetchQuoteData();
  });

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Download"
  );

  const linesMissingQuoteLinePrices = lines
    .filter((line) => {
      if (!line.quantity || !Array.isArray(line.quantity)) return false;
      return line.quantity.some(
        (qty) =>
          !prices.some(
            (price) => price.quoteLineId === line.id && price.quantity === qty
          )
      );
    })
    .map((line) => line.itemReadableId)
    .filter((id): id is string => id !== undefined);

  const linesWithZeroPriceOrLeadTime = prices
    .filter((price) => price.unitPrice === 0 || price.leadTime === 0)
    .map((price) => {
      const line = lines.find((line) => line.id === price.quoteLineId);
      return line?.itemReadableId;
    })
    .filter((id): id is string => id !== undefined);

  const warningLineReadableIds = [
    ...new Set([
      ...linesMissingQuoteLinePrices,
      ...linesWithZeroPriceOrLeadTime
    ])
  ];

  const hasShippingCost = shipment?.shippingCost && shipment.shippingCost > 0;
  const allLinesHaveShippingCosts = lines.every((line) => {
    const linePrices = prices.filter((price) => price.quoteLineId === line.id);
    return linePrices.every(
      (price) => price.shippingCost && price.shippingCost > 0
    );
  });
  const showShippingWarning = !hasShippingCost && !allLinesHaveShippingCosts;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={quoteFinalizeValidator}
          action={path.to.quoteFinalize(quoteId)}
          onSubmit={onClose}
          defaultValues={{
            notification: notificationType as "Email" | "None",
            customerContact: quote?.customerContactId ?? undefined,
            cc: defaultCc
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{`Finalize ${quote?.quoteId}`}</ModalTitle>
            <ModalDescription>
              <Trans>Are you sure you want to finalize the quote?</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {warningLineReadableIds.length > 0 && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>Lines need prices or lead times</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    The following line items are missing prices or lead times:
                    <ul className="list-disc py-2 pl-4">
                      {warningLineReadableIds.map((readableId) => (
                        <li key={readableId}>{readableId}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {showShippingWarning && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>Missing Shipping Costs</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    This quote has no shipping costs defined. Please add
                    shipping costs either at the quote level or for individual
                    line items.
                  </AlertDescription>
                </Alert>
              )}
              {canEmail && (
                <SelectControlled
                  label={t`Send Via`}
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None"
                    },
                    {
                      label: "Email",
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <>
                  <CustomerContact
                    name="customerContact"
                    customer={quote?.customerId ?? undefined}
                  />
                  <EmailRecipients name="cc" label={t`CC`} type="employee" />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button isDisabled={loading} type="submit">
              <Trans>Finalize</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default QuotationFinalizeModal;
