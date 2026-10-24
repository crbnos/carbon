// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { formatCityStatePostalCode, formatDate } from "@carbon/utils";
import {
  Body,
  Column,
  Hr,
  Img,
  Preview,
  Row,
  Section,
  Text
} from "react-email";
import type { Email } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getPurchaseOrderDisplayId,
  getTotal
} from "../utils/purchase-order";
import { getMoneyFormatter, getRateFormatter } from "../utils/shared";
import { DocumentCard } from "./components/DocumentCard";
import {
  detailText,
  labelText,
  lineDetail,
  lineTitle
} from "./components/documentStyles";
import ExternalNotes from "./components/ExternalNotes";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses
} from "./components/Theme";

interface PurchaseOrderEmailProps extends Email {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
  /** currency.decimalPlaces for the document currency; null falls back to 2 */
  currencyDecimals?: number | null;
}

const PurchaseOrderEmail = ({
  company,
  locale,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  recipient,
  sender,
  paymentTerms,
  currencyDecimals
}: PurchaseOrderEmailProps) => {
  const {
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryStateProvince,
    deliveryPostalCode,
    deliveryCountryName,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName
  } = purchaseOrderLocations;

  // The DOCUMENT's currency, not the company's — a supplier priced in JPY must
  // not be emailed as "$20.00". Decimals come from that currency's row.
  const formatter = getMoneyFormatter(
    locale,
    currencyDecimals,
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD"
  );
  // A unit price is a RATE, not a settlement amount: the currency's
  // decimals are its FLOOR, not its ceiling, so a sub-cent price does not
  // print as 0.00. The PDFs already split these two kinds.
  const rateFormatter = getRateFormatter(
    locale,
    currencyDecimals,
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD"
  );
  const preview = (
    <Preview>{`${getPurchaseOrderDisplayId(purchaseOrder)} from ${company.name}`}</Preview>
  );
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === purchaseOrder.paymentTermId
  );

  return (
    <EmailThemeProvider preview={preview}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <DocumentCard>
          <Section>
            <Row>
              <Column>
                {company.logoLightIcon ? (
                  <Img
                    src={company.logoLightIcon}
                    width="auto"
                    height="42"
                    alt={`${company.name} Logo`}
                  />
                ) : (
                  <Text
                    className={`text-3xl font-bold ${themeClasses.text}`}
                    style={{ color: lightStyles.text.color }}
                  >
                    {company.name}
                  </Text>
                )}
              </Column>
              <Column className="text-right">
                <Text
                  className={themeClasses.text}
                  style={{
                    margin: 0,
                    paddingLeft: "16px",
                    fontSize: "22px",
                    lineHeight: "28px",
                    color: lightStyles.text.color
                  }}
                >
                  Purchase Order
                </Text>
              </Column>
            </Row>
          </Section>
          <Section>
            <Text
              className={`text-left text-sm font-medium ${themeClasses.text} my-9`}
              style={{ color: lightStyles.text.color }}
            >
              {recipient.firstName ? `Hi ${recipient.firstName}, ` : "Hi, "}
              please see the attached purchase order and let me know if you have
              any questions.
            </Text>
          </Section>
          <ExternalNotes content={purchaseOrder.externalNotes} />
          <Section className="bg-gray-50 rounded-[8px] text-xs email-panel">
            <Row>
              <Column className="p-5 align-top" colSpan={2}>
                <Section>
                  {paymentTerm && (
                    <Row>
                      <Column>
                        <Text
                          className={`${themeClasses.mutedText} uppercase`}
                          style={{
                            ...labelText,
                            color: lightStyles.mutedText.color
                          }}
                        >
                          Payment Terms
                        </Text>
                        <Text style={detailText}>{paymentTerm.name}</Text>
                      </Column>
                    </Row>
                  )}
                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase`}
                        style={{
                          ...labelText,
                          color: lightStyles.mutedText.color
                        }}
                      >
                        Order ID
                      </Text>
                      <Text style={detailText}>
                        {getPurchaseOrderDisplayId(purchaseOrder)}
                      </Text>
                    </Column>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase`}
                        style={{
                          ...labelText,
                          color: lightStyles.mutedText.color
                        }}
                      >
                        Requested Date
                      </Text>
                      <Text style={detailText}>
                        {purchaseOrder.receiptRequestedDate
                          ? formatDate(
                              purchaseOrder.receiptRequestedDate,
                              undefined,
                              locale
                            )
                          : "-"}
                      </Text>
                    </Column>
                  </Row>
                </Section>
              </Column>
              <Column className="p-5 align-top" colSpan={2}>
                <Text
                  className={`${themeClasses.mutedText} uppercase`}
                  style={{ ...labelText, color: lightStyles.mutedText.color }}
                >
                  Ship To
                </Text>
                {dropShipment ? (
                  <>
                    <Text style={detailText}>{customerName}</Text>
                    {customerAddressLine1 && (
                      <Text style={detailText}>{customerAddressLine1}</Text>
                    )}
                    {customerAddressLine2 && (
                      <Text style={detailText}>{customerAddressLine2}</Text>
                    )}
                    <Text style={detailText}>
                      {formatCityStatePostalCode(
                        customerCity,
                        customerStateProvince,
                        customerPostalCode
                      )}
                    </Text>
                    <Text style={detailText}>{customerCountryName}</Text>
                  </>
                ) : (
                  <>
                    <Text style={detailText}>{company.name}</Text>
                    <Text style={detailText}>{deliveryName}</Text>
                    {deliveryAddressLine1 && (
                      <Text style={detailText}>{deliveryAddressLine1}</Text>
                    )}
                    {deliveryAddressLine2 && (
                      <Text style={detailText}>{deliveryAddressLine2}</Text>
                    )}
                    <Text style={detailText}>
                      {formatCityStatePostalCode(
                        deliveryCity,
                        deliveryStateProvince,
                        deliveryPostalCode
                      )}
                    </Text>
                    <Text style={detailText}>{deliveryCountryName}</Text>
                  </>
                )}
              </Column>
            </Row>
          </Section>
          <Section className="mt-8 mb-4">
            <Text
              className={`${themeClasses.mutedText} uppercase`}
              style={{ ...labelText, color: lightStyles.mutedText.color }}
            >
              Purchase Order Lines
            </Text>
          </Section>
          <Section>
            {purchaseOrderLines.map((line) => (
              <Row key={line.id} className="mb-2.5">
                <Column>
                  <Text style={lineTitle}>{getLineDescription(line)}</Text>
                  {getLineDescriptionDetails(line)
                    ?.split("\n")
                    .map((l, i) => (
                      <Text
                        key={i}
                        className={themeClasses.mutedText}
                        style={{
                          ...lineDetail,
                          color: lightStyles.mutedText.color
                        }}
                      >
                        {l}
                      </Text>
                    ))}
                </Column>
                <Column className="text-right align-top w-[100px]">
                  <Text style={lineTitle}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : `(${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode})`}
                  </Text>
                </Column>
                <Column className="text-right align-top w-[100px]">
                  <Text style={lineTitle}>
                    {line.purchaseOrderLineType === "Comment"
                      ? "-"
                      : // `formatter` is the SUPPLIER's currency (above), and
                        // purchaseOrderLine.unitPrice is the GENERATED BASE
                        // column -- supplierUnitPrice is what the supplier
                        // quoted, and it is what getLineTotal already sums.
                        // A zero unit price is a real price (a no-charge
                        // line), not a missing one, and getLineTotal already
                        // sums it as 0 -- so test for absence, not falsiness.
                        line.supplierUnitPrice != null
                        ? rateFormatter.format(line.supplierUnitPrice)
                        : "-"}
                  </Text>
                </Column>
              </Row>
            ))}
          </Section>
          <Hr className="my-8" />
          <Section className="text-right">
            <Row>
              <Column className="pr-8">
                <Text
                  className={`text-[10px] font-semibold ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  TOTAL
                </Text>
              </Column>
              <Column className="border-l border-gray-200 h-12"></Column>
              <Column className="w-[90px]">
                <Text className="text-base font-semibold whitespace-nowrap">
                  {formatter.format(
                    getTotal(purchaseOrderLines) +
                      (purchaseOrder.supplierShippingCost ?? 0)
                  )}
                </Text>
              </Column>
            </Row>
          </Section>
          <Hr className="mb-20" />
          <Section>
            <Row>
              <Column className="text-center">
                {company.logoLightIcon ? (
                  <Img
                    src={company.logoLightIcon}
                    width="60"
                    height="auto"
                    alt={`${company.name} Logo`}
                  />
                ) : (
                  <Text
                    className={`text-3xl font-bold ${themeClasses.text}`}
                    style={{ color: lightStyles.text.color }}
                  >
                    {company.name}
                  </Text>
                )}
              </Column>
            </Row>
          </Section>
        </DocumentCard>
      </Body>
    </EmailThemeProvider>
  );
};

export default PurchaseOrderEmail;
