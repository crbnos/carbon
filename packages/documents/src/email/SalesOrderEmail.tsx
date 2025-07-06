import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import {
  Body,
  Column,
  Container,
  Hr,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { Email } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal,
} from "../utils/sales-order";
import { getCurrencyFormatter } from "../utils/shared";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface SalesOrderEmailProps extends Email {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
}

const SalesOrderEmail = ({
  company,
  locale,
  salesOrder,
  salesOrderLines,
  salesOrderLocations,
  recipient,
  sender,
  paymentTerms,
}: SalesOrderEmailProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
    // paymentCustomerName,
    // paymentAddressLine1,
    // paymentAddressLine2,
    // paymentCity,
    // paymentStateProvince,
    // paymentPostalCode,
    // paymentCountryName,
  } = salesOrderLocations;

  const formatter = getCurrencyFormatter(company.baseCurrencyCode, locale);
  const preview = (
    <Preview>{`${salesOrder.salesOrderId} from ${company.name}`}</Preview>
  );
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");
  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesOrder.paymentTermId
  );

  return (
    <EmailThemeProvider preview={preview}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <Container
          className={`mx-auto py-5 px-0 w-[660px] max-w-full ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: "1px",
            borderColor: lightStyles.container.borderColor,
          }}
        >
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
                  className={`text-3xl font-light ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Sales Order
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
              please see the attached sales order and let me know if you have
              any questions.
            </Text>
          </Section>
          <Section className={`bg-gray-50 rounded-lg text-xs`}>
            <Row>
              <Column className="p-5" colSpan={2}>
                <Section>
                  {paymentTerm && (
                    <Row>
                      <Column>
                        <Text
                          className={`${themeClasses.mutedText} uppercase text-[10px]`}
                          style={{ color: lightStyles.mutedText.color }}
                        >
                          Payment Terms
                        </Text>
                        <Text>{paymentTerm?.name}</Text>
                      </Column>
                    </Row>
                  )}
                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Order ID
                      </Text>
                      <Text>{salesOrder.salesOrderId}</Text>
                    </Column>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Requested Date
                      </Text>
                      <Text>{salesOrder.receiptRequestedDate ?? "-"}</Text>
                    </Column>
                  </Row>
                </Section>
              </Column>
              <Column className="p-5" colSpan={2}>
                <Text
                  className={`${themeClasses.mutedText} uppercase text-[10px]`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Ship To
                </Text>
                <Text>{customerName}</Text>
                {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
                {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
                <Text>
                  {formatCityStatePostalCode(
                    customerCity,
                    customerStateProvince,
                    customerPostalCode
                  )}
                </Text>
                <Text>{customerCountryName}</Text>
              </Column>
            </Row>
          </Section>

          <Section>
            <Row className="mb-2.5 pl-5">
              <Column>
                <Text
                  className={`text-xs uppercase ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Description
                </Text>
              </Column>
              <Column className="text-right pr-5 align-top w-[100px]">
                <Text
                  className={`text-xs uppercase ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Quantity
                </Text>
              </Column>
              <Column className="text-right pr-5 align-top w-[100px]">
                <Text
                  className={`text-xs uppercase ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Unit Price
                </Text>
              </Column>
              <Column className="text-right pr-5 align-top w-[100px]">
                <Text
                  className={`text-xs uppercase ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Subtotal
                </Text>
              </Column>
            </Row>
            {salesOrderLines.map((line) => (
              <Row key={line.id} className="mb-2.5 pl-5">
                <Column>
                  <Text className="text-xs font-semibold">
                    {getLineDescription(line)}
                  </Text>
                  {getLineDescriptionDetails(line)
                    ?.split("\n")
                    .map((l, i) => (
                      <Text
                        key={i}
                        className={`text-xs ${themeClasses.mutedText}`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        {l}
                      </Text>
                    ))}
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.salesOrderLineType === "Comment"
                      ? ""
                      : `${line.saleQuantity}`}
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.salesOrderLineType === "Comment"
                      ? "-"
                      : formatter.format(line.unitPrice ?? 0)}
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.salesOrderLineType === "Comment"
                      ? "-"
                      : formatter.format(getLineTotal(line))}
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
              <Column className={`border-l border-gray-200 h-12`}></Column>
              <Column className="w-[90px] pr-5">
                <Text className="text-base font-semibold whitespace-nowrap">
                  {formatter.format(getTotal(salesOrderLines, salesOrder))}
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
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default SalesOrderEmail;
