import {
  Body,
  Container,
  Heading,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Logo } from "./components/Logo";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface Props {
  email?: string;
  verificationCode?: string;
}

export const VerificationEmail = ({
  email = "user@example.com",
  verificationCode = "123456",
}: Props) => {
  const text = `Your verification code is ${verificationCode}`;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider preview={<Preview>{text}</Preview>}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <Container
          className={`my-[40px] mx-auto p-[20px] max-w-[600px] text-center ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: lightStyles.container.borderColor,
          }}
        >
          <Logo />
          <Heading
            className={`text-[21px] font-normal text-center p-0 my-[30px] mx-0 ${themeClasses.heading}`}
            style={{ color: lightStyles.text.color }}
          >
            Verify your email address
          </Heading>

          <Text
            className={`text-center ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            We've sent this verification code to{" "}
            <span className="font-medium">{email}</span>
          </Text>

          <Section className="text-center my-[40px]">
            <div
              style={{
                display: "inline-block",
                padding: "20px 40px",
                backgroundColor: "#f8f9fa",
                borderRadius: "8px",
                border: "1px solid #e9ecef",
              }}
            >
              <Text
                className="text-center font-mono"
                style={{
                  fontSize: "32px",
                  fontWeight: "bold",
                  letterSpacing: "8px",
                  color: "#333",
                  margin: 0,
                }}
              >
                {verificationCode}
              </Text>
            </div>
          </Section>

          <Text
            className={`text-center ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            This code will expire in 10 minutes. If you didn't request this
            verification code, please ignore this email.
          </Text>

          <Text
            className={`text-center text-sm mt-[40px] ${themeClasses.text}`}
            style={{
              color: lightStyles.text.color,
              fontSize: "14px",
              opacity: 0.7,
            }}
          >
            If you're having trouble, you can reply to this email or contact us
            at support@carbon.ms
          </Text>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default VerificationEmail;
