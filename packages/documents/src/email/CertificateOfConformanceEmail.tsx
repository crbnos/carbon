// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { DocumentCard, documentCardStyles } from "./components/DocumentCard";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
  HeadStyle
} from "./components/Theme";

interface CertificateOfConformanceEmailProps extends Email {
  /** Certificate number incl. revision suffix (`COC000012-1`). */
  certificateNumber: string;
  shipmentId: string;
  customerPurchaseOrder: string | null;
  lines: { itemNumber: string; description: string; quantity: string }[];
}

const CertificateOfConformanceEmail = ({
  company,
  certificateNumber,
  shipmentId,
  customerPurchaseOrder,
  lines,
  recipient
}: CertificateOfConformanceEmailProps) => {
  const preview = (
    <Preview>{`Certificate of Conformance ${certificateNumber} from ${company.name}`}</Preview>
  );
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider
      preview={preview}
      additionalHeadContent={<HeadStyle css={documentCardStyles} />}
    >
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
                  Certificate of Conformance
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
              please find attached Certificate of Conformance{" "}
              {certificateNumber} for shipment {shipmentId}
              {customerPurchaseOrder ? `, PO ${customerPurchaseOrder}` : ""}.
            </Text>
          </Section>

          {lines.length > 0 && (
            <Section>
              <Row className="mb-2.5 pl-5">
                <Column>
                  <Text
                    className={`text-xs uppercase ${themeClasses.mutedText}`}
                    style={{ color: lightStyles.mutedText.color }}
                  >
                    Item
                  </Text>
                </Column>
                <Column className="text-right pr-5 align-top w-[120px]">
                  <Text
                    className={`text-xs uppercase ${themeClasses.mutedText}`}
                    style={{ color: lightStyles.mutedText.color }}
                  >
                    Quantity
                  </Text>
                </Column>
              </Row>
              {lines.map((line, index) => (
                <Row key={index} className="mb-2.5 pl-5">
                  <Column>
                    <Text className="text-xs font-semibold">
                      {line.itemNumber}
                    </Text>
                    {line.description && (
                      <Text
                        className={`text-xs ${themeClasses.mutedText}`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        {line.description}
                      </Text>
                    )}
                  </Column>
                  <Column className="text-right pr-5 align-top w-[120px]">
                    <Text className="text-xs font-semibold">
                      {line.quantity}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
          )}

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

export default CertificateOfConformanceEmail;
