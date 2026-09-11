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
  /** Parsed browser + OS, e.g. "Chrome on macOS". Never a raw user agent. */
  deviceLabel: string;
  signedInAt: string;
  securityUrl: string;
}

// Sent the first time an account is signed into from a device we have not seen
// before. An account-security receipt, not a notification — it is the only
// out-of-band signal a user gets that someone else reached their account, so it
// bypasses notification preferences and plan gates.
//
// Deliberately carries NO IP address and NO location: the IP is client-supplied
// on some deployments and geo headers are blank when self-hosted, so both would
// be unreliable at best and misleading at worst. Device and time are enough to
// answer "was that me?".
export const NewDeviceEmail = ({
  recipientName = "there",
  deviceLabel,
  signedInAt,
  securityUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>A new device signed in to your account</Preview>}
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
            A new device signed in
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
                    Your Carbon account was signed in from{" "}
                    <strong>{deviceLabel}</strong> on {signedInAt}.
                  </Text>
                  <Text
                    className={`text-[15px] leading-[24px] m-0 mt-[12px] ${themeClasses.text}`}
                  >
                    If this was you, no action is needed. If it wasn't, sign
                    that device out from your security settings and tell your
                    administrator right away.
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
                Review your devices
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

export default NewDeviceEmail;
