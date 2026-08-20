import {
  Body,
  Button,
  Container,
  Heading,
  Link,
  Preview,
  Section,
  Text
} from "@react-email/components";
import { Logo } from "./components/Logo";
import { notificationStyles } from "./components/notificationStyles";
import { EmailThemeProvider, getEmailThemeClasses } from "./components/Theme";

interface Props {
  recipientName?: string;
  companyName: string;
  setupUrl: string;
}

// Sent to every active employee of a company when an admin turns on the
// two-factor requirement. It goes to people who already have an authenticator
// app as well as those who don't — the copy covers both so enrollment status
// never has to be resolved per recipient.
export const MfaRequiredEmail = ({
  recipientName = "there",
  companyName,
  setupUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>Two-factor authentication is now required</Preview>}
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
            Security
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            Two-factor authentication is now required
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
                    className={`text-[15px] leading-[24px] m-0 ${themeClasses.text}`}
                  >
                    {companyName} now requires an authenticator app to sign in
                    to Carbon. Set one up before your next sign-in — until you
                    do, you won't be able to open {companyName} in Carbon.
                  </Text>
                  <Text
                    className={`text-[15px] leading-[24px] m-0 mt-[12px] ${themeClasses.text}`}
                  >
                    Already using an authenticator app? You're all set, and
                    nothing changes for you.
                  </Text>
                </td>
              </tr>
            </table>
          </Section>

          <Section className="text-center mb-[24px]">
            <Button
              href={setupUrl}
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
              <span style={{ verticalAlign: "middle" }}>
                Set up two-factor authentication
              </span>
            </Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Or open this link in your browser:{" "}
            <Link
              href={setupUrl}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {setupUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default MfaRequiredEmail;
