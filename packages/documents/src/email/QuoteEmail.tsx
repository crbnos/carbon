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

      <Body style={main}>
        <Container style={container}>
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
                  <Text style={logoText}>{company.name}</Text>
                )}
              </Column>

              <Column align="right" style={tableCell}>
                <Text style={heading}>Quote</Text>
              </Column>
            </Row>
          </Section>
          <Section>
            <Text style={subtleText}>
              Hi {recipient.firstName}, please see the attached quote.
            </Text>
          </Section>
          <Section style={informationTable}>
            <Row style={informationTableRow}>
              <Column colSpan={2}>
                <Section>
                  <Row>
                    <Column style={informationTableColumn}>
                      <Text style={informationTableLabel}>Quoter</Text>
                      <Link
                        style={{
                          ...informationTableValue,
                          color: "#15c",
                          textDecoration: "underline",
                        }}
                        href={`mailto:${sender.email}?subject=${reSubject}`}
                      >
                        {`${sender.firstName} ${sender.lastName}`}
                      </Link>
                    </Column>
                  </Row>

                  <Row>
                    <Column style={informationTableColumn}>
                      <Text style={informationTableLabel}>
                        Reference Number
                      </Text>
                      <Text style={informationTableValue}>
                        {quote.customerReference ?? "-"}
                      </Text>
                    </Column>
                  </Row>

                  <Row>
                    <Column style={informationTableColumn}>
                      <Text style={informationTableLabel}>Quote ID</Text>
                      <Text style={informationTableValue}>{quote.quoteId}</Text>
                    </Column>
                    <Column style={informationTableColumn}>
                      <Text style={informationTableLabel}>Expiration Date</Text>
                      <Text style={informationTableValue}>
                        {quote.expirationDate ?? "-"}
                      </Text>
                    </Column>
                  </Row>
                </Section>
              </Column>
            </Row>
          </Section>

          <Section>
            <Row>
              <Column align="center" style={block}>
                {company.logo ? (
                  <Img
                    src={company.logo}
                    width="60"
                    height="auto"
                    alt={`${company.name} Logo`}
                  />
                ) : (
                  <Text style={logoText}>{company.name}</Text>
                )}
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default QuoteEmail;

const main = {
  fontFamily: '"Helvetica Neue",Helvetica,Arial,sans-serif',
  backgroundColor: "#ffffff",
};

const resetText = {
  margin: "0",
  padding: "0",
  lineHeight: 1.4,
};

const container = {
  margin: "0 auto",
  padding: "20px 0 48px",
  width: "660px",
  maxWidth: "100%",
};

const tableCell = { display: "table-cell" };

const logoText = {
  fontSize: "32px",
  fontWeight: "700",
  color: "#111111",
};

const heading = {
  fontSize: "32px",
  fontWeight: "300",
  color: "#888888",
};

const subtleText = {
  textAlign: "left" as const,
  margin: "36px 0 40px 0",
  fontSize: "14px",
  fontWeight: "500",
  color: "#111111",
};

const informationTable = {
  borderCollapse: "collapse" as const,
  borderSpacing: "0px",
  color: "rgb(51,51,51)",
  backgroundColor: "rgb(250,250,250)",
  borderRadius: "6px",
  fontSize: "12px",
};

const informationTableRow = {
  height: "46px",
};

const informationTableColumn = {
  paddingLeft: "20px",
  borderStyle: "solid",
  borderColor: "white",
  borderWidth: "0px 1px 1px 0px",
  height: "44px",
};

const informationTableLabel = {
  ...resetText,
  color: "rgb(102,102,102)",
  fontSize: "10px",
  textTransform: "uppercase" as const,
};

const informationTableValue = {
  fontSize: "12px",
  margin: "0",
  padding: "0",
  lineHeight: 1.4,
};

const block = { display: "block" };
