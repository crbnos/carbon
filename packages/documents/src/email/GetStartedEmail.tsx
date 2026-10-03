// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses
} from "./components/Theme";

interface Props {
  firstName?: string;
  academyUrl?: string;
}

const getStartedStyles = `
  .gs-body {
    background-color: #f5f5f7;
    background-image: linear-gradient(180deg, #f5f5f7 0%, #ececef 100%);
  }
  .gs-card {
    background-color: #ffffff;
    background-image: linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%);
    border-color: #e5e7eb !important;
  }
  .gs-divider {
    border-color: #ececef !important;
  }
  .gs-row {
    background-color: #fafafa;
    border-color: #ececef !important;
  }
  .gs-row-title {
    color: #0e0e0e !important;
  }
  .gs-row-desc {
    color: #6b7280 !important;
  }
  .gs-chevron {
    color: #9ca3af !important;
  }
  .gs-cta {
    background-color: #0e0e0e !important;
    color: #ffffff !important;
    border-color: #0e0e0e !important;
  }
`;

interface ResourceProps {
  href: string;
  title: string;
  description: string;
}

function ResourceLink({ href, title, description }: ResourceProps) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        display: "block"
      }}
    >
      <Section
        className="gs-row"
        style={{
          backgroundColor: "#fafafa",
          borderStyle: "solid",
          borderWidth: 1,
          borderColor: "#ececef",
          borderRadius: 12,
          padding: "14px 16px",
          marginBottom: 10
        }}
      >
        <table
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          role="presentation"
          style={{ width: "100%" }}
        >
          <tr>
            <td style={{ verticalAlign: "middle" }}>
              <Text
                className="gs-row-title"
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 500,
                  lineHeight: "20px",
                  color: "#0e0e0e"
                }}
              >
                {title}
              </Text>
              <Text
                className="gs-row-desc"
                style={{
                  margin: "4px 0 0 0",
                  fontSize: 13,
                  lineHeight: "18px",
                  color: "#6b7280"
                }}
              >
                {description}
              </Text>
            </td>
            <td
              align="right"
              width="20"
              style={{ verticalAlign: "middle", paddingLeft: 12 }}
            >
              <span
                className="gs-chevron"
                style={{
                  fontSize: 18,
                  color: "#9ca3af",
                  fontWeight: 400
                }}
              >
                ›
              </span>
            </td>
          </tr>
        </table>
      </Section>
    </Link>
  );
}

export const GetStartedEmail = ({
  firstName = "Huckleberry",
  academyUrl = "https://learn.carbon.ms"
}: Props) => {
  const preview = `Hi ${firstName}, here's how to get the most out of Carbon.`;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  const resources: ResourceProps[] = [
    {
      href: `${academyUrl}/course/carbon-overview/the-basics`,
      title: "The Basics",
      description: "Tables, forms, documents, and custom fields."
    },
    {
      href: `${academyUrl}/course/getting-started/setting-up-company`,
      title: "Setting up your company",
      description: "Configure Carbon for your team in minutes."
    },
    {
      href: `${academyUrl}/course/parts-materials/defining-item`,
      title: "Defining items",
      description: "Define and manage parts, materials, and assemblies."
    },
    {
      href: `${academyUrl}/course/selling/quoting-estimating`,
      title: "Quoting and estimating",
      description: "Build quotes, estimates, and convert them to orders."
    },
    {
      href: `${academyUrl}/course/manufacturing/managing-production`,
      title: "Managing production",
      description: "Run jobs end-to-end, from creation to completion."
    },
    {
      href: `${academyUrl}/course/buying/purchasing-basics`,
      title: "Purchasing basics",
      description: "Manage purchase orders through to receipt."
    },
    {
      href: `${academyUrl}/course/developing/using-api`,
      title: "Using the API",
      description: "Build custom apps on top of Carbon."
    }
  ];

  return (
    <EmailThemeProvider
      preview={<Preview>{preview}</Preview>}
      additionalHeadContent={<style>{getStartedStyles}</style>}
      disableDarkMode
    >
      <Body
        className={`my-auto mx-auto font-sans gs-body ${themeClasses.body}`}
        style={{
          backgroundColor: "#f5f5f7",
          backgroundImage: "linear-gradient(180deg, #f5f5f7 0%, #ececef 100%)"
        }}
      >
        <Container
          className={`my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] gs-card ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 16,
            backgroundColor: "#ffffff",
            backgroundImage: "linear-gradient(180deg, #ffffff 0%, #fbfbfc 100%)"
          }}
        >
          <Logo />

          <Heading
            className={`text-[24px] font-normal text-center tracking-tight p-0 mt-[40px] mb-[32px] mx-0 ${themeClasses.heading}`}
            style={{ color: lightStyles.text.color }}
          >
            Get the most out of Carbon
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[24px] ${themeClasses.text}`}
              style={{ color: lightStyles.text.color }}
            >
              Hi {firstName}, just checking in to help you get started. Here are
              a few things worth exploring today:
            </Text>
          </Section>

          <Section className="text-center mb-[28px]">
            <Button
              href={`${academyUrl}/course/carbon-overview/the-basics`}
              className="gs-cta"
              style={{
                backgroundColor: "#0e0e0e",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                textAlign: "center",
                padding: "12px 22px",
                borderRadius: 10,
                borderStyle: "solid",
                borderWidth: 1,
                borderColor: "#0e0e0e",
                display: "inline-block"
              }}
            >
              Start with The Basics →
            </Button>
          </Section>

          <Section>
            {resources.slice(1).map((r) => (
              <ResourceLink
                key={r.href}
                href={r.href}
                title={r.title}
                description={r.description}
              />
            ))}
          </Section>

          <Hr
            className={`my-[32px] gs-divider ${themeClasses.border}`}
            style={{ borderColor: "#ececef" }}
          />

          <Text
            className={`text-[14px] leading-[22px] m-0 mb-[8px] ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            Let us know if you have any thoughts or feedback—we'd love to hear
            from you.
          </Text>

          <Section className="mt-[20px]">
            <Text
              className={`text-[14px] m-0 mb-[2px] ${themeClasses.text}`}
              style={{ color: lightStyles.text.color }}
            >
              — The Carbon Team
            </Text>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default GetStartedEmail;
