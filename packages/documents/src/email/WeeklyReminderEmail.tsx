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

// Single source for the reminder-status union ("Overdue" renders red,
// "Pending" muted) — jobs consumers import it via the email barrel since they
// can't reach the ERP app's models.
export const reminderItemStatuses = ["Pending", "Overdue"] as const;
export type ReminderItemStatus = (typeof reminderItemStatuses)[number];

export function isReminderItemStatus(
  value: string
): value is ReminderItemStatus {
  return (reminderItemStatuses as readonly string[]).includes(value);
}

// One outstanding item in the weekly digest (e.g. a training to complete).
interface ReminderItem {
  title: string;
  // Short status shown right-aligned on the row.
  status?: ReminderItemStatus;
  // Muted secondary line under the title (e.g. "Mandatory · Annual · 30 minutes").
  detail?: string;
  // When present the title links here (e.g. the training completion page).
  url?: string;
}

interface Props {
  preview?: string;
  heading?: string;
  message?: string;
  recipientName?: string;
  items?: ReminderItem[];
  ctaLabel?: string;
  ctaUrl?: string;
}

// Dark-mode-aware styles. Same approach as NotificationEmail: backgrounds via
// CSS classes (not inline styles) so `!important` overrides in dark-mode media
// queries can flip them. Outlook desktop renders light-mode only.
const weeklyReminderStyles = `
  .wr-body {
    background-color: #f5f5f7;
    background-image: linear-gradient(180deg, #f5f5f7 0%, #ececef 100%);
  }
  .wr-card {
    background-color: #ffffff;
    background-image: linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%);
    border-color: #e5e7eb;
  }
  .wr-eyebrow {
    color: #6b7280 !important;
  }
  .wr-callout {
    background-color: #fafafa !important;
    border-color: #ececef !important;
  }
  .wr-row-divider {
    border-top-color: #ececef !important;
  }
  .wr-status {
    color: #6b7280 !important;
  }
  .wr-status-overdue {
    color: #dc2626 !important;
  }
  .wr-cta {
    background-color: #0e0e0e !important;
    color: #ffffff !important;
    border-color: #0e0e0e !important;
  }
  .wr-fallback {
    color: #6b7280 !important;
  }

  @media (prefers-color-scheme: dark) {
    .wr-body {
      background-color: #0C0C0C !important;
      background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
    }
    .wr-card {
      background-color: #161618 !important;
      background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
      border-color: #1D1D1D !important;
    }
    .wr-eyebrow {
      color: #a1a1aa !important;
    }
    .wr-callout {
      background-color: #0F0F10 !important;
      border-color: #1D1D1D !important;
    }
    .wr-row-divider {
      border-top-color: #1D1D1D !important;
    }
    .wr-status {
      color: #a1a1aa !important;
    }
    .wr-status-overdue {
      color: #f87171 !important;
    }
    .wr-cta {
      background-color: #fefefe !important;
      color: #0C0C0C !important;
      border-color: #fefefe !important;
    }
    .wr-fallback {
      color: #a1a1aa !important;
    }
  }

  /* Gmail desktop dark mode targeting */
  .gmail_dark .wr-body,
  .gmail_dark_theme .wr-body,
  [data-darkmode="true"] .wr-body {
    background-color: #0C0C0C !important;
    background-image: linear-gradient(180deg, #0C0C0C 0%, #161618 100%) !important;
  }
  .gmail_dark .wr-card,
  .gmail_dark_theme .wr-card,
  [data-darkmode="true"] .wr-card {
    background-color: #161618 !important;
    background-image: linear-gradient(180deg, #161618 0%, #0F0F10 100%) !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .wr-callout,
  .gmail_dark_theme .wr-callout,
  [data-darkmode="true"] .wr-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .wr-row-divider,
  .gmail_dark_theme .wr-row-divider,
  [data-darkmode="true"] .wr-row-divider {
    border-top-color: #1D1D1D !important;
  }
  .gmail_dark .wr-eyebrow,
  .gmail_dark_theme .wr-eyebrow,
  [data-darkmode="true"] .wr-eyebrow {
    color: #a1a1aa !important;
  }
  .gmail_dark .wr-status,
  .gmail_dark_theme .wr-status,
  [data-darkmode="true"] .wr-status {
    color: #a1a1aa !important;
  }
  .gmail_dark .wr-status-overdue,
  .gmail_dark_theme .wr-status-overdue,
  [data-darkmode="true"] .wr-status-overdue {
    color: #f87171 !important;
  }
  .gmail_dark .wr-cta,
  .gmail_dark_theme .wr-cta,
  [data-darkmode="true"] .wr-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  .gmail_dark .wr-fallback,
  .gmail_dark_theme .wr-fallback,
  [data-darkmode="true"] .wr-fallback {
    color: #a1a1aa !important;
  }

  /* Outlook web/mobile dark mode targeting */
  [data-ogsb] .wr-body {
    background-color: #0C0C0C !important;
  }
  [data-ogsb] .wr-card {
    background-color: #161618 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsb] .wr-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  [data-ogsc] .wr-eyebrow {
    color: #a1a1aa !important;
  }
  [data-ogsc] .wr-status {
    color: #a1a1aa !important;
  }
  [data-ogsc] .wr-status-overdue {
    color: #f87171 !important;
  }
  [data-ogsc] .wr-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
  [data-ogsc] .wr-fallback {
    color: #a1a1aa !important;
  }
`;

// Content props get no sample defaults — fabricated data must never reach a
// real recipient. Sample data lives in the preview fixtures.
export const WeeklyReminderEmail = ({
  preview,
  heading = "Your weekly reminders",
  message,
  recipientName,
  items,
  ctaLabel = "View trainings",
  ctaUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={preview ? <Preview>{preview}</Preview> : undefined}
      additionalHeadContent={<style>{weeklyReminderStyles}</style>}
    >
      <Body
        className={`my-auto mx-auto font-sans wr-body ${themeClasses.body}`}
      >
        <Container
          className={`my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] wr-card ${themeClasses.container}`}
          style={{
            borderRadius: 16,
            borderStyle: "solid",
            borderWidth: 1
          }}
        >
          <Logo />

          <Text
            className={`text-[11px] leading-[16px] uppercase text-center font-medium m-0 mt-[40px] mb-[10px] wr-eyebrow ${themeClasses.mutedText}`}
            style={{ letterSpacing: "0.14em" }}
          >
            Weekly reminder
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {heading}
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[8px] ${themeClasses.text}`}
            >
              Hi {recipientName ?? "there"},
            </Text>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              {message}
            </Text>
          </Section>

          {items && items.length > 0 && (
            <Section
              className="wr-callout"
              style={{
                backgroundColor: "#fafafa",
                borderColor: "#ececef",
                borderRadius: 12,
                borderStyle: "solid",
                borderWidth: 1,
                marginBottom: 28,
                padding: "6px 20px"
              }}
            >
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                width="100%"
                style={{ borderCollapse: "collapse", width: "100%" }}
              >
                {items.map((item, index) => (
                  <tr key={`${item.title}-${index}`}>
                    <td
                      className={index > 0 ? "wr-row-divider" : undefined}
                      style={{
                        borderTopColor: index > 0 ? "#ececef" : undefined,
                        borderTopStyle: index > 0 ? "solid" : undefined,
                        borderTopWidth: index > 0 ? 1 : undefined,
                        padding: "12px 0",
                        verticalAlign: "top"
                      }}
                    >
                      <Text
                        className={`text-[15px] leading-[22px] m-0 font-medium ${themeClasses.text}`}
                      >
                        {item.url ? (
                          <Link
                            href={item.url}
                            className={`${themeClasses.text} underline`}
                          >
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </Text>
                      {item.detail && (
                        <Text
                          className={`text-[13px] leading-[20px] m-0 mt-[2px] wr-status ${themeClasses.mutedText}`}
                        >
                          {item.detail}
                        </Text>
                      )}
                    </td>
                    {item.status && (
                      <td
                        className={index > 0 ? "wr-row-divider" : undefined}
                        style={{
                          borderTopColor: index > 0 ? "#ececef" : undefined,
                          borderTopStyle: index > 0 ? "solid" : undefined,
                          borderTopWidth: index > 0 ? 1 : undefined,
                          padding: "12px 0",
                          textAlign: "right",
                          verticalAlign: "top",
                          whiteSpace: "nowrap"
                        }}
                      >
                        <Text
                          className={`text-[13px] leading-[22px] m-0 font-medium ${
                            item.status === "Overdue"
                              ? "wr-status-overdue"
                              : `wr-status ${themeClasses.mutedText}`
                          }`}
                          style={
                            item.status === "Overdue"
                              ? { color: "#dc2626" }
                              : undefined
                          }
                        >
                          {item.status}
                        </Text>
                      </td>
                    )}
                  </tr>
                ))}
              </table>
            </Section>
          )}

          {ctaUrl && (
            <>
              <Section className="text-center mb-[24px]">
                <Button
                  href={ctaUrl}
                  className="wr-cta"
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
                className={`text-[13px] leading-[20px] m-0 text-center break-all wr-fallback ${themeClasses.mutedText}`}
              >
                Or open this link in your browser:{" "}
                <Link
                  href={ctaUrl}
                  className={`${themeClasses.mutedText} underline wr-fallback`}
                >
                  {ctaUrl}
                </Link>
              </Text>
            </>
          )}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default WeeklyReminderEmail;
