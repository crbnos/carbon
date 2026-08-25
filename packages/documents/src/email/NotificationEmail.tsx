import { renderInlineLinks } from "@carbon/notifications";
import {
  Body,
  Button,
  Container,
  Heading,
  Hr,
  Link,
  Preview,
  Section,
  Text
} from "@react-email/components";
import { Logo } from "./components/Logo";
import { notificationStyles } from "./components/notificationStyles";
import { EmailThemeProvider, getEmailThemeClasses } from "./components/Theme";

// Structurally compatible with `NotificationDetail` from `@carbon/notifications`,
// which this file now also imports `renderInlineLinks` from — the parser must be the
// same one the in-app bell uses, or a link that works in one place fails in the other.
interface NotificationDetail {
  label: string;
  value: string;
}

interface Props {
  preview?: string;
  heading?: string;
  message?: string;
  // The bare record identifier (e.g. "J00105"). When present it's rendered as
  // the prominent line in the callout instead of the full `message` sentence —
  // the heading already supplies the action ("Job assigned to you").
  reference?: string;
  recipientName?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  details?: NotificationDetail[];
  // The ERP origin. A `[label](url)` in a detail value is rendered as a real anchor
  // only when the url is an https url on THIS origin; without it every value stays
  // literal text, which is the safe default for a customer-authored body.
  erpUrl?: string;
  // When set, renders the "Manage notification settings" footer.
  settingsUrl?: string;
}

// Content props get no sample defaults — fabricated data must never reach a
// real recipient. Sample data lives in the preview fixtures.
export const NotificationEmail = ({
  preview,
  heading,
  message,
  reference,
  recipientName,
  ctaLabel = "View details",
  ctaUrl,
  details,
  erpUrl,
  settingsUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={preview ? <Preview>{preview}</Preview> : undefined}
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
            New notification
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {heading}
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              Hi {recipientName ?? "there"},
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
                    {reference ?? message}
                  </Text>
                </td>
              </tr>
            </table>

            {details && details.length > 0 && (
              <>
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
                    <tr key={`${detail.label}-${index}`}>
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
                          {erpUrl
                            ? renderInlineLinks(detail.value, erpUrl).map(
                                (segment, i) =>
                                  "href" in segment ? (
                                    <Link
                                      // Segments have no stable id; the value is
                                      // re-rendered whole or not at all.
                                      // biome-ignore lint/suspicious/noArrayIndexKey: no stable id
                                      key={i}
                                      href={segment.href}
                                      style={{ color: "#2563eb" }}
                                    >
                                      {segment.text}
                                    </Link>
                                  ) : (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: no stable id
                                    <span key={i}>{segment.text}</span>
                                  )
                              )
                            : detail.value}
                        </Text>
                      </td>
                    </tr>
                  ))}
                </table>
              </>
            )}
          </Section>

          {ctaUrl && (
            <>
              <Section className="text-center mb-[24px]">
                <Button
                  href={ctaUrl}
                  className="nf-cta"
                  style={{
                    backgroundColor: "#0e0e0e",
                    borderColor: "#0e0e0e",
                    borderRadius: 10,
                    borderStyle: "solid",
                    borderWidth: 1,
                    color: "#ffffff",
                    display: "inline-block",
                    fontSize: 14,
                    fontWeight: 500,
                    padding: "13px 24px",
                    textAlign: "center",
                    textDecoration: "none"
                  }}
                >
                  <span style={{ verticalAlign: "middle" }}>{ctaLabel}</span>
                </Button>
              </Section>

              <Text
                className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
              >
                Or open this link in your browser:{" "}
                <Link
                  href={ctaUrl}
                  className={`${themeClasses.mutedText} underline nf-fallback`}
                >
                  {ctaUrl}
                </Link>
              </Text>
            </>
          )}

          {settingsUrl && (
            <>
              <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />
              <Text
                className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
              >
                You&apos;re receiving this email because you have email
                notifications enabled on your Carbon account.{" "}
                <Link
                  href={settingsUrl}
                  className={`${themeClasses.mutedText} underline nf-fallback`}
                >
                  Manage notification settings
                </Link>
              </Text>
            </>
          )}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default NotificationEmail;
