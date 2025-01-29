import type { Database } from "@carbon/database";
import {
  Body,
  Column,
  Container,
  Font,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { CompanySettings, Email } from "../types";

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
  const reSubject = `Re: ${quote.quoteId} from ${company.name}`;
  const digitalQuoteUrl =
    companySettings.digitalQuoteEnabled && !!quote.externalLinkId
      ? `https://app.carbonos.dev/share/quote/${quote.externalLinkId}` // the VERCEL_URL variable was giving us a preview branch
      : undefined;

  return (
    <Html lang="en">
      <Preview>{`${quote.quoteId} from ${company.name}`}</Preview>

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
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            webFont={{
              url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-800-normal.woff2",
              format: "woff2",
            }}
            fontWeight={800}
            fontStyle="normal"
          />
        </head>
        <Body className="bg-white font-sans">
          <Container className="mx-auto my-[20px] w-[660px] max-w-full">
            <Section>
              <Row>
                <Column>
                  {company.logoLight ? (
                    <Img
                      src={company.logoLight}
                      width="auto"
                      height="42"
                      alt={`${company.name} Logo`}
                    />
                  ) : (
                    <Text className="text-[32px] font-bold text-gray-900">
                      {company.name}
                    </Text>
                  )}
                </Column>

                <Column className="text-right">
                  <Text className="text-[32px] font-light text-gray-500">
                    Quote
                  </Text>
                </Column>
              </Row>
            </Section>
            <Section>
              {digitalQuoteUrl ? (
                <>
                  <Text className="mt-9 mb-4 text-left text-sm font-medium text-gray-900">
                    {recipient.firstName
                      ? `Hi ${recipient.firstName}, `
                      : "Hi, "}
                    we are pleased to provide you with your digital quote, which
                    is available for review here:
                  </Text>
                  <Link href={digitalQuoteUrl}>
                    <Text className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white shadow hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2">
                      View Digital Quote
                    </Text>
                  </Link>
                </>
              ) : (
                <Text className="mt-9 mb-10 text-left text-sm font-medium text-gray-900">
                  {recipient.firstName ? `Hi ${recipient.firstName}, ` : "Hi, "}
                  please see the attached quote and let me know if you have any
                  questions.
                </Text>
              )}
            </Section>
            <Section className="rounded-lg bg-gray-50 text-xs">
              <Row>
                <Column className="p-5" colSpan={2}>
                  <Section>
                    <Row>
                      <Column>
                        <Text className="text-[10px] uppercase text-gray-600">
                          Quoter
                        </Text>
                        <Link
                          className="text-blue-600 underline"
                          href={`mailto:${sender.email}?subject=${reSubject}`}
                        >
                          {`${sender.firstName} ${sender.lastName}`}
                        </Link>
                      </Column>
                    </Row>

                    <Row>
                      <Column>
                        <Text className="text-[10px] uppercase text-gray-600">
                          Reference Number
                        </Text>
                        <Text>{quote.customerReference ?? "-"}</Text>
                      </Column>
                    </Row>

                    <Row>
                      <Column>
                        <Text className="text-[10px] uppercase text-gray-600">
                          Quote ID
                        </Text>
                        <Text>{quote.quoteId}</Text>
                      </Column>
                      <Column>
                        <Text className="text-[10px] uppercase text-gray-600">
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
                    <Text className="text-[32px] font-bold text-gray-900">
                      {company.name}
                    </Text>
                  )}
                </Column>
              </Row>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default QuoteEmail;
