import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import {
  Body,
  Column,
  Container,
  Font,
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
  getTotal,
} from "../utils/purchase-order";

interface PurchaseOrderEmailProps extends Email {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
}

const PurchaseOrderEmail = ({
  company,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  recipient,
  sender,
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

  const reSubject = `Re: ${purchaseOrder.purchaseOrderId} from ${company.name}`;

  return (
    <Html>
      <Preview>{`${purchaseOrder.purchaseOrderId} from ${company.name}`}</Preview>
      <Tailwind>
        <head>
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-400-normal.woff2",
              format: "woff2",
            }}
            fontWeight={400}
            fontStyle="normal"
          />

          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-500-normal.woff2",
              format: "woff2",
            }}
            fontWeight={500}
            fontStyle="normal"
          />
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-800-normal.woff2",
              format: "woff2",
            }}
            fontWeight={800}
            fontStyle="normal"
          />
        </head>

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
                    Purchase Order
                  </Text>
                </Column>
              </Row>
            </Section>
            <Section>
              <Text className="text-left text-sm font-medium text-gray-900 my-9">
                {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
                please see the attached purchase order and let me know if you
                have any questions.
              </Text>
            </Section>
            <Section className="bg-gray-50 rounded-lg text-xs">
              <Row>
                <Column className="p-5" colSpan={2}>
                  <Section>
                    <Row>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Buyer
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
                        <Text>{purchaseOrder.paymentTermName ?? "-"}</Text>
                      </Column>
                    </Row>
                    <Row>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Order ID
                        </Text>
                        <Text>{purchaseOrder.purchaseOrderId}</Text>
                      </Column>
                      <Column>
                        <Text className="text-gray-600 uppercase text-[10px]">
                          Requested Date
                        </Text>
                        <Text>{purchaseOrder.receiptRequestedDate ?? "-"}</Text>
                      </Column>
                    </Row>
                  </Section>
                </Column>
                <Column className="p-5" colSpan={2}>
                  <Text className="text-gray-600 uppercase text-[10px]">
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
              <Text className="text-gray-600 uppercase text-[10px] pl-5">
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
                        <Text key={i} className="text-xs text-gray-600">
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
                        ? `$${line.unitPrice.toFixed(2)}`
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
                  <Text className="text-[10px] font-semibold text-gray-600">
                    TOTAL
                  </Text>
                </Column>
                <Column className="border-l border-gray-200 h-12"></Column>
                <Column className="w-[90px] pr-5">
                  <Text className="text-base font-semibold whitespace-nowrap">
                    {`$${getTotal(purchaseOrderLines)}`}
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

export default PurchaseOrderEmail;
