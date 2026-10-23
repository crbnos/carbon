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
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { notificationStyles } from "../components/notificationStyles";
import {
  EmailThemeProvider,
  getEmailThemeClasses,
  HeadStyle
} from "../components/Theme";

/**
 * The emails Auth (GoTrue) sends — sign-in, invite, confirmation, password
 * reset, email change — on Carbon's notification card.
 *
 * Auth fills these in itself: the ERP serves them rendered with Auth's Go
 * template placeholders left as text ({{ .Token }}, {{ .SiteURL }}…), and
 * Auth downloads them when it sends mail (routes/templates.$file.ts). Each
 * placeholder is one string literal: a JSX expression beside other text
 * would put React's comment markers inside it.
 *
 * No greeting: Auth knows the recipient only by email address.
 */
export const AUTH_TOKEN = "{{ .Token }}";

type AuthEmailProps = {
  preview: string;
  eyebrow: string;
  heading: string;
  /** What to do, in the callout. */
  intro: string;
  /** The 6-digit code, under the intro, when this email has one. */
  showCode?: boolean;
  action: { href: string; label: string };
  /** Why they got it, in the footer. */
  footnote?: string;
};

export function AuthEmail({
  preview,
  eyebrow,
  heading,
  intro,
  showCode = false,
  action,
  footnote
}: AuthEmailProps) {
  const themeClasses = getEmailThemeClasses();

  return (
    <EmailThemeProvider
      preview={<Preview>{preview}</Preview>}
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
            {eyebrow}
          </Text>

          <Heading
            className={`text-[26px] font-medium text-center tracking-tight p-0 mt-0 mb-[32px] mx-0 ${themeClasses.heading}`}
          >
            {heading}
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
                    {intro}
                  </Text>
                  {showCode ? (
                    <Text
                      className={`text-[32px] leading-[40px] font-mono font-medium text-center m-0 mt-[16px] ${themeClasses.heading}`}
                      style={{ letterSpacing: "0.3em" }}
                    >
                      {AUTH_TOKEN}
                    </Text>
                  ) : null}
                </td>
              </tr>
            </table>
          </Section>

          <Section className="text-center mb-[24px]">
            <Button href={action.href}>{action.label}</Button>
          </Section>

          <Text
            className={`text-[13px] leading-[20px] m-0 text-center break-all nf-fallback ${themeClasses.mutedText}`}
          >
            Button not working? Open this link in your browser:{" "}
            <Link
              href={action.href}
              className={`${themeClasses.mutedText} underline nf-fallback`}
            >
              {action.href}
            </Link>
          </Text>

          {footnote ? (
            <>
              <Hr className={`my-[32px] nf-divider ${themeClasses.border}`} />
              <Text
                className={`text-[12px] leading-[18px] m-0 nf-fallback ${themeClasses.mutedText}`}
              >
                {footnote}
              </Text>
            </>
          ) : null}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
}
