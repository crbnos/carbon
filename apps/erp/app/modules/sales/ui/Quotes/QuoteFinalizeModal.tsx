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
  useMount,
  VStack,
} from "@carbon/react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { LuAlertTriangle } from "react-icons/lu";
import { CustomerContact, SelectControlled } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { quoteFinalizeValidator } from "../../sales.models";
import {
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
} from "../../sales.service";
import type { Quotation, QuotationLine, QuotationPrice } from "../../types";

type QuotationFinalizeModalProps = {
  onClose: () => void;
  quote?: Quotation;
  fetcher: FetcherWithComponents<{}>;
};

const QuotationFinalizeModal = ({
  quote,
  onClose,
  fetcher,
}: QuotationFinalizeModalProps) => {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");
  const { carbon } = useCarbon();

  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [prices, setPrices] = useState<QuotationPrice[]>([]);

  const fetchQuoteData = async () => {
    if (!carbon) return;

    const [lines, prices] = await Promise.all([
      getQuoteLines(carbon, quoteId),
      getQuoteLinePricesByQuoteId(carbon, quoteId),
    ]);
    setLines(lines.data ?? []);
    setPrices(prices.data ?? []);

    setLoading(false);
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
      ...linesWithZeroPriceOrLeadTime,
    ]),
  ];

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
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{`Finalize ${quote?.quoteId}`}</ModalTitle>
            <ModalDescription>
              Are you sure you want to finalize the quote?
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            {warningLineReadableIds.length > 0 && (
              <Alert variant="destructive">
                <LuAlertTriangle className="h-4 w-4" />
                <AlertTitle>Lines need prices or lead times</AlertTitle>
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
            <VStack spacing={4}>
              {canEmail && (
                <SelectControlled
                  label="Send Via"
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None",
                    },
                    {
                      label: "Email",
                      value: "Email",
                    },
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <CustomerContact
                  name="customerContact"
                  customer={quote?.customerId ?? undefined}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button isDisabled={loading} type="submit">
              Finalize
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default QuotationFinalizeModal;
