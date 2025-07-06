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
} from "../utils/sales-invoice";
import { getCurrencyFormatter } from "../utils/shared";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface SalesInvoiceEmailProps extends Email {
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesInvoiceLocations: Database["public"]["Views"]["salesInvoiceLocations"]["Row"];
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
  paymentTerms: { id: string; name: string }[];
}

const SalesInvoiceEmail = ({
  company,
  locale,
  salesInvoice,
  salesInvoiceLines,
  salesInvoiceLocations,
  salesInvoiceShipment,
  recipient,
  sender,
  paymentTerms,
}: SalesInvoiceEmailProps) => {
  const {
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    invoiceCity,
    invoiceStateProvince,
    invoicePostalCode,
    invoiceCountryName,
  } = salesInvoiceLocations;

  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);
  const preview = (
    <Preview>{`${salesInvoice.invoiceId} from ${company.name}`}</Preview>
  );
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

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
                  Sales Invoice
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
              please see the attached invoice and let me know if you have any
              questions.
            </Text>
          </Section>
          <Section className={`bg-gray-50 rounded-lg text-xs`}>
            <Row>
              <Column className="p-5" colSpan={2}>
                <Section>
                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Payment Terms
                      </Text>
                      <Text>
                        {
                          paymentTerms?.find(
                            (term) => term.id === salesInvoice.paymentTermId
                          )?.name
                        }
                      </Text>
                    </Column>
                  </Row>
                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Invoice ID
                      </Text>
                      <Text>{salesInvoice.invoiceId}</Text>
                    </Column>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Due Date
                      </Text>
                      <Text>{salesInvoice.dateDue ?? "-"}</Text>
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
                <Text>{invoiceCustomerName}</Text>
                {invoiceAddressLine1 && <Text>{invoiceAddressLine1}</Text>}
                {invoiceAddressLine2 && <Text>{invoiceAddressLine2}</Text>}
                <Text>
                  {formatCityStatePostalCode(
                    invoiceCity,
                    invoiceStateProvince,
                    invoicePostalCode
                  )}
                </Text>
                <Text>{invoiceCountryName}</Text>
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
            {salesInvoiceLines.map((line) => (
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
                    {line.invoiceLineType === "Comment"
                      ? ""
                      : `${line.quantity}`}
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.invoiceLineType === "Comment"
                      ? "-"
                      : formatter.format(line.convertedUnitPrice ?? 0)}
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[100px]">
                  <Text className="text-xs font-semibold">
                    {line.invoiceLineType === "Comment"
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
                  {formatter.format(
                    getTotal(
                      salesInvoiceLines,
                      salesInvoice,
                      salesInvoiceShipment
                    )
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
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default SalesInvoiceEmail;
