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
  firstName?: string;
}

export const WelcomeEmail = ({ firstName = "Huckleberry" }: Props) => {
  const text = `Hi ${firstName}, Welcome to Carbon! I'm Brad, one of the founders. It's really important to us that you have a great experience as you get started.`;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider preview={<Preview>{text}</Preview>}>
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
            className={`text-[21px] font-normal text-center p-0 my-[30px] mx-0 ${themeClasses.heading}`}
            style={{ color: lightStyles.text.color }}
          >
            Welcome to Carbon
          </Heading>

          <br />

          <span
            className={`font-medium ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            Hi {firstName},
          </span>
          <Text
            className={themeClasses.text}
            style={{ color: lightStyles.text.color }}
          >
            Welcome to Carbon! I'm Brad, one of the founders.
            <br />
            <br />
            We built Carbon after years of building end-to-end systems for
            different types of manufacturers, learning first-hand the challenges
            and limitations of existing systems. Carbon is self-funded and built
            together with our customers, so it's important to us that you know
            we're here when you need us.
            <br />
            <br />
            Feel free to email me at{" "}
            <Link href="mailto:brad@carbon.ms">brad@carbon.ms</Link> if you have
            any questions. I'm happy to to help you get started and answer any
            questions about the things that makes your business unique.
            <br />
            <br />
            In the meantime, you can start by exploring{" "}
            <Link href="https://learn.carbon.ms">Carbon Academy</Link> to get a
            feel for the platform.
          </Text>

          <Section className="text-center mt-[50px] mb-[50px]">
            <Button href="https://learn.carbon.ms">Get started</Button>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default WelcomeEmail;
