import type { Database } from "@carbon/database";
import {
  Body,
  Column,
  Container,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { CompanySettings, Email } from "../types";
import {
  Button,
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses,
} from "./components/Theme";

interface QuoteEmailProps extends Email {
  quote: Database["public"]["Tables"]["quote"]["Row"];
  companySettings: CompanySettings;
}

const QuoteEmail = ({
  company,
  companySettings,
  quote,
  recipient,
  sender,
}: QuoteEmailProps) => {
  const digitalQuoteUrl =
    companySettings.digitalQuoteEnabled && !!quote.externalLinkId
      ? `https://app.carbon.ms/share/quote/${quote.externalLinkId}` // the VERCEL_URL variable was giving us a preview branch
      : undefined;

  const preview = <Preview>{`${quote.quoteId} from ${company.name}`}</Preview>;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider preview={preview}>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={lightStyles.body}
      >
        <Container
          className={`mx-auto py-5 px-0 w-[660px] max-w-full ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: "1px",
            borderColor: lightStyles.container.borderColor,
          }}
        >
          <Section>
            <Row>
              <Column>
                {company.logoLightIcon ? (
                  <Img
                    src={company.logoLightIcon}
                    width="auto"
                    height="42"
                    alt={`${company.name} Logo`}
                  />
                ) : (
                  <Text
                    className={`text-3xl font-bold ${themeClasses.text}`}
                    style={{ color: lightStyles.text.color }}
                  >
                    {company.name}
                  </Text>
                )}
              </Column>
              <Column className="text-right">
                <Text
                  className={`text-3xl font-light ${themeClasses.mutedText}`}
                  style={{ color: lightStyles.mutedText.color }}
                >
                  Quote
                </Text>
              </Column>
            </Row>
          </Section>
          <Section>
            {digitalQuoteUrl ? (
              <>
                <Text
                  className={`text-left text-sm font-medium ${themeClasses.text} my-9`}
                  style={{ color: lightStyles.text.color }}
                >
                  {recipient.firstName ? `Hi ${recipient.firstName}, ` : "Hi, "}
                  we are pleased to provide you with your digital quote, which
                  is available for review here:
                </Text>
                <Button href={digitalQuoteUrl} className="mb-4">
                  View Digital Quote
                </Button>
              </>
            ) : (
              <Text
                className={`text-left text-sm font-medium ${themeClasses.text} my-9`}
                style={{ color: lightStyles.text.color }}
              >
                {recipient.firstName ? `Hi ${recipient.firstName}, ` : "Hi, "}
                please see the attached quote and let me know if you have any
                questions.
              </Text>
            )}
          </Section>
          <Section className="bg-gray-50 rounded-lg text-xs">
            <Row>
              <Column className="p-5" colSpan={2}>
                <Section>
                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Reference Number
                      </Text>
                      <Text>{quote.customerReference ?? "-"}</Text>
                    </Column>
                  </Row>

                  <Row>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Quote ID
                      </Text>
                      <Text>{quote.quoteId}</Text>
                    </Column>
                    <Column>
                      <Text
                        className={`${themeClasses.mutedText} uppercase text-[10px]`}
                        style={{ color: lightStyles.mutedText.color }}
                      >
                        Expiration Date
                      </Text>
                      <Text>{quote.expirationDate ?? "-"}</Text>
                    </Column>
                  </Row>
                </Section>
              </Column>
            </Row>
          </Section>

          <Section>
            <Row>
              <Column className="text-center">
                {company.logoLightIcon ? (
                  <Img
                    src={company.logoLightIcon}
                    width="60"
                    height="auto"
                    alt={`${company.name} Logo`}
                  />
                ) : (
                  <Text
                    className={`text-3xl font-bold ${themeClasses.text}`}
                    style={{ color: lightStyles.text.color }}
                  >
                    {company.name}
                  </Text>
                )}
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default QuoteEmail;
