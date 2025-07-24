import { getCarbonServiceRole } from "@carbon/auth";
import { Input, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Heading,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tr,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { generateHTML } from "@carbon/react/Editor";
import { useMode } from "@carbon/remix";
import { formatCityStatePostalCode, formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { motion } from "framer-motion";
import MotionNumber from "motion-number";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  LuChevronRight,
  LuCircleX,
  LuCreditCard,
  LuImage,
  LuTruck,
  LuUpload,
} from "react-icons/lu";
import { usePercentFormatter } from "~/hooks";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import type {
  QuotationLine,
  QuotationPrice,
  SalesOrderLine,
} from "~/modules/sales";
import {
  externalQuoteValidator,
  getOpportunity,
  getQuoteByExternalId,
  getQuoteCustomerDetails,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrderLines,
  getSalesTerms,
} from "~/modules/sales";
import QuoteStatus from "~/modules/sales/ui/Quotes/QuoteStatus";
import { getCompany, getCompanySettings } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import type { action } from "~/routes/api+/sales.digital-quote.$id";
import { path } from "~/utils/path";

export const meta = () => {
  return [{ title: "Digital Quote" }];
};

enum QuoteState {
  Valid,
  Expired,
  NotFound,
}

const translations = {
  en: {
    "Accept Quote": "Accept Quote",
    "Add-Ons": "Add-Ons",
    "Are you sure you want to accept this quote?": (
      id: string,
      amount: string
    ) => `Are you sure you want to accept quote ${id} for ${amount}?`,
    "Are you sure you want to reject this quote?":
      "Are you sure you want to reject this quote?",
    Cancel: "Cancel",
    Change: "Change",
    days: "days",
    "Digital Quote": "Digital Quote",
    "Drag and drop a Purchase Order PDF here, or click to select a file":
      "Drag and drop a Purchase Order PDF here, or click to select a file",
    Expires: "Expires",
    "Extended Price": "Extended Price",
    "Lead Time": "Lead Time",
    "No pricing options found": "No pricing options found",
    "Oops! The link you're trying to access has expired or is no longer valid.":
      "Oops! The link you're trying to access has expired or is no longer valid.",
    "Oops! The link you're trying to access is not valid.":
      "Oops! The link you're trying to access is not valid.",
    "Payment Term": "Payment Term",
    "Please enter your email address": "Please enter your email address",
    "Please enter your name": "Please enter your name",
    Quantity: "Quantity",
    "Quote expired": "Quote expired",
    "Quote not found": "Quote not found",
    "Reject Quote": "Reject Quote",
    Remove: "Remove",
    "Shipping Method": "Shipping Method",
    Shipping: "Shipping",
    Subtotal: "Subtotal",
    Tax: "Tax",
    Total: "Total",
    "Unit Price": "Unit Price",
    "Yes, Accept": "Yes, Accept",
    "Yes, Reject": "Yes, Reject",
  },
  es: {
    "Accept Quote": "Aceptar Cotización",
    "Add-Ons": "Complementos",
    "Are you sure you want to accept this quote?": (
      id: string,
      amount: string
    ) =>
      `¿Estás seguro de que quieres aceptar la cotización ${id} por ${amount}?`,
    "Are you sure you want to reject this quote?":
      "¿Estás seguro de que quieres rechazar esta cotización?",
    Cancel: "Cancelar",
    Change: "Cambiar",
    days: "días",
    "Digital Quote": "Cotización Digital",

    "Drag and drop a Purchase Order PDF here, or click to select a file":
      "Arrastre y suelte un PDF de Orden de Compra aquí, o haga clic para seleccionar un archivo",
    Expires: "Expira",
    "Extended Price": "Precio Extendido",
    "Lead Time": "Tiempo de Entrega",
    "No pricing options found": "No se encontraron opciones de precio",
    "Oops! The link you're trying to access has expired or is no longer valid.":
      "¡Ups! El enlace al que intenta acceder ha expirado o ya no es válido.",
    "Oops! The link you're trying to access is not valid.":
      "¡Ups! El enlace al que intenta acceder no es válido.",
    "Payment Term": "Plazo de Pago",
    "Please enter your email address":
      "Por favor ingrese su correo electrónico",
    "Please enter your name": "Por favor ingrese su nombre",
    Quantity: "Cantidad",
    "Quote expired": "Cotización expirada",
    "Quote not found": "Cotización no encontrada",
    "Reject Quote": "Rechazar Cotización",
    Remove: "Eliminar",
    "Shipping Method": "Método de Envío",
    Shipping: "Envío",
    Subtotal: "Subtotal",
    Tax: "Impuesto",
    Total: "Total",
    "Unit Price": "Precio Unitario",
    "Yes, Accept": "Sí, Aceptar",
    "Yes, Reject": "Sí, Rechazar",
  },
  de: {
    "Accept Quote": "Angebot Annehmen",
    "Add-Ons": "Zusätze",
    "Are you sure you want to accept this quote?": (
      id: string,
      amount: string
    ) =>
      `Sind Sie sicher, dass Sie das Angebot ${id} für ${amount} annehmen möchten?`,
    "Are you sure you want to reject this quote?":
      "Sind Sie sicher, dass Sie dieses Angebot ablehnen möchten?",
    Cancel: "Abbrechen",
    Change: "Ändern",
    days: "Tage",
    "Digital Quote": "Digitales Angebot",
    "Drag and drop a Purchase Order PDF here, or click to select a file":
      "Ziehen Sie eine Bestellung als PDF hierher oder klicken Sie zum Auswählen",
    Expires: "Läuft ab",
    "Extended Price": "Erweiterter Preis",
    "Lead Time": "Lieferzeit",
    "No pricing options found": "Keine Preisoptionen gefunden",
    "Oops! The link you're trying to access has expired or is no longer valid.":
      "Ups! Der Link, den Sie aufrufen möchten, ist abgelaufen oder nicht mehr gültig.",
    "Oops! The link you're trying to access is not valid.":
      "Ups! Der Link, den Sie aufrufen möchten, ist nicht gültig.",
    "Payment Term": "Zahlungsbedingung",
    "Please enter your email address":
      "Bitte geben Sie Ihre E-Mail-Adresse ein",
    "Please enter your name": "Bitte geben Sie Ihren Namen ein",
    Quantity: "Menge",
    "Quote expired": "Angebot abgelaufen",
    "Quote not found": "Angebot nicht gefunden",
    "Reject Quote": "Angebot ablehnen",
    Remove: "Entfernen",
    "Shipping Method": "Versandart",
    Shipping: "Versand",
    Subtotal: "Zwischensumme",
    Tax: "Steuer",
    Total: "Gesamt",
    "Unit Price": "Stückpreis",
    "Yes, Accept": "Ja, Annehmen",
    "Yes, Reject": "Ja, Ablehnen",
  },
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return json({
      state: QuoteState.NotFound,
      data: null,
      strings: translations.en,
    });
  }
  const locale = (request.headers.get("Accept-Language") || "en-US").substring(
    0,
    2
  );
  const strings =
    translations[locale as keyof typeof translations] || translations.en;

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);

  if (quote.error) {
    return json({
      state: QuoteState.NotFound,
      data: null,
      strings,
    });
  }

  if (
    quote.data.expirationDate &&
    new Date(quote.data.expirationDate) < new Date() &&
    quote.data.status === "Sent"
  ) {
    return json({
      state: QuoteState.Expired,
      data: null,
      strings,
    });
  }

  const [
    company,
    companySettings,
    quoteLines,
    quoteLinePrices,
    customerDetails,
    quotePayment,
    quoteShipment,
    paymentTerms,
    terms,
    shippingMethods,
    opportunity,
  ] = await Promise.all([
    getCompany(serviceRole, quote.data.companyId),
    getCompanySettings(serviceRole, quote.data.companyId),
    getQuoteLines(serviceRole, quote.data.id),
    getQuoteLinePricesByQuoteId(serviceRole, quote.data.id),
    getQuoteCustomerDetails(serviceRole, quote.data.id),
    getQuotePayment(serviceRole, quote.data.id),
    getQuoteShipment(serviceRole, quote.data.id),
    getPaymentTermsList(serviceRole, quote.data.companyId),
    getSalesTerms(serviceRole, quote.data.companyId),
    getShippingMethodsList(serviceRole, quote.data.companyId),
    getOpportunity(serviceRole, quote.data.opportunityId),
  ]);

  let salesOrderLines: PostgrestResponse<SalesOrderLine> | null = null;
  if (
    opportunity.data?.salesOrders?.length &&
    opportunity.data.salesOrders[0]?.id
  ) {
    salesOrderLines = await getSalesOrderLines(
      serviceRole,
      opportunity.data.salesOrders[0].id
    );
  }

  const thumbnailPaths = quoteLines.data?.reduce<Record<string, string | null>>(
    (acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    },
    {}
  );

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(serviceRole, path).then(
              (data) => ({
                id,
                data,
              })
            );
          })
        )
      : []
    )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    }, {}) ?? {};

  return json({
    state: QuoteState.Valid,
    data: {
      quote: quote.data,
      company: company.data,
      companySettings: companySettings.data,
      quoteLines:
        quoteLines.data?.map(({ internalNotes, ...line }) => ({
          ...line,
        })) ?? [],
      thumbnails: thumbnails,
      quoteLinePrices: quoteLinePrices.data,
      customerDetails: customerDetails.data,
      quotePayment: quotePayment.data,
      quoteShipment: quoteShipment.data,
      paymentTerm: paymentTerms.data?.find(
        (term) => term.id === quotePayment.data?.paymentTermId
      )?.name,
      terms: terms.data?.salesTerms ?? "",
      shippingMethod: shippingMethods.data?.find(
        (method) => method.id === quoteShipment.data?.shippingMethodId
      )?.name,
      salesOrderLines: salesOrderLines?.data ?? null,
    },
    strings,
  });
}

const Header = ({
  company,
  quote,
  customer,
  strings,
}: {
  company: QuoteData["company"];
  quote: QuoteData["quote"];
  customer: QuoteData["customerDetails"];
  strings: (typeof translations)["en"];
}) => (
  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-start justify-between space-y-4 sm:space-y-2 pb-7">
    <div className="flex items-center space-x-4">
      <div>
        <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>
        {quote?.quoteId && (
          <p className="text-lg text-muted-foreground">{quote.quoteId}</p>
        )}
        {quote?.expirationDate && (
          <p className="text-lg text-muted-foreground">
            {strings["Expires"]} {formatDate(quote.expirationDate)}
          </p>
        )}
      </div>
    </div>
    <div className="flex flex-col gap-2 items-end justify-start">
      <p className="text-xl font-medium">{customer?.customerName ?? ""}</p>
      {customer?.contactName && (
        <p className="text-base text-muted-foreground">
          {customer.contactName ?? ""}
        </p>
      )}
      {customer?.customerAddressLine1 && (
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {customer.customerAddressLine1}
          </p>

          {customer?.customerAddressLine2 && (
            <p className="text-xs text-muted-foreground">
              {customer.customerAddressLine2}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {formatCityStatePostalCode(
              customer?.customerCity ?? "",
              customer?.customerStateProvince ?? "",
              customer?.customerPostalCode ?? ""
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {customer?.customerCountryName ?? ""}
          </p>
        </div>
      )}
    </div>
  </CardHeader>
);

type SelectedLine = {
  quantity: number;
  netUnitPrice: number;
  convertedNetUnitPrice: number;
  addOn: number;
  convertedAddOn: number;
  leadTime: number;
  shippingCost: number;
  convertedShippingCost: number;
  taxPercent: number;
  discountPercent: number;
  unitPrice: number;
  convertedUnitPrice: number;
};

const deselectedLine: SelectedLine = {
  addOn: 0,
  convertedAddOn: 0,
  netUnitPrice: 0,
  convertedNetUnitPrice: 0,
  quantity: 0,
  leadTime: 0,
  shippingCost: 0,
  convertedShippingCost: 0,
  taxPercent: 0,
  discountPercent: 0,
  unitPrice: 0,
  convertedUnitPrice: 0,
};

const LineItems = ({
  currencyCode,
  formatter,
  locale,
  selectedLines,
  setSelectedLines,
  strings,
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
  strings: (typeof translations)["en"];
}) => {
  const { company, quote, quoteLines, quoteLinePrices, thumbnails } =
    useLoaderData<typeof loader>().data!;

  const [openItems, setOpenItems] = useState<string[]>(() =>
    Array.isArray(quoteLines) && quoteLines.length > 0
      ? quoteLines.map((line) => line.id!).filter(Boolean)
      : []
  );
  useEffect(() => {
    Object.entries(selectedLines).forEach(([lineId, line]) => {
      if (line.quantity === 0 && openItems.includes(lineId)) {
        setOpenItems((prev) => prev.filter((item) => item !== lineId));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLines]);

  const pricingByLine = useMemo(
    () =>
      quoteLines?.reduce<Record<string, QuotationPrice[]>>((acc, line) => {
        if (!line.id) {
          return acc;
        }
        acc[line.id!] =
          quoteLinePrices
            ?.filter((p) => p.quoteLineId === line.id)
            .sort((a, b) => a.quantity - b.quantity) ?? [];
        return acc;
      }, {}) ?? {},
    [quoteLines, quoteLinePrices]
  );

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const shouldConvertCurrency =
    quote.currencyCode !== company?.baseCurrencyCode;

  return (
    <VStack spacing={8} className="w-full">
      {quoteLines?.map((line) => {
        const prices = quoteLinePrices
          ?.filter((price) => price.quoteLineId === line.id)
          .sort((a, b) => a.quantity - b.quantity);

        if (!line || !prices || !line.id) {
          return null;
        }

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-b border-input py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {thumbnails[line.id!] ? (
                <img
                  alt={line.itemReadableId!}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={thumbnails[line.id!] ?? undefined}
                />
              ) : (
                <div className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow">
                    <Heading>{line.itemReadableId}</Heading>
                    <HStack spacing={4}>
                      <MotionNumber
                        className="font-bold text-xl"
                        value={
                          ((selectedLines[line.id!]?.convertedNetUnitPrice ??
                            0) *
                            (selectedLines[line.id!]?.quantity ?? 0) +
                            (selectedLines[line.id!]?.convertedAddOn ?? 0) +
                            selectedLines[line.id!]?.convertedShippingCost) *
                          (1 + selectedLines[line.id!]?.taxPercent)
                        }
                        format={{
                          style: "currency",
                          currency: currencyCode,
                        }}
                        locales={locale}
                      />
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 90 : 0,
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronRight size={24} />
                      </motion.div>
                    </HStack>
                  </div>
                  <span className="text-muted-foreground text-base truncate">
                    {line.description}
                  </span>
                  {Object.keys(line.externalNotes ?? {}).length > 0 && (
                    <div
                      className="prose dark:prose-invert prose mt-2 text-muted-foreground"
                      dangerouslySetInnerHTML={{
                        __html: generateHTML(line.externalNotes as JSONContent),
                      }}
                    />
                  )}
                </div>
              </VStack>
            </HStack>

            <motion.div
              initial="collapsed"
              animate={openItems.includes(line.id) ? "open" : "collapsed"}
              variants={{
                open: { opacity: 1, height: "auto", marginTop: 16 },
                collapsed: { opacity: 0, height: 0, marginTop: 0 },
              }}
              transition={{ duration: 0.3 }}
              className="w-full overflow-hidden"
            >
              <LinePricingOptions
                formatter={formatter}
                line={line}
                options={pricingByLine[line.id!]}
                quoteCurrency={quote.currencyCode ?? "USD"}
                quoteExchangeRate={quote.exchangeRate ?? 1}
                shouldConvertCurrency={shouldConvertCurrency}
                locale={locale}
                selectedLine={selectedLines[line.id!]}
                setSelectedLines={setSelectedLines}
                strings={strings}
              />
            </motion.div>
          </motion.div>
        );
      })}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: Omit<QuotationLine, "internalNotes">;
  options: QuotationPrice[];
  quoteCurrency: string;
  shouldConvertCurrency: boolean;
  quoteExchangeRate: number;
  locale: string;
  formatter: Intl.NumberFormat;
  selectedLine: SelectedLine;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
  strings: (typeof translations)["en"];
};

const LinePricingOptions = ({
  line,
  options,
  quoteCurrency,
  shouldConvertCurrency,
  quoteExchangeRate,
  locale,
  formatter,
  selectedLine,
  setSelectedLines,
  strings,
}: LinePricingOptionsProps) => {
  const percentFormatter = usePercentFormatter();
  const { quote, salesOrderLines } = useLoaderData<typeof loader>().data!;

  const hasSalesOrder =
    Array.isArray(salesOrderLines) && salesOrderLines.length > 0;
  const [selectedValue, setSelectedValue] = useState<string | null>(
    selectedLine?.quantity?.toString() ?? null
  );

  const additionalChargesByQuantity =
    line.quantity?.reduce(
      (acc, quantity) => {
        const charges = Object.values(line.additionalCharges ?? {}).reduce(
          (chargeAcc, charge) => {
            const amount = charge.amounts?.[quantity];
            return chargeAcc + amount;
          },
          0
        );
        acc[quantity] = charges;
        return acc;
      },
      { 0: 0 } as Record<number, number>
    ) ?? {};

  const convertedAdditionalChargesByQuantity = Object.entries(
    additionalChargesByQuantity
  ).reduce<Record<number, number>>(
    (acc, [quantity, amount]) => {
      acc[Number(quantity)] = amount * quoteExchangeRate;
      return acc;
    },
    { 0: 0 }
  );

  const additionalCharges: { name: string; amount: number }[] = [];
  if (selectedLine.convertedShippingCost) {
    additionalCharges.push({
      name: "Shipping",
      amount: selectedLine.convertedShippingCost,
    });
  }
  Object.entries(line.additionalCharges ?? {}).forEach(([name, charge]) => {
    additionalCharges.push({
      name: charge.description,
      amount: charge.amounts?.[selectedLine.quantity] * quoteExchangeRate,
    });
  });

  const unitPriceformatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: quote.currencyCode ?? "USD",
        maximumFractionDigits: line.unitPricePrecision ?? 2,
      }),
    [locale, quote.currencyCode, line.unitPricePrecision]
  );

  return (
    <VStack spacing={4}>
      <RadioGroup
        className="w-full"
        value={selectedValue ?? undefined}
        disabled={["Ordered", "Partial", "Expired", "Cancelled"].includes(
          quote.status
        )}
        onValueChange={(value) => {
          const selectedOption =
            value === "0"
              ? deselectedLine
              : options.find((opt) => opt.quantity.toString() === value);

          if (selectedOption) {
            setSelectedLines((prev) => ({
              ...prev,
              [line.id!]: {
                quantity: selectedOption.quantity,
                netUnitPrice: selectedOption.netUnitPrice ?? 0,
                convertedNetUnitPrice:
                  selectedOption.convertedNetUnitPrice ?? 0,
                addOn:
                  additionalChargesByQuantity[selectedOption.quantity] || 0,
                convertedAddOn:
                  convertedAdditionalChargesByQuantity[
                    selectedOption.quantity
                  ] || 0,
                leadTime: selectedOption.leadTime,
                shippingCost: selectedOption.shippingCost ?? 0,
                convertedShippingCost:
                  selectedOption.convertedShippingCost ?? 0,
                taxPercent: line.taxPercent ?? 0,
                discountPercent: selectedOption.discountPercent ?? 0,
                unitPrice: selectedOption.unitPrice ?? 0,
                convertedUnitPrice: selectedOption.convertedUnitPrice ?? 0,
              },
            }));
            setSelectedValue(value);
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th>{strings.Quantity}</Th>
              <Th>{strings["Unit Price"]}</Th>
              <Th>Discount</Th>
              <Th>{strings["Add-Ons"]}</Th>
              <Th>{strings["Lead Time"]}</Th>
              <Th>{strings.Subtotal}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-center py-8">
                  {strings["No pricing options found"]}
                </Td>
              </Tr>
            ) : (
              options.map(
                (option, index) =>
                  (line?.quantity?.includes(option.quantity) ||
                    option.quantity === 0) && (
                    <Tr key={index}>
                      <Td>
                        <RadioGroupItem
                          value={option.quantity.toString()}
                          id={`${line.id}:${option.quantity.toString()}`}
                        />
                        <label
                          htmlFor={`${line.id}:${option.quantity.toString()}`}
                          className="sr-only"
                        >
                          {option.quantity}
                        </label>
                      </Td>
                      <Td>{option.quantity}</Td>
                      <Td>
                        {unitPriceformatter.format(
                          option.convertedUnitPrice ?? 0
                        )}
                      </Td>
                      <Td>
                        {option.discountPercent > 0
                          ? percentFormatter.format(option.discountPercent)
                          : "-"}
                      </Td>
                      <Td>
                        {formatter.format(
                          convertedAdditionalChargesByQuantity[
                            option.quantity
                          ] + (option.convertedShippingCost ?? 0)
                        )}
                      </Td>
                      <Td>
                        {new Intl.NumberFormat(locale, {
                          style: "unit",
                          unit: "day",
                        }).format(option.leadTime)}
                      </Td>
                      <Td>
                        {formatter.format(
                          (option.convertedNetUnitPrice ?? 0) *
                            option.quantity +
                            convertedAdditionalChargesByQuantity[
                              option.quantity
                            ] +
                            (option.convertedShippingCost ?? 0)
                        )}
                      </Td>
                    </Tr>
                  )
              )
            )}
          </Tbody>
        </Table>
      </RadioGroup>

      {selectedLine.quantity !== 0 && (
        <div className="w-full">
          <Table>
            <Tbody>
              <Tr key="extended-price" className="border-b border-border">
                <Td>{strings["Extended Price"]}</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      (selectedLine.convertedUnitPrice ?? 0) *
                      selectedLine.quantity
                    }
                    format={{ style: "currency", currency: quoteCurrency }}
                    locales={locale}
                  />
                </Td>
              </Tr>

              {selectedLine.discountPercent > 0 && (
                <Tr key="discount" className="border-b border-border">
                  <Td>
                    Discount (
                    {percentFormatter.format(selectedLine.discountPercent)})
                  </Td>
                  <Td className="text-right">
                    -
                    <MotionNumber
                      value={
                        (selectedLine.convertedUnitPrice ?? 0) *
                        selectedLine.quantity *
                        selectedLine.discountPercent
                      }
                      format={{ style: "currency", currency: quoteCurrency }}
                      locales={locale}
                    />
                  </Td>
                </Tr>
              )}

              {additionalCharges.length > 0 &&
                additionalCharges.map((charge) => (
                  <Tr
                    key={charge.name}
                    className={
                      additionalCharges[additionalCharges.length - 1] === charge
                        ? "border-b border-border"
                        : ""
                    }
                  >
                    <Td>{charge.name}</Td>
                    <Td className="text-right">
                      <MotionNumber
                        value={charge.amount}
                        format={{ style: "currency", currency: quoteCurrency }}
                        locales={locale}
                      />
                    </Td>
                  </Tr>
                ))}

              <Tr key="subtotal">
                <Td>{strings.Subtotal}</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      (selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                      selectedLine.convertedAddOn +
                      selectedLine.convertedShippingCost
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
                  />
                </Td>
              </Tr>

              <Tr key="tax" className="border-b border-border">
                <Td>
                  {strings.Tax} (
                  {percentFormatter.format(selectedLine.taxPercent)})
                </Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        selectedLine.convertedAddOn +
                        selectedLine.convertedShippingCost) *
                      selectedLine.taxPercent
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
                  />
                </Td>
              </Tr>

              <Tr key="total" className="font-bold">
                <Td>{strings.Total}</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        selectedLine.convertedAddOn +
                        selectedLine.convertedShippingCost) *
                      (1 + selectedLine.taxPercent)
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
                  />
                </Td>
              </Tr>
            </Tbody>
          </Table>
        </div>
      )}
      {selectedLine.quantity !== 0 && !hasSalesOrder && (
        <HStack spacing={2} className="w-full justify-end items-center">
          <Button
            variant="secondary"
            leftIcon={<LuCircleX />}
            onClick={() => {
              setSelectedValue("0");
              setSelectedLines((prev) => ({
                ...prev,
                [line.id!]: deselectedLine,
              }));
            }}
          >
            {strings.Remove}
          </Button>
        </HStack>
      )}
    </VStack>
  );
};

const Quote = ({
  data,
  strings,
}: {
  data: QuoteData;
  strings: (typeof translations)["en"];
}) => {
  const {
    company,
    companySettings,
    customerDetails,
    paymentTerm,
    quote,
    quoteLines,
    quoteLinePrices,
    quoteShipment,
    salesOrderLines,
    shippingMethod,
    terms,
  } = data;
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: quote.currencyCode ?? "USD",
      }),
    [locale, quote.currencyCode]
  );

  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const confirmQuoteModal = useDisclosure();
  const rejectQuoteModal = useDisclosure();

  const fetcher = useFetcher<typeof action>();
  const submitted = useRef<boolean>(false);
  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      confirmQuoteModal.onClose();
      rejectQuoteModal.onClose();
      submitted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  const [selectedLines, setSelectedLines] = useState<
    Record<string, SelectedLine>
  >(() => {
    return (
      quoteLines?.reduce<Record<string, SelectedLine>>((acc, line) => {
        const salesOrderLine = salesOrderLines?.find(
          (salesOrderLine) => salesOrderLine.id === line.id
        );

        if (
          Array.isArray(salesOrderLines) &&
          salesOrderLines.length > 0 &&
          !salesOrderLine
        ) {
          acc[line.id!] = deselectedLine;
          return acc;
        }

        const price = salesOrderLine
          ? quoteLinePrices?.find(
              (price) =>
                price.quoteLineId === salesOrderLine.id &&
                price.quantity === salesOrderLine.saleQuantity
            )
          : quoteLinePrices?.find(
              (price) =>
                price.quoteLineId === line.id &&
                line.quantity?.includes(price.quantity)
            );

        if (!line.id) {
          return acc;
        }

        if (!price) {
          acc[line.id] = deselectedLine;
          return acc;
        }

        const additionalChargesByQuantity =
          line.quantity?.reduce((acc, quantity) => {
            const charges = Object.values(line.additionalCharges ?? {}).reduce(
              (chargeAcc, charge) => {
                const amount = charge.amounts?.[quantity];
                return chargeAcc + amount;
              },
              0
            );
            acc[quantity] = charges;
            return acc;
          }, {} as Record<number, number>) ?? {};

        const convertedAdditionalChargesByQuantity =
          Object.entries(additionalChargesByQuantity).reduce<
            Record<number, number>
          >((acc, [quantity, amount]) => {
            acc[Number(quantity)] = amount * (quote.exchangeRate ?? 1);
            return acc;
          }, {} as Record<number, number>) ?? {};

        acc[line.id] = {
          quantity: price.quantity ?? 0,
          netUnitPrice: price.netUnitPrice ?? 0,
          convertedNetUnitPrice: price.convertedNetUnitPrice ?? 0,
          addOn: additionalChargesByQuantity[price.quantity] || 0,
          convertedAddOn:
            convertedAdditionalChargesByQuantity[price.quantity] || 0,
          leadTime: price.leadTime,
          shippingCost: price.shippingCost ?? 0,
          convertedShippingCost: price.convertedShippingCost ?? 0,
          taxPercent: line.taxPercent ?? 0,
          discountPercent: price.discountPercent ?? 0,
          unitPrice: price.unitPrice ?? 0,
          convertedUnitPrice: price.convertedUnitPrice ?? 0,
        };
        return acc;
      }, {}) ?? {}
    );
  });

  const subtotal = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc +
      line.convertedNetUnitPrice * line.quantity +
      line.convertedAddOn +
      line.convertedShippingCost
    );
  }, 0);
  const totalDiscount = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc +
      (line.convertedUnitPrice ?? 0) *
        line.quantity *
        (line.discountPercent ?? 0)
    );
  }, 0);
  const tax = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc +
      (line.convertedNetUnitPrice * line.quantity +
        line.convertedAddOn +
        line.convertedShippingCost) *
        (line.taxPercent ?? 0)
    );
  }, 0);
  const convertedShippingCost =
    (quote.exchangeRate ?? 1) * (quoteShipment?.shippingCost ?? 0);
  const total = subtotal + tax + convertedShippingCost;

  const termsHTML = generateHTML(terms as JSONContent);

  const [file, setFile] = useState<File | null>(null);
  const onDrop = (acceptedFiles: File[]) => {
    setFile(acceptedFiles[0]);
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 25 * 1024 * 1024, // 25MB limit
  });

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={company?.name ?? ""}
          className="w-auto mx-auto max-w-5xl"
        />
      )}
      <Card className="w-full max-w-5xl mx-auto">
        <div className="w-full text-center">
          {!["Sent", "Lost"].includes(quote.status) && (
            <QuoteStatus status={quote.status} />
          )}
          {quote?.status === "Lost" && <Badge variant="red">Rejected</Badge>}
        </div>
        <Header
          company={company}
          quote={quote}
          customer={customerDetails}
          strings={strings}
        />
        <CardContent>
          <LineItems
            currencyCode={quote.currencyCode ?? "USD"}
            locale={locale}
            formatter={formatter}
            selectedLines={selectedLines}
            setSelectedLines={setSelectedLines}
            strings={strings}
          />

          <VStack spacing={2} className="mt-8">
            {shippingMethod && (
              <HStack className="justify-between text-sm text-muted-foreground w-full">
                <HStack spacing={2}>
                  <LuTruck className="w-5 h-5" />
                  <span>{strings["Shipping Method"]}:</span>
                </HStack>
                <span className="text-foreground font-bold">
                  {shippingMethod}
                </span>
              </HStack>
            )}
            {paymentTerm && (
              <HStack className="justify-between text-sm text-muted-foreground w-full">
                <HStack spacing={2}>
                  <LuCreditCard className="w-5 h-5" />
                  <span>{strings["Payment Term"]}:</span>
                </HStack>
                <span className="text-foreground font-bold">{paymentTerm}</span>
              </HStack>
            )}
            {(shippingMethod || paymentTerm) && <Separator />}
            <HStack className="justify-between text-base w-full">
              <span>{strings.Subtotal}:</span>
              <MotionNumber
                value={subtotal + totalDiscount}
                format={{
                  style: "currency",
                  currency: quote.currencyCode ?? "USD",
                }}
                locales={locale}
              />
            </HStack>
            {totalDiscount > 0 && (
              <HStack className="justify-between text-base w-full">
                <span>Discount:</span>
                <span className="text-muted-foreground">
                  -
                  <MotionNumber
                    value={totalDiscount}
                    format={{
                      style: "currency",
                      currency: quote.currencyCode ?? "USD",
                    }}
                    locales={locale}
                  />
                </span>
              </HStack>
            )}
            <HStack className="justify-between text-base w-full">
              <span>{strings.Tax}:</span>
              <MotionNumber
                value={tax}
                format={{
                  style: "currency",
                  currency: quote.currencyCode ?? "USD",
                }}
                locales={locale}
              />
            </HStack>
            {convertedShippingCost > 0 && (
              <HStack className="justify-between text-base w-full">
                <span>{strings.Shipping}:</span>
                <MotionNumber
                  value={convertedShippingCost}
                  format={{
                    style: "currency",
                    currency: quote.currencyCode ?? "USD",
                  }}
                  locales={locale}
                />
              </HStack>
            )}
            <Separator className="my-2" />
            <HStack className="justify-between text-xl font-bold w-full">
              <span>{strings.Total}:</span>
              <MotionNumber
                value={total}
                format={{
                  style: "currency",
                  currency: quote.currencyCode ?? "USD",
                }}
                locales={locale}
              />
            </HStack>
          </VStack>
          <div className="flex flex-col gap-2">
            {companySettings?.digitalQuoteEnabled &&
              quote?.status === "Sent" && (
                <>
                  <Button
                    onClick={confirmQuoteModal.onOpen}
                    size="lg"
                    variant="primary"
                    isDisabled={total === 0}
                    className="w-full mt-8 text-lg"
                  >
                    {strings["Accept Quote"]}
                  </Button>
                  <Button
                    onClick={rejectQuoteModal.onOpen}
                    size="lg"
                    variant="link"
                  >
                    {strings["Reject Quote"]}
                  </Button>
                </>
              )}
          </div>
        </CardContent>
      </Card>
      {termsHTML && (
        <div
          className="prose dark:prose-invert text-muted-foreground max-w-5xl mx-auto"
          dangerouslySetInnerHTML={{
            __html: termsHTML,
          }}
        />
      )}
      {confirmQuoteModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) confirmQuoteModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ValidatedForm
              action={path.to.api.digitalQuote(id)}
              validator={externalQuoteValidator}
              method="post"
              fetcher={fetcher}
              onSubmit={() => {
                submitted.current = true;
              }}
              encType="multipart/form-data"
            >
              <ModalHeader>
                <ModalTitle>{strings["Accept Quote"]}</ModalTitle>
                <ModalDescription>{`Are you sure you want to accept quote ${
                  quote.quoteId
                } for ${formatter.format(total)}?`}</ModalDescription>
              </ModalHeader>
              <ModalBody>
                {!companySettings?.digitalQuoteIncludesPurchaseOrders && (
                  <input type="hidden" name="file" />
                )}
                <input type="hidden" name="type" value="accept" />
                <div className="space-y-4 py-4">
                  <Input
                    name="digitalQuoteAcceptedBy"
                    label="Please enter your name"
                  />
                  <Input
                    name="digitalQuoteAcceptedByEmail"
                    label="Please enter your email address"
                  />
                  {companySettings?.digitalQuoteIncludesPurchaseOrders && (
                    <div
                      {...getRootProps()}
                      className={cn(
                        "w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer",
                        isDragActive ? "border-primary" : "border-muted"
                      )}
                    >
                      <input name="file" {...getInputProps()} />
                      {file ? (
                        <>
                          <p>{file.name}</p>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setFile(null)}
                          >
                            {strings.Change}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p>
                            {
                              strings[
                                "Drag and drop a Purchase Order PDF here, or click to select a file"
                              ]
                            }
                          </p>
                          <LuUpload className="mx-auto mt-4 h-12 w-12 text-muted-foreground" />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={confirmQuoteModal.onClose}>
                  {strings.Cancel}
                </Button>
                <input
                  type="hidden"
                  name="selectedLines"
                  value={JSON.stringify(selectedLines)}
                />

                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  type="submit"
                >
                  {strings["Yes, Accept"]}
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {rejectQuoteModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) rejectQuoteModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ValidatedForm
              action={path.to.api.digitalQuote(id)}
              validator={externalQuoteValidator}
              method="post"
              fetcher={fetcher}
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <ModalHeader>
                <ModalTitle>{strings["Reject Quote"]}</ModalTitle>
                <ModalDescription>
                  {strings["Are you sure you want to reject this quote?"]}
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <input type="hidden" name="type" value="reject" />
                <div className="space-y-4 py-4">
                  <Input
                    name="digitalQuoteRejectedBy"
                    label="Please enter your name"
                  />
                  <Input
                    name="digitalQuoteRejectedByEmail"
                    label="Please enter your email address"
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={rejectQuoteModal.onClose}>
                  {strings.Cancel}
                </Button>

                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  variant="destructive"
                  type="submit"
                >
                  {strings["Yes, Reject"]}
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </VStack>
  );
};

const ErrorMessage = ({
  title,
  message,
}: {
  title: string;
  message: string;
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        delay: 0.3,
        when: "beforeChildren",
        staggerChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };

  return (
    <motion.div
      className="flex min-h-screen flex-col items-center justify-center p-4 text-center"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <motion.div
        className="w-full max-w-md space-y-8"
        variants={containerVariants}
      >
        <motion.div
          className="relative mx-auto h-24 w-24"
          variants={itemVariants}
        >
          <svg
            className="absolute inset-0"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <motion.circle
              cx="50"
              cy="50"
              r="45"
              stroke="hsl(var(--muted))"
              strokeWidth="10"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, ease: "easeInOut" }}
            />
            <motion.path
              d="M50 5 A45 45 0 0 1 95 50"
              stroke="hsl(var(--primary))"
              strokeWidth="10"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 2,
                ease: "easeInOut",
              }}
            />
          </svg>
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.5,
              type: "spring",
              stiffness: 200,
              damping: 10,
            }}
          >
            <span className="text-2xl font-bold text-muted-foreground">!</span>
          </motion.div>
        </motion.div>
        <motion.h1
          className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          variants={itemVariants}
        >
          {title}
        </motion.h1>
        <motion.p
          className="text-lg text-muted-foreground"
          variants={itemVariants}
        >
          {message}
        </motion.p>
      </motion.div>
    </motion.div>
  );
};

type QuoteData = NonNullable<
  Awaited<ReturnType<Awaited<ReturnType<typeof loader>>["json"]>>["data"]
>;

export default function ExternalQuote() {
  const { state, data, strings } = useLoaderData<typeof loader>();

  switch (state) {
    case QuoteState.Valid:
      if (data) {
        // @ts-ignore
        return <Quote data={data as QuoteData} strings={strings} />;
      }
      return (
        <ErrorMessage
          title={strings["Quote not found"]}
          message={
            strings["Oops! The link you're trying to access is not valid."]
          }
        />
      );
    case QuoteState.Expired:
      return (
        <ErrorMessage
          title={strings["Quote expired"]}
          message={
            strings[
              "Oops! The link you're trying to access has expired or is no longer valid."
            ]
          }
        />
      );
    case QuoteState.NotFound:
      return (
        <ErrorMessage
          title={strings["Quote not found"]}
          message={
            strings["Oops! The link you're trying to access is not valid."]
          }
        />
      );
  }
}
