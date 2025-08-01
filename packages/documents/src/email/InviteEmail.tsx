import {
  Body,
  Container,
  Heading,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Logo } from "./components/Logo";
import {
  Button,
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface Props {
  email?: string;
  invitedByEmail?: string;
  invitedByName?: string;
  companyName?: string;
  inviteLink?: string;
  ip?: string;
  location?: string;
}

export const InviteEmail = ({
  invitedByEmail = "tom@sawyer.com",
  invitedByName = "Tom Sawyer",
  email = "huck@sawyer.com",
  companyName = "Tombstone",
  inviteLink = "https://carbon.ms/invite/1234567890",
  ip = "38.38.38.38",
  location = "Tombstone, AZ",
}: Props) => {
  const preview = <Preview>{`Join ${companyName} on Carbon`}</Preview>;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider preview={preview}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <Container
          className={`my-[40px] mx-auto p-[20px] max-w-[600px] ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: lightStyles.container.borderColor,
          }}
        >
          <Logo />
          <Heading
            className={`mx-0 my-[30px] p-0 text-[24px] font-normal ${themeClasses.text} text-center`}
            style={{ color: lightStyles.text.color }}
          >
            Join <strong>{companyName}</strong> on <strong>Carbon</strong>
          </Heading>

          <Text
            className={`text-[14px] leading-[24px] ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            {invitedByName} (
            <Link
              href={`mailto:${invitedByEmail}`}
              className={`${themeClasses.text} no-underline`}
              style={{ color: lightStyles.text.color }}
            >
              {invitedByEmail}
            </Link>
            ) has invited you to join <strong>{companyName}</strong> on{" "}
            <strong>Carbon</strong>.
          </Text>
          <Section className="mb-[42px] mt-[32px] text-center">
            <Button href={inviteLink}>Accept Invite</Button>
          </Section>

          <Text
            className={`text-[14px] leading-[24px] ${themeClasses.mutedText} break-all`}
            style={{ color: lightStyles.mutedText.color }}
          >
            You can accept this invite by clicking the button above or by
            copying and pasting the following link into your browser:{" "}
            <Link
              href={inviteLink}
              className={`${themeClasses.mutedText} underline`}
              style={{ color: lightStyles.mutedText.color }}
            >
              {inviteLink}
            </Link>
          </Text>

          <br />
          <Section>
            <Text
              className={`text-[12px] leading-[24px] ${themeClasses.mutedText}`}
              style={{ color: lightStyles.mutedText.color }}
            >
              This invitation was intended for{" "}
              <span
                className={themeClasses.text}
                style={{ color: lightStyles.text.color }}
              >
                {email}
              </span>
              . This invite was sent from{" "}
              <span
                className={themeClasses.text}
                style={{ color: lightStyles.text.color }}
              >
                {ip}
              </span>{" "}
              located in{" "}
              <span
                className={themeClasses.text}
                style={{ color: lightStyles.text.color }}
              >
                {location}
              </span>
              . If you were not expecting this invitation, you can ignore this
              email. If you are concerned about your account's safety, please
              reply to this email to get in touch with us.
            </Text>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default InviteEmail;
