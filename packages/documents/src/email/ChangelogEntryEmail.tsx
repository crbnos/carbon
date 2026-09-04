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

interface Props {
  title: string;
  description?: string;
  // Already-formatted display date ("04 Sep 2026"); the feed's pubDate, never a JS Date.
  date?: string;
  readUrl: string;
  // Account → Notifications in the ERP — the only place the newsletter can be
  // turned off (a signed-in page: only the user may change their preference).
  manageUrl: string;
}

// One changelog entry, sent to every confirmed subscriber the moment the entry
// is live on docs.carbon.ms (see packages/jobs changelog-dispatch). Same card as
// NotificationEmail — see .claude/rules/email-design.md. No greeting: a
// subscriber is an email address, not a Carbon user with a name.
export const ChangelogEntryEmail = ({
  title,
  description,
  date,
  readUrl,
  manageUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>{description ?? title}</Preview>}
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
            {date ? `Changelog · ${date}` : "Changelog"}
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {title}
          </Heading>

          {/* The description reads as prose, not a boxed record callout — this
              is an announcement, not a notification about a document. */}
          {description && (
            <Section>
              <Text
                className={`text-[15px] leading-[26px] m-0 mb-[28px] text-center ${themeClasses.text}`}
              >
                {description}
              </Text>
            </Section>
          )}

          <Section className="text-center mb-[24px]">
            <Button
              href={readUrl}
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
              <span style={{ verticalAlign: "middle" }}>Changelog</span>
            </Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Or open this link in your browser:{" "}
            <Link
              href={readUrl}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {readUrl}
            </Link>
          </Text>

          <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />
          <Text
            className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
          >
            You&apos;re receiving this email because the changelog newsletter is
            on in your Carbon account.{" "}
            <Link
              href={manageUrl}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              Manage notification settings
            </Link>
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default ChangelogEntryEmail;
