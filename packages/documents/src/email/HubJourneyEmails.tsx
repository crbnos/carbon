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

// The Implementation Hub's journey emails: the day-3 and day-10 streak
// trophies, the Monday digest, and the quiet-detection nudge. One shared
// layout (mirroring ImplementationHubEmail's dark-mode-aware chrome) with
// three thin, typed fronts. Written like a coworker, not a newsletter.

const journeyStyles = `
  .nf-body {
    background-color: #f5f5f7;
    background-image: linear-gradient(180deg, #f5f5f7 0%, #ececef 100%);
  }
  .nf-card {
    background-color: #ffffff;
    background-image: linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%);
    border-color: #e5e7eb;
  }
  .nf-eyebrow {
    color: #6b7280 !important;
  }
  .nf-callout {
    background-color: #fafafa !important;
    border-color: #ececef !important;
  }
  .nf-cta {
    background-color: #0e0e0e;
    color: #ffffff;
    border-color: #0e0e0e;
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
    .nf-eyebrow {
      color: #a1a1aa !important;
    }
    .nf-callout {
      background-color: #0F0F10 !important;
      border-color: #1D1D1D !important;
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

  .gmail_dark .nf-body, [data-darkmode="true"] .nf-body, [data-ogsb] .nf-body {
    background-color: #0C0C0C !important;
  }
  .gmail_dark .nf-card, [data-darkmode="true"] .nf-card, [data-ogsb] .nf-card {
    background-color: #161618 !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-callout, [data-darkmode="true"] .nf-callout, [data-ogsb] .nf-callout {
    background-color: #0F0F10 !important;
    border-color: #1D1D1D !important;
  }
  .gmail_dark .nf-cta, [data-darkmode="true"] .nf-cta, [data-ogsc] .nf-cta {
    background-color: #fefefe !important;
    color: #0C0C0C !important;
    border-color: #fefefe !important;
  }
`;

function JourneyLayout({
  preview,
  eyebrow,
  heading,
  children,
  ctaLabel,
  ctaUrl
}: {
  preview: string;
  eyebrow: string;
  heading: string;
  children: React.ReactNode;
  ctaLabel: string;
  ctaUrl: string;
}) {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>{preview}</Preview>}
      additionalHeadContent={<style>{journeyStyles}</style>}
    >
      <Body className={`my-auto mx-auto font-sans nf-body ${themeClasses.body}`}>
        <Container
          className={`my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] nf-card ${themeClasses.container}`}
          style={{ borderRadius: 16, borderStyle: "solid", borderWidth: 1 }}
        >
          <Logo />

          <Text
            className={`text-[11px] leading-[16px] uppercase text-center font-medium m-0 mt-[40px] mb-[10px] nf-eyebrow ${themeClasses.mutedText}`}
            style={{ letterSpacing: "0.14em" }}
          >
            {eyebrow}
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {heading}
          </Heading>

          {children}

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
        </Container>
      </Body>
    </EmailThemeProvider>
  );
}

function BodyText({ children }: { children: React.ReactNode }) {
  const themeClasses = getEmailThemeClasses();
  return (
    <Text className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}>
      {children}
    </Text>
  );
}

// --------------------------------------------------------------------------
// Day-3 / day-10 streak trophies (day 5 celebrates in-app only).
// --------------------------------------------------------------------------

interface StreakMilestoneEmailProps {
  recipientName?: string;
  companyName: string;
  milestone: number; // 3 | 10
  daysOnCarbon: number;
  hubUrl: string;
}

export const StreakMilestoneEmail = ({
  recipientName = "there",
  companyName = "your factory",
  milestone = 3,
  daysOnCarbon = 3,
  hubUrl = "https://app.carbon.ms/x/get-started/live"
}: StreakMilestoneEmailProps) => {
  const activated = milestone >= 10;
  return (
    <JourneyLayout
      preview={
        activated
          ? `${companyName} is activated on Carbon`
          : `Day ${milestone} on Carbon — the streak is real`
      }
      eyebrow="Live on Carbon"
      heading={
        activated
          ? `🏆 Ten straight days — ${companyName} runs on Carbon`
          : `🏆 Day ${milestone} — the streak is real`
      }
      ctaLabel="See the scoreboard"
      ctaUrl={hubUrl}
    >
      <BodyText>Hi {recipientName},</BodyText>
      {activated ? (
        <BodyText>
          Ten straight business days of real production in Carbon. That's not a
          trial anymore — that's how {companyName} runs. The whole journey is
          on the scoreboard, along with what you set aside on purpose for
          later.
        </BodyText>
      ) : (
        <BodyText>
          {companyName} has now run {milestone} straight business days in
          Carbon — {daysOnCarbon} days of real work in total. Keep it going:
          ten straight days is Activated, and you're closer than you think.
        </BodyText>
      )}
    </JourneyLayout>
  );
};

// --------------------------------------------------------------------------
// The Monday digest — two or three things for the week, one click in.
// --------------------------------------------------------------------------

interface HubDigestEmailProps {
  recipientName?: string;
  companyName: string;
  doneGates: number;
  totalGates: number;
  nextTitle: string | null;
  goLiveDate?: string;
  hubUrl: string;
}

export const HubDigestEmail = ({
  recipientName = "there",
  companyName = "your factory",
  doneGates = 0,
  totalGates = 7,
  nextTitle = "Set Up the Basics",
  goLiveDate,
  hubUrl = "https://app.carbon.ms/x/get-started"
}: HubDigestEmailProps) => {
  return (
    <JourneyLayout
      preview={`This week: ${nextTitle ?? "keep going"}`}
      eyebrow="Your week on Carbon"
      heading={`${companyName}: phase ${Math.min(doneGates + 1, totalGates)} of ${totalGates}`}
      ctaLabel="Pick up where you left off"
      ctaUrl={hubUrl}
    >
      <BodyText>Hi {recipientName},</BodyText>
      <BodyText>
        {doneGates} of {totalGates} phases are behind you.
        {nextTitle
          ? ` This week is about one thing: ${nextTitle}.`
          : " You're at the finish line."}
        {goLiveDate ? ` The date on the wall is ${goLiveDate}.` : ""}
      </BodyText>
      <BodyText>
        A couple of focused hours moves it. The hub always shows the one next
        step — no ceremony, no catch-up reading.
      </BodyText>
    </JourneyLayout>
  );
};

// --------------------------------------------------------------------------
// Quiet detection — seven quiet days; names the actual next step and its cost.
// --------------------------------------------------------------------------

interface HubNudgeEmailProps {
  recipientName?: string;
  companyName: string;
  nextTitle: string | null;
  quietDays: number;
  hubUrl: string;
}

export const HubNudgeEmail = ({
  recipientName = "there",
  companyName = "your factory",
  nextTitle = "Set Up the Basics",
  quietDays = 7,
  hubUrl = "https://app.carbon.ms/x/get-started"
}: HubNudgeEmailProps) => {
  return (
    <JourneyLayout
      preview={`${nextTitle ?? "Your plan"} is waiting — it's closer than you think`}
      eyebrow="Implementation Hub"
      heading={`${nextTitle ?? "Your plan"} is waiting`}
      ctaLabel="Pick it back up"
      ctaUrl={hubUrl}
    >
      <BodyText>Hi {recipientName},</BodyText>
      <BodyText>
        It's been {quietDays} days since anything moved on {companyName}'s
        Carbon plan — that's normal, factories are busy. The next step is
        {nextTitle ? ` ${nextTitle}` : " small"}, and it's a shorter sitting
        than it looks. Twenty focused minutes usually restarts the whole thing.
      </BodyText>
    </JourneyLayout>
  );
};
