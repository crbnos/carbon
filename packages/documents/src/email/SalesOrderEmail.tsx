import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
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

interface SalesOrderEmailProps extends Email {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
}

const SalesOrderEmail = ({
  company,
  locale,
  salesOrder,
  salesOrderLines,
  salesOrderLocations,
  recipient,
  sender,
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

  const reSubject = `Re: ${salesOrder.salesOrderId} from ${company.name}`;

  const formatter = getCurrencyFormatter(company.baseCurrencyCode, locale);
  const shouldConvertCurrency =
    company.baseCurrencyCode !== salesOrder.currencyCode;

  return (
    <Html>
      <Head />
      <Preview>{`${salesOrder.salesOrderId} from ${company.name}`}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto py-5 px-0 w-[660px] max-w-full">
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
                    <Text className="text-3xl font-bold text-gray-900">
                      {company.name}
                    </Text>
                  )}
                </Column>
                <Column className="text-right">
                  <Text className="text-3xl font-light text-gray-500">
                    Sales Order
                  </Text>
                </Column>
              </Row>
            </Section>
            <Section>
              <Text className="text-left text-sm font-medium text-gray-900 my-9">
                {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
                please see the attached sales order and let me know if you have
                any questions.
              </Text>
            </Section>
            <Section className="bg-gray-50 rounded-lg text-xs">
              <Row>
                <Column className="p-5" colSpan={2}>
                  <Section>
                    <Row>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Seller
                        </Text>
                        <Link
                          href={`mailto:${sender.email}?subject=${reSubject}`}
                          className="text-blue-600 underline"
                        >
                          {`${sender.firstName} ${sender.lastName}`}
                        </Link>
                      </Column>
                    </Row>
                    <Row>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Payment Terms
                        </Text>
                        <Text>{salesOrder.paymentTermName ?? "-"}</Text>
                      </Column>
                    </Row>
                    <Row>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Order ID
                        </Text>
                        <Text>{salesOrder.salesOrderId}</Text>
                      </Column>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Requested Date
                        </Text>
                        <Text>{salesOrder.receiptRequestedDate ?? "-"}</Text>
                      </Column>
                    </Row>
                  </Section>
                </Column>
                <Column className="p-5" colSpan={2}>
                  <Text className="text-gray-600 uppercase text-[10px]">
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
            <Section className="mt-8 mb-4">
              <Text className="text-gray-600 uppercase text-[10px] pl-5">
                Sales Order Lines
              </Text>
            </Section>
            <Section>
              {salesOrderLines.map((line) => (
                <Row key={line.id} className="mb-2.5 pl-5">
                  <Column>
                    <Text className="text-xs font-semibold">
                      {getLineDescription(line)}
                    </Text>
                    {getLineDescriptionDetails(line)
                      ?.split("\n")
                      .map((l, i) => (
                        <Text key={i} className="text-xs text-gray-600">
                          {l}
                        </Text>
                      ))}
                  </Column>
                  <Column className="text-right pr-5 align-top w-[100px]">
                    <Text className="text-xs font-semibold">
                      {line.salesOrderLineType === "Comment"
                        ? ""
                        : `(${line.saleQuantity} ${line.unitOfMeasureCode})`}
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
                        : formatter.format(
                            getLineTotal(line, shouldConvertCurrency)
                          )}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
            <Hr className="my-8" />
            <Section className="text-right">
              <Row>
                <Column className="pr-8">
                  <Text className="text-[10px] font-semibold text-gray-600">
                    TOTAL
                  </Text>
                </Column>
                <Column className="border-l border-gray-200 h-12"></Column>
                <Column className="w-[90px] pr-5">
                  <Text className="text-base font-semibold whitespace-nowrap">
                    {formatter.format(
                      getTotal(salesOrderLines, shouldConvertCurrency)
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
                    <Text className="text-3xl font-bold text-gray-900">
                      {company.name}
                    </Text>
                  )}
                </Column>
              </Row>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default SalesOrderEmail;
