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
  getTotal,
} from "../utils/purchase-order";
import { getCurrencyFormatter } from "../utils/shared";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface PurchaseOrderEmailProps extends Email {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
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
    customerCountryName,
  } = purchaseOrderLocations;

  const formatter = getCurrencyFormatter(company.baseCurrencyCode, locale);
  const preview = (
    <Preview>{`${purchaseOrder.purchaseOrderId} from ${company.name}`}</Preview>
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
          <Section className="bg-gray-50 rounded-lg text-xs">
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
                        <Text>{paymentTerm.name}</Text>
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
                      <Text>{purchaseOrder.purchaseOrderId}</Text>
                    </Column>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Requested Date
                      </Text>
                      <Text>{purchaseOrder.receiptRequestedDate ?? "-"}</Text>
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
                {dropShipment ? (
                  <>
                    <Text>{customerName}</Text>
                    {customerAddressLine1 && (
                      <Text>{customerAddressLine1}</Text>
                    )}
                    {customerAddressLine2 && (
                      <Text>{customerAddressLine2}</Text>
                    )}
                    <Text>
                      {formatCityStatePostalCode(
                        customerCity,
                        customerStateProvince,
                        customerPostalCode
                      )}
                    </Text>
                    <Text>{customerCountryName}</Text>
                  </>
                ) : (
                  <>
                    <Text>{company.name}</Text>
                    <Text>{deliveryName}</Text>
                    {deliveryAddressLine1 && (
                      <Text>{deliveryAddressLine1}</Text>
                    )}
                    {deliveryAddressLine2 && (
                      <Text>{deliveryAddressLine2}</Text>
                    )}
                    <Text>
                      {formatCityStatePostalCode(
                        deliveryCity,
                        deliveryStateProvince,
                        deliveryPostalCode
                      )}
                    </Text>
                    <Text>{deliveryCountryName}</Text>
                  </>
                )}
              </Column>
            </Row>
          </Section>
          <Section className="mt-8 mb-4">
            <Text
              className={`${themeClasses.mutedText} uppercase text-[10px] pl-5`}
              style={{ color: lightStyles.mutedText.color }}
            >
              Purchase Order Lines
            </Text>
          </Section>
          <Section>
            {purchaseOrderLines.map((line) => (
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
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : `(${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode})`}
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.purchaseOrderLineType === "Comment"
                      ? "-"
                      : line.unitPrice
                      ? formatter.format(line.unitPrice)
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
              <Column className="w-[90px] pr-5">
                <Text className="text-base font-semibold whitespace-nowrap">
                  {formatter.format(getTotal(purchaseOrderLines))}
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

export default PurchaseOrderEmail;
