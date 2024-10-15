import type { Database } from "@carbon/database";
import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { Email } from "../types";

interface QuoteEmailProps extends Email {
  quote: Database["public"]["Tables"]["quote"]["Row"];
}

const QuoteEmail = ({ company, quote, recipient, sender }: QuoteEmailProps) => {
  const reSubject = `Re: ${quote.quoteId} from ${company.name}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${quote.quoteId} from ${company.name}`}</Preview>

      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto my-[20px] w-[660px] max-w-full">
            <Section>
              <Row>
                <Column>
                  {company.logo ? (
                    <Img
                      src={company.logo}
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
              <Text className="mt-9 mb-10 text-left text-sm font-medium text-gray-900">
                {recipient.firstName ? `Hi ${recipient.firstName},` : "Hi,"}
                please see the attached quote and let me know if you have any
                questions.
              </Text>
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
                  {company.logo ? (
                    <Img
                      src={company.logo}
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
