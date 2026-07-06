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
import { EmailThemeProvider, getEmailThemeClasses } from "./components/Theme";

interface Props {
  preview?: string;
  heading?: string;
  message?: string;
  recipientName?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

// Dark-mode-aware styles. Backgrounds are intentionally set via CSS classes
// (not inline styles) so `!important` overrides in dark-mode media queries
// can flip them — inline `style` wins against non-important CSS, but loses to
// `!important`. Most modern clients (Apple Mail, iOS Mail, Gmail web/iOS,
// Outlook web/mobile) honor this; Outlook desktop renders light-mode only,
// matching the rest of the system.
const notificationStyles = `
  .nf-body {
    background-color: #f5f5f7;
    background-image: linear-gradient(180deg, #f5f5f7 0%, #ececef 100%);
  }
  .nf-card {
    background-color: #ffffff;
    background-image: linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%);
    border-color: #e5e7eb;
  }
  .nf-divider {
    border-color: #ececef !important;
  }
  .nf-eyebrow {
    color: #6b7280 !important;
  }
  .nf-callout {
    background-color: #fafafa !important;
    border-color: #ececef !important;
  }
  .nf-callout-accent {
    background-color: #0e0e0e !important;
  }
  .nf-cta {
    background-color: #0e0e0e !important;
    color: #ffffff !important;
    border-color: #0e0e0e !important;
  }
  .nf-fallback {
    color: #6b7280 !important;
  }

  @media (prefers-color-scheme: dark) {
    .nf-body {
      background-color: #0C0C0C !important;
      background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
    }
    .nf-card {
      background-color: #161618 !important;
      background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
      border-color: #1D1D1D !important;
    }
    .nf-divider {
      border-color: #1D1D1D !important;
    }
    .nf-eyebrow {
      color: #a1a1aa !important;
    }
    .nf-callout {
      background-color: #0F0F10 !important;
      border-color: #1D1D1D !important;
    }
    .nf-callout-accent {
      background-color: #fefefe !important;
    }
    .nf-cta {
      background-color: #fefefe !important;
      color: #0C0C0C !important;
      border-color: #fefefe !important;
    }
    .nf-fallback {
      color: #a1a1aa !important;
    }
  }

  /* Gmail desktop dark mode targeting */
  .gmail_dark .nf-body,
  .gmail_dark_theme .nf-body,
  [data-darkmode="true"] .nf-body {
    background-color: #0C0C0C !important;
    background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
  }
  .gmail_dark .nf-card,
  .gmail_dark_theme .nf-card,
  [data-darkmode="true"] .nf-card {
    background-color: #161618 !important;
    background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-divider,
  .gmail_dark_theme .nf-divider,
  [data-darkmode="true"] .nf-divider {
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-eyebrow,
  .gmail_dark_theme .nf-eyebrow,
  [data-darkmode="true"] .nf-eyebrow {
    color: #a1a1aa !important;
  }
  .gmail_dark .nf-callout,
  .gmail_dark_theme .nf-callout,
  [data-darkmode="true"] .nf-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-callout-accent,
  .gmail_dark_theme .nf-callout-accent,
  [data-darkmode="true"] .nf-callout-accent {
    background-color: #fefefe !important;
  }
  .gmail_dark .nf-cta,
  .gmail_dark_theme .nf-cta,
  [data-darkmode="true"] .nf-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  .gmail_dark .nf-fallback,
  .gmail_dark_theme .nf-fallback,
  [data-darkmode="true"] .nf-fallback {
    color: #a1a1aa !important;
  }

  /* Outlook web/mobile dark mode targeting */
  [data-ogsb] .nf-body {
    background-color: #0C0C0C !important;
  }
  [data-ogsb] .nf-card {
    background-color: #161618 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsb] .nf-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsc] .nf-eyebrow {
    color: #a1a1aa !important;
  }
  [data-ogsc] .nf-callout-accent {
    background-color: #fefefe !important;
  }
  [data-ogsc] .nf-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  [data-ogsc] .nf-fallback {
    color: #a1a1aa !important;
  }
`;

export const NotificationEmail = ({
  preview = "Job J-1024 assigned to you",
  heading = "Job assigned to you",
  message = "Job J-1024 assigned to you",
  recipientName = "Huckleberry",
  ctaLabel = "View details",
  ctaUrl = "https://app.carbon.ms/x/job/1234567890"
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>{preview}</Preview>}
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
                    className={`text-[15px] leading-[24px] m-0 ${themeClasses.text}`}
                  >
                    {message}
                  </Text>
                </td>
              </tr>
            </table>
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

          {/* <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />

          <Text
            className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
          >
            You're receiving this email because you have email notifications
            enabled on your Carbon account. You can manage your preferences from
            your account settings.
          </Text> */}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default NotificationEmail;
