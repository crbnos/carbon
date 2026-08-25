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
  securityUrl: string;
}

// Sent to the person who just verified an authenticator app on their own
// account. This is an account-security receipt, not a notification — it is the
// only signal a user gets that someone enrolled a factor against their login,
// so it is sent regardless of notification preferences.
export const MfaEnabledEmail = ({
  recipientName = "there",
  securityUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={
        <Preview>Two-factor authentication is on for your account</Preview>
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
            Security
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            Two-factor authentication is on
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
                    An authenticator app was added to your Carbon account.
                    You'll be asked for a 6-digit code the next time you sign
                    in.
                  </Text>
                  <Text
                    className={`text-[15px] leading-[24px] m-0 mt-[12px] ${themeClasses.text}`}
                  >
                    If this wasn't you, remove the authenticator app from your
                    security settings and tell your administrator right away.
                  </Text>
                </td>
              </tr>
            </table>
          </Section>

          <Section className="text-center mb-[24px]">
            <Button
              href={securityUrl}
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
                Review security settings
              </span>
            </Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Or open this link in your browser:{" "}
            <Link
              href={securityUrl}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {securityUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default MfaEnabledEmail;
