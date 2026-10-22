// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Body,
  Container,
  Heading,
  Link,
  Preview,
  Section,
  Text
} from "react-email";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses
} from "../components/Theme";

/**
 * The emails Auth (GoTrue) sends — sign-in, invite, confirmation, password
 * reset, email change, reauthentication — in Carbon's email design.
 *
 * Auth fills these in itself: the ERP serves them rendered with Auth's Go
 * template placeholders left as text ({{ .Token }}, {{ .SiteURL }}…), and
 * Auth downloads them when it sends mail (routes/templates.$file.ts). Each
 * placeholder is one string literal: a JSX expression beside other text
 * would put React's comment markers inside it.
 */
export const AUTH_TOKEN = "{{ .Token }}";

type AuthEmailProps = {
  preview: string;
  heading: string;
  intro: string;
  /** The 6-digit code, when this email has one. */
  showCode?: boolean;
  /** The link, when this email has one. */
  action?: { href: string; label: string };
  footnote?: string;
};

export function AuthEmail({
  preview,
  heading,
  intro,
  showCode = false,
  action,
  footnote
}: AuthEmailProps) {
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");
  const text = { color: lightStyles.text.color };
  const muted = { color: lightStyles.mutedText.color };

  return (
    <EmailThemeProvider preview={<Preview>{preview}</Preview>}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <Container
          className={`my-[40px] mx-auto p-[20px] max-w-[600px] text-center ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: lightStyles.container.borderColor
          }}
        >
          <Logo />
          <Heading
            className={`text-[21px] font-normal text-center p-0 my-[30px] mx-0 ${themeClasses.text}`}
            style={text}
          >
            {heading}
          </Heading>

          <Text className={`text-center ${themeClasses.text}`} style={text}>
            {intro}
          </Text>

          {showCode ? (
            <Section className="text-center my-[32px]">
              <div
                className="email-panel"
                style={{
                  display: "inline-block",
                  padding: "20px 40px",
                  backgroundColor: "#f8f9fa",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef"
                }}
              >
                <Text
                  className="text-center font-mono email-panel-text"
                  style={{
                    fontSize: "32px",
                    fontWeight: "bold",
                    letterSpacing: "8px",
                    color: "#333",
                    margin: 0
                  }}
                >
                  {AUTH_TOKEN}
                </Text>
              </div>
            </Section>
          ) : null}

          {action ? (
            <>
              {showCode ? (
                <Text
                  className={`text-center ${themeClasses.mutedText}`}
                  style={muted}
                >
                  Or use the button:
                </Text>
              ) : null}
              <Section className="mb-[32px] mt-[16px] text-center">
                <Button href={action.href}>{action.label}</Button>
              </Section>
              <Text
                className={`text-[14px] leading-[24px] break-all ${themeClasses.mutedText}`}
                style={muted}
              >
                If the button doesn't work, copy this link into your browser:{" "}
                <Link
                  href={action.href}
                  className={`${themeClasses.mutedText} underline`}
                  style={muted}
                >
                  {action.href}
                </Link>
              </Text>
            </>
          ) : null}

          {footnote ? (
            <Text
              className={`text-center text-sm mt-[32px] ${themeClasses.mutedText}`}
              style={{ ...muted, fontSize: "14px" }}
            >
              {footnote}
            </Text>
          ) : null}
        </Container>
      </Body>
    </EmailThemeProvider>
  );
}
