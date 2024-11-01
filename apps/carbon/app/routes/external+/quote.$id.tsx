import { getCarbonServiceRole } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  Heading,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { useLoaderData } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuCreditCard, LuImage, LuTruck } from "react-icons/lu";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import type { QuotationLine, QuotationPrice } from "~/modules/sales";
import {
  getQuoteByExternalId,
  getQuoteCustomerDetails,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuotePayment,
  getQuoteShipment,
  getSalesTerms,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export const meta = () => {
  return [{ title: "Digital Quote" }];
};

enum QuoteState {
  Valid,
  Expired,
  NotFound,
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return json({
      state: QuoteState.NotFound,
      data: null,
    });
  }

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);

  if (quote.error) {
    return json({
      state: QuoteState.NotFound,
      data: null,
    });
  }

  if (
    quote.data.expirationDate &&
    new Date(quote.data.expirationDate) < new Date()
  ) {
    return json({
      state: QuoteState.Expired,
      data: null,
    });
  }

  const [
    company,
    quoteLines,
    quoteLinePrices,
    customerDetails,
    quotePayment,
    quoteShipment,
    paymentTerms,
    terms,
    shippingMethods,
  ] = await Promise.all([
    getCompany(serviceRole, quote.data.companyId),
    getQuoteLines(serviceRole, quote.data.id),
    getQuoteLinePricesByQuoteId(serviceRole, quote.data.id),
    getQuoteCustomerDetails(serviceRole, quote.data.id),
    getQuotePayment(serviceRole, quote.data.id),
    getQuoteShipment(serviceRole, quote.data.id),
    getPaymentTermsList(serviceRole, quote.data.companyId),
    getSalesTerms(serviceRole, quote.data.companyId),
    getShippingMethodsList(serviceRole, quote.data.companyId),
  ]);

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
      quoteLines: quoteLines.data,
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
    },
  });
}

const Header = ({
  company,
  quote,
  customer,
}: {
  company: QuoteData["company"];
  quote: QuoteData["quote"];
  customer: QuoteData["customerDetails"];
}) => (
  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-start justify-between space-y-4 sm:space-y-0 pb-7">
    <div className="flex items-center space-x-4">
      <div>
        <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>

        {quote?.quoteId && (
          <p className="text-lg text-muted-foreground">{quote.quoteId}</p>
        )}
      </div>
    </div>
    <div className="flex flex-col items-end justify-start">
      <p className="text-xl font-medium">{customer?.customerName ?? ""}</p>
      <p className="text-lg text-muted-foreground">{customer?.email ?? ""}</p>
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
};

const deselectedLine: Omit<QuotationPrice, "id" | "quoteLineId"> = {
  convertedNetExtendedPrice: 0,
  convertedNetUnitPrice: 0,
  convertedUnitPrice: 0,
  createdAt: "",
  createdBy: "",
  discountPercent: 0,
  exchangeRate: 1,
  leadTime: 0,
  netExtendedPrice: 0,
  netUnitPrice: 0,
  quantity: 0,
  quoteId: "",
  unitPrice: 0,
  updatedAt: null,
  updatedBy: null,
};

const LineItems = ({
  formatter,
  selectedLines,
  setSelectedLines,
}: {
  formatter: Intl.NumberFormat;
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
}) => {
  const { company, quote, quoteLines, quoteLinePrices, thumbnails } =
    useLoaderData<typeof loader>().data!;

  const [openItems, setOpenItems] = useState<string[]>([]);

  const pricingByLine = useMemo(
    () =>
      quoteLines?.reduce<Record<string, QuotationPrice[]>>((acc, line) => {
        if (!line.id) {
          return acc;
        }
        acc[line.id!] =
          quoteLinePrices?.filter((p) => p.quoteLineId === line.id) ?? [];
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
        const prices = quoteLinePrices?.find(
          (price) => price.quoteLineId === line.id
        );

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
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
                  src={thumbnails[line.id!] ?? undefined}
                />
              ) : (
                <div className="w-20 h-20 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
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
                      <span className="font-medium text-xl">
                        {formatter.format(
                          (selectedLines[line.id!]?.convertedNetUnitPrice ??
                            0) *
                            (selectedLines[line.id!]?.quantity ?? 0) +
                            (selectedLines[line.id!]?.convertedAddOn ?? 0)
                        )}
                      </span>
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 180 : 0,
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronDown size={24} />
                      </motion.div>
                    </HStack>
                  </div>
                  <span className="text-muted-foreground text-base truncate">
                    {line.description}
                  </span>
                  <div
                    className="prose dark:prose-invert text-muted-foreground"
                    dangerouslySetInnerHTML={{
                      __html: generateHTML(line.notes as JSONContent),
                    }}
                  />
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
                selectedLine={selectedLines[line.id!]}
                setSelectedLines={setSelectedLines}
              />
            </motion.div>
          </motion.div>
        );
      })}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: QuotationLine;
  options: QuotationPrice[];
  quoteCurrency: string;
  shouldConvertCurrency: boolean;
  quoteExchangeRate: number;
  formatter: Intl.NumberFormat;
  selectedLine: SelectedLine;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
};

const LinePricingOptions = ({
  line,
  options,
  quoteCurrency,
  shouldConvertCurrency,
  quoteExchangeRate,
  formatter,
  selectedLine,
  setSelectedLines,
}: LinePricingOptionsProps) => {
  const [selectedValue, setSelectedValue] = useState(
    selectedLine.quantity.toString()
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

  return (
    <VStack spacing={2}>
      <RadioGroup
        className="w-full"
        value={selectedValue}
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
              },
            }));
            setSelectedValue(value);
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th></Th>
              <Th>Quantity</Th>
              <Th>Unit Price</Th>
              <Th>Add-Ons</Th>
              <Th>Lead Time</Th>
              <Th>Total Price</Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-center py-8">
                  No pricing options found
                </Td>
              </Tr>
            ) : (
              [...options, deselectedLine].map(
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
                        {formatter.format(option.convertedNetUnitPrice ?? 0)}
                      </Td>
                      <Td>
                        {formatter.format(
                          convertedAdditionalChargesByQuantity[option.quantity]
                        )}
                      </Td>
                      <Td>{option.leadTime} days</Td>
                      <Td>
                        {formatter.format(
                          (option.convertedNetUnitPrice ?? 0) *
                            option.quantity +
                            convertedAdditionalChargesByQuantity[
                              option.quantity
                            ]
                        )}
                      </Td>
                    </Tr>
                  )
              )
            )}
          </Tbody>
        </Table>
      </RadioGroup>
    </VStack>
  );
};

const Quote = ({ data }: { data: QuoteData }) => {
  const {
    company,
    customerDetails,
    paymentTerm,
    quote,
    quoteLines,
    quoteLinePrices,
    shippingMethod,
    terms,
  } = data;
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: quote.currencyCode ?? "USD",
        maximumFractionDigits: 4,
      }),
    [locale, quote.currencyCode]
  );

  const [selectedLines, setSelectedLines] = useState<
    Record<string, SelectedLine>
  >(() => {
    return (
      quoteLines?.reduce<Record<string, SelectedLine>>((acc, line) => {
        const price = quoteLinePrices?.find(
          (price) => price.quoteLineId === line.id
        );
        if (!line.id || !price) {
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
        };
        return acc;
      }, {}) ?? {}
    );
  });

  const subtotal = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc + line.convertedNetUnitPrice * line.quantity + line.convertedAddOn
    );
  }, 0);
  const tax = 0;
  const total = subtotal + tax;

  const termsHTML = generateHTML(terms as JSONContent);
  console.log({ termsHTML });

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {company?.logo && (
        <img
          src={company.logo}
          alt={company.name}
          className="h-24 w-auto mx-auto rounded-lg"
        />
      )}
      <Card className="w-full max-w-5xl mx-auto">
        <Header company={company} quote={quote} customer={customerDetails} />
        <CardContent>
          <LineItems
            selectedLines={selectedLines}
            setSelectedLines={setSelectedLines}
            formatter={formatter}
          />

          <VStack spacing={2} className="mt-8">
            {shippingMethod && (
              <HStack className="justify-between text-sm text-muted-foreground w-full">
                <HStack spacing={2}>
                  <LuTruck className="w-5 h-5" />
                  <span>Shipping Method:</span>
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
                  <span>Payment Term:</span>
                </HStack>
                <span className="text-foreground font-bold">{paymentTerm}</span>
              </HStack>
            )}
            {(shippingMethod || paymentTerm) && <Separator />}

            <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>Subtotal:</span>
              <span>{formatter.format(subtotal)}</span>
            </HStack>
            {/* <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>Tax:</span>
              <span>{formatter.format(tax)}</span>
            </HStack> */}
            <Separator />
            <HStack className="justify-between text-xl font-bold w-full">
              <span>Total:</span>
              <span>{formatter.format(total)}</span>
            </HStack>
          </VStack>
          {company?.digitalQuoteEnabled && (
            <Button size="lg" className="w-full mt-8 text-lg">
              Accept Quote
            </Button>
          )}
        </CardContent>
      </Card>
      {termsHTML && (
        <div
          className="prose dark:prose-invert text-muted-foreground max-w-none"
          dangerouslySetInnerHTML={{
            __html: termsHTML,
          }}
        />
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
  const { state, data } = useLoaderData<typeof loader>();

  switch (state) {
    case QuoteState.Valid:
      if (data) {
        return <Quote data={data as QuoteData} />;
      }
      return (
        <ErrorMessage
          title="Quote not found"
          message="Oops! The link you're trying to access is not valid."
        />
      );
    case QuoteState.Expired:
      return (
        <ErrorMessage
          title="Quote expired"
          message="Oops! The link you're trying to access has expired or is no longer valid."
        />
      );
    case QuoteState.NotFound:
      return (
        <ErrorMessage
          title="Quote not found"
          message="Oops! The link you're trying to access is not valid."
        />
      );
  }
}
