// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Body,
  Container,
  Heading,
  Hr,
  Link,
  Preview,
  Section,
  Text
} from "react-email";
import { Button } from "./components/Button";
import { Logo } from "./components/Logo";
import { notificationStyles } from "./components/notificationStyles";
import {
  EmailThemeProvider,
  emailTheme,
  getEmailThemeClasses,
  HeadStyle
} from "./components/Theme";

interface Props {
  email?: string;
  name?: string;
  invitedByEmail?: string;
  invitedByName?: string;
  companyName?: string;
  inviteLink?: string;
  ip?: string;
  location?: string;
  controlledEnvironment?: boolean;
}

// Sent when an admin invites someone to a company (user-admin job).
export const InviteEmail = ({
  invitedByEmail = "tom@sawyer.com",
  invitedByName = "Tom Sawyer",
  email = "huck@sawyer.com",
  name,
  companyName = "Tombstone",
  inviteLink = "https://carbon.ms/invite/1234567890",
  ip = "38.38.38.38",
  location = "Tombstone, AZ",
  controlledEnvironment = false
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>{`Join ${companyName} on Carbon`}</Preview>}
      additionalHeadContent={<HeadStyle css={notificationStyles} />}
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
            Invitation
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            Join {companyName} on Carbon
          </Heading>

          {name ? (
            <Section>
              <Text
                className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
              >
                Hi {name},
              </Text>
            </Section>
          ) : null}

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
                    {invitedByName} (
                    <Link
                      href={`mailto:${invitedByEmail}`}
                      className={`${themeClasses.text} no-underline`}
                      style={{ color: emailTheme.light.foreground }}
                    >
                      {invitedByEmail}
                    </Link>
                    ) has invited you to join {companyName} on Carbon.
                  </Text>
                  {controlledEnvironment ? (
                    <Text
                      className={`text-[15px] leading-[24px] m-0 mt-[12px] ${themeClasses.text}`}
                    >
                      This is an ITAR-controlled environment. Access is
                      restricted to U.S. Persons.
                    </Text>
                  ) : null}
                </td>
              </tr>
            </table>
          </Section>

          <Section className="text-center mb-[24px]">
            <Button href={inviteLink}>Accept invite</Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Button not working? Open this link in your browser:{" "}
            <Link
              href={inviteLink}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {inviteLink}
            </Link>
          </Text>

          <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />
          <Text
            className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
          >
            This invite was meant for {email} and was sent from {ip}, located in{" "}
            {location}. If you weren't expecting it, you can ignore this email.
            If you're concerned about your account's safety, contact
            support@carbon.ms.
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default InviteEmail;
