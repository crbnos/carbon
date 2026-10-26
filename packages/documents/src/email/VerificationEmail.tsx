// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Body,
  Container,
  Heading,
  Hr,
  Preview,
  Section,
  Text
} from "react-email";
import { Logo } from "./components/Logo";
import { notificationStyles } from "./components/notificationStyles";
import {
  EmailThemeProvider,
  getEmailThemeClasses,
  HeadStyle
} from "./components/Theme";

interface Props {
  email?: string;
  verificationCode?: string;
}

// The email-verification code (packages/auth verification.server.ts). It
// has no link to follow, so no button: the code is the whole message.
export const VerificationEmail = ({
  email = "user@example.com",
  verificationCode = "123456"
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={
        <Preview>{`Your verification code is ${verificationCode}`}</Preview>
      }
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
            Security
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            Verify your email address
          </Heading>

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
                    Here is the verification code for {email}.
                  </Text>
                  <Text
                    className={`text-[32px] leading-[40px] font-mono font-medium text-center m-0 mt-[16px] ${themeClasses.heading}`}
                    style={{ letterSpacing: "0.3em" }}
                  >
                    {verificationCode}
                  </Text>
                </td>
              </tr>
            </table>
          </Section>

          <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />
          <Text
            className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
          >
            This code expires in 10 minutes. If you didn't ask for it, you can
            ignore this email. Having trouble? Reply to this email or contact
            support@carbon.ms.
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default VerificationEmail;
