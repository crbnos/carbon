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
  /** Already formatted for display, e.g. "October 11, 2026". Nothing is deleted before it. */
  deletionDate: string;
  billingUrl: string;
}

// Sent once to a company group's owner when the weekly cleanup finds the company
// has no active subscription. The company is deleted no sooner than a week later,
// and only if it is still without one.
export const CompanyDeletionWarningEmail = ({
  recipientName = "there",
  companyName,
  deletionDate,
  billingUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={
        <Preview>{`${companyName} will be deleted on or after ${deletionDate}`}</Preview>
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
            Account
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {companyName} will be deleted
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              Hi {recipientName},
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
            <Text
              className={`text-[15px] leading-[24px] m-0 ${themeClasses.text}`}
            >
              {companyName} doesn't have an active Carbon subscription. On or
              after {deletionDate} we'll permanently delete it, along with its
              data and files.
            </Text>
            <Text
              className={`text-[15px] leading-[24px] m-0 mt-[12px] ${themeClasses.text}`}
            >
              To keep it, choose a plan before then. Nothing else is needed.
            </Text>
          </Section>

          <Section className="text-center mb-[24px]">
            <Button
              href={billingUrl}
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
              <span style={{ verticalAlign: "middle" }}>Choose a plan</span>
            </Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Or open this link in your browser:{" "}
            <Link
              href={billingUrl}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {billingUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default CompanyDeletionWarningEmail;
