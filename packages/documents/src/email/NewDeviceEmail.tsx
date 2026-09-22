import {
  Body,
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
  signedInAt: string;
  ipAddress: string | null;
  location: string | null;
  browser: string | null;
  securityUrl: string;
}

export const NewDeviceEmail = ({
  recipientName = "there",
  signedInAt,
  ipAddress,
  location,
  browser,
  securityUrl
}: Props) => {
  const themeClasses = getEmailThemeClasses();

  const details: [string, string][] = [
    ["Time", signedInAt],
    ["IP address", ipAddress ?? "Unknown"],
    ["Location", location ?? "Unknown"],
    ["Browser", browser ?? "Unknown"]
  ];

  return (
    <EmailThemeProvider
      preview={<Preview>We've noticed a new login to your account</Preview>}
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

          <Heading
            className={`text-[26px] font-medium tracking-tight p-0 mt-[40px] mb-[24px] mx-0 ${themeClasses.heading}`}
          >
            We've noticed a new login
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              Hi {recipientName},
            </Text>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
            >
              This is a routine security alert. Someone signed in to your Carbon
              account from a new device:
            </Text>
          </Section>

          <Section className="mb-[16px]">
            {details.map(([label, value]) => (
              <Text
                key={label}
                className={`text-[15px] leading-[26px] m-0 ${themeClasses.text}`}
              >
                <strong>{label}:</strong> {value}
              </Text>
            ))}
          </Section>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[32px] ${themeClasses.text}`}
            >
              If this was you, you can ignore this alert. If you don't recognize
              this sign-in,{" "}
              <Link href={securityUrl} className="underline">
                sign that device out
              </Link>{" "}
              and review your passkeys and two-factor settings on your{" "}
              <Link href={securityUrl} className="underline">
                account security page
              </Link>
              .
            </Text>
          </Section>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 ${themeClasses.text}`}
            >
              Stay safe,
            </Text>
            <Text
              className={`text-[15px] leading-[26px] m-0 font-medium ${themeClasses.text}`}
            >
              The Carbon Team
            </Text>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default NewDeviceEmail;
