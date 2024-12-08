import {
  Body,
  Button,
  Container,
  Font,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { Logo } from "./components/Logo";

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
  email = "huckleberry@sawyer.com",
  companyName = "Tombstone",
  inviteLink = "https://carbonos.dev/invite/1234567890",
  ip = "38.38.38.38",
  location = "Tombstone, AZ",
}: Props) => {
  return (
    <Html>
      <Tailwind>
        <head>
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-400-normal.woff2",
              format: "woff2",
            }}
            fontWeight={400}
            fontStyle="normal"
          />

          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-500-normal.woff2",
              format: "woff2",
            }}
            fontWeight={500}
            fontStyle="normal"
          />
        </head>
        <Preview>{`Join ${companyName} on CarbonOS`}</Preview>

        <Body className="bg-[#fff] my-auto mx-auto font-sans">
          <Container
            className="border-transparent md:border-[#E8E7E1] my-[40px] mx-auto p-[20px] max-w-[600px]"
            style={{ borderStyle: "solid", borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-[24px] font-normal text-[#121212] text-center">
              Join <strong>{companyName}</strong> on <strong>CarbonOS</strong>
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {invitedByName} (
              <Link
                href={`mailto:${invitedByEmail}`}
                className="text-[#121212] no-underline"
              >
                {invitedByEmail}
              </Link>
              ) has invited you to join <strong>{companyName}</strong> on{" "}
              <strong>CarbonOS</strong>.
            </Text>
            <Section className="mb-[42px] mt-[32px] text-center">
              <Button
                className="bg-black text-foreground text-[14px] text-white font-medium no-underline text-center px-6 py-3 border border-solid border-[#121212] rounded-lg"
                href={inviteLink}
              >
                Accept Invite
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#707070] break-all">
              You can accept this invite by clicking the button above or by
              copying and pasting the following link into your browser:{" "}
              <Link href={inviteLink} className="text-[#707070] underline">
                {inviteLink}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                This invitation was intended for{" "}
                <span className="text-[#121212] ">{email}</span>. This invite
                was sent from <span className="text-[#121212] ">{ip}</span>{" "}
                located in <span className="text-[#121212] ">{location}</span>.{" "}
                If you were not expecting this invitation, you can ignore this
                email. If you are concerned about your account's safety, please
                reply to this email to get in touch with us.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default InviteEmail;
