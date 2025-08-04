import {
  Body,
  Container,
  Heading,
  Preview,
  Text,
} from "@react-email/components";
import { Logo } from "./components/Logo";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface Props {
  firstName?: string;
  academyUrl?: string;
}

export const GetStartedEmail = ({
  firstName = "Huckleberry",
  academyUrl = "https://learn.carbon.ms",
}: Props) => {
  const text = `Hi ${firstName}, Just checking in to help you get started. Here are a few things you can try today.`;
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
            Get started with Carbon
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
            Just checking in to help you get started. Here are a few things you
            can learn more about today:
          </Text>
          <br />
          <ul
            className={`list-none pl-0 text-[14px] ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            <li className="mb-2">
              <Text>
                <strong>
                  <a href={`${academyUrl}/course/carbon-overview/the-basics`}>
                    The Basics
                  </a>
                </strong>{" "}
                – Learn about the essential building blocks of Carbon: tables,
                forms, documents, and custom fields.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a
                    href={`${academyUrl}/course/getting-started/setting-up-company`}
                  >
                    Setting up Your Company
                  </a>
                </strong>{" "}
                – Learn how to set up your company in Carbon.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a
                    href={`${academyUrl}/course/parts-materials/defining-item`}
                  >
                    Defining Items
                  </a>
                </strong>{" "}
                – Learn how to define and manage different types of items in
                Carbon.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a href={`${academyUrl}/course/selling/quoting-estimating`}>
                    Quoting and Estimating
                  </a>
                </strong>{" "}
                – Learn how to create quotes, estimates, and convert them to
                orders.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a
                    href={`${academyUrl}/course/manufacturing/managing-production`}
                  >
                    Managing Production
                  </a>
                </strong>{" "}
                – Learn how to manage the complete production lifecycle from job
                creation to completion.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a href={`${academyUrl}/course/buying/purchasing-basics`}>
                    Purchasing Basics
                  </a>
                </strong>{" "}
                – Learn how to manage the complete purchasing lifecycle from
                purchase order to receipt.
              </Text>
            </li>
            <li className="mb-2">
              <Text>
                <strong>
                  <a href={`${academyUrl}/course/developing/using-api`}>
                    Using the API
                  </a>
                </strong>{" "}
                – Learn how to use the Carbon API to build custom applications.
              </Text>
            </li>
          </ul>
          <br />
          <Text
            className={`text-[14px] ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            Let us know if you have any thoughts or feedback—we'd love to hear
            from you.
          </Text>
          <br />
          <Text
            className={`text-[14px] ${themeClasses.text}`}
            style={{ color: lightStyles.text.color }}
          >
            Best,
            <br />
            The Carbon Team
          </Text>

          <br />
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default GetStartedEmail;
