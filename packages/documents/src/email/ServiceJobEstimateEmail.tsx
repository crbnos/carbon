// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Body, Container, Heading, Preview, Section, Text } from "react-email";
import { Logo } from "./components/Logo";
import { notificationStyles } from "./components/notificationStyles";
import { EmailThemeProvider, getEmailThemeClasses } from "./components/Theme";

interface Props {
  companyName: string;
  /** The readable job number ("SJ000010"). */
  serviceJobId: string;
  /** The formatted estimate total, in the company's currency. */
  total: string;
  /** The unit being serviced: part number and name. */
  itemName?: string | null;
  serial?: string | null;
  recipientName?: string | null;
  senderName?: string | null;
}

/**
 * A service job's estimate, sent to the customer's contact with the estimate
 * PDF attached. There is no link: the customer answers by replying.
 */
export const ServiceJobEstimateEmail = ({
  companyName,
  serviceJobId,
  total,
  itemName,
  serial,
  recipientName,
  senderName
}: Props) => {
  const themeClasses = getEmailThemeClasses();
  const details = [
    itemName ? { label: "Unit", value: itemName } : null,
    serial ? { label: "Serial", value: serial } : null,
    { label: "Estimate total", value: total }
  ].filter((detail): detail is { label: string; value: string } => !!detail);

  return (
    <EmailThemeProvider
      preview={
        <Preview>{`Estimate ${serviceJobId} from ${companyName}`}</Preview>
      }
      additionalHeadContent={<style>{notificationStyles}</style>}
    >
      <Body
        className={`my-auto mx-auto font-sans nf-body ${themeClasses.body}`}
      >
        <Container
          className={`my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] nf-card ${themeClasses.container}`}
          style={{
            borderRadius: 16,
            borderStyle: "solid",
            borderWidth: 1
          }}
        >
          <Logo />

          <Text
            className={`text-[11px] leading-[16px] uppercase text-center font-medium m-0 mt-[40px] mb-[10px] nf-eyebrow ${themeClasses.mutedText}`}
            style={{ letterSpacing: "0.14em" }}
          >
            Estimate
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            Estimate {serviceJobId}
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              Hi {recipientName ?? "there"},
            </Text>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[24px] ${themeClasses.text}`}
            >
              {companyName} has prepared an estimate for the work on your unit.
              The estimate is attached. Reply to this email to approve or
              decline it.
            </Text>
          </Section>

          <Section
            className="nf-callout"
            style={{
              backgroundColor: "#fafafa",
              borderColor: "#ececef",
              borderRadius: 12,
              borderStyle: "solid",
              borderWidth: 1,
              marginBottom: 28,
              padding: "18px 20px"
            }}
          >
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              width="100%"
              style={{ borderCollapse: "collapse", width: "100%" }}
            >
              <tr>
                <td style={{ verticalAlign: "middle" }}>
                  <Text
                    className={`text-[15px] leading-[24px] m-0 font-medium ${themeClasses.text}`}
                  >
                    {serviceJobId}
                  </Text>
                </td>
              </tr>
            </table>
            <div
              className="nf-divider"
              style={{
                borderTopColor: "#ececef",
                borderTopStyle: "solid",
                borderTopWidth: 1,
                marginBottom: 14,
                marginTop: 14
              }}
            />
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              width="100%"
              style={{ borderCollapse: "collapse", width: "100%" }}
            >
              {details.map((detail, index) => (
                <tr key={detail.label}>
                  <td
                    style={{
                      paddingBottom: index === details.length - 1 ? 0 : 8,
                      paddingRight: 12,
                      verticalAlign: "top",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <Text
                      className={`text-[13px] leading-[20px] m-0 nf-fallback ${themeClasses.mutedText}`}
                    >
                      {detail.label}
                    </Text>
                  </td>
                  <td
                    style={{
                      paddingBottom: index === details.length - 1 ? 0 : 8,
                      textAlign: "right",
                      verticalAlign: "top"
                    }}
                  >
                    <Text
                      className={`text-[13px] leading-[20px] m-0 font-medium ${themeClasses.text}`}
                    >
                      {detail.value}
                    </Text>
                  </td>
                </tr>
              ))}
            </table>
          </Section>

          {senderName && (
            <Text
              className={`text-[15px] leading-[26px] m-0 ${themeClasses.text}`}
            >
              {senderName}
              <br />
              {companyName}
            </Text>
          )}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default ServiceJobEstimateEmail;
