import type { Database } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PDF } from "../types";
import { getLineDescription, getLineDescriptionDetails } from "../utils/quote";
import { formatAddress } from "../utils/shared";
import { Header, Summary, Template } from "./components";

interface QuotePDFProps extends PDF {
  quote: Database["public"]["Views"]["quotes"]["Row"];
  quoteLines: Database["public"]["Views"]["quoteLines"]["Row"][];
  quoteCustomerDetails: Database["public"]["Views"]["quoteCustomerDetails"]["Row"];
  quoteLinePrices: Database["public"]["Tables"]["quoteLinePrice"]["Row"][];
}

// TODO: format currency based on settings
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const QuotePDF = ({
  company,
  meta,
  quote,
  quoteLines,
  quoteLinePrices,
  quoteCustomerDetails,
  title = "Quote",
}: QuotePDFProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerState,
    customerPostalCode,
    customerCountryCode,
  } = quoteCustomerDetails;

  const pricesByLine = quoteLinePrices.reduce<
    Record<string, Database["public"]["Tables"]["quoteLinePrice"]["Row"][]>
  >((acc, price) => {
    if (!acc[price.quoteLineId]) {
      acc[price.quoteLineId] = [];
    }
    acc[price.quoteLineId].push(price);
    return acc;
  }, {});

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
        keywords: meta?.keywords ?? "quote",
        subject: meta?.subject ?? "Quote",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={
            quote.expirationDate
              ? [
                  {
                    label: "Date",
                    value: today(getLocalTimeZone()).toString(),
                  },
                  {
                    label: "Expires",
                    value: quote?.expirationDate ?? "",
                  },
                  {
                    label: "Quote #",
                    value: quote?.quoteId,
                  },
                ]
              : [
                  {
                    label: "Date",
                    value: today(getLocalTimeZone()).toString(),
                  },

                  {
                    label: "Quote #",
                    value: quote?.quoteId,
                  },
                ]
          }
        />
        <View style={styles.row}>
          <View style={{ ...styles.colThird, ...styles.header }}>
            <Text style={styles.label}>Supplier</Text>
            <Text>{customerName}</Text>
            {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
            {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
            <Text>
              {formatAddress(customerCity, customerState, customerPostalCode)}
            </Text>
            <Text>{customerCountryCode}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <View style={styles.rowThird}>
              <Text style={styles.tableCol1}>Description</Text>
            </View>
            <View style={styles.rowTwoThirds}>
              <Text style={styles.tableCol2}>Qty</Text>
              <Text style={styles.tableCol3}>Unit Price</Text>
              <Text style={styles.tableCol3}>Lead Time</Text>
              <Text style={styles.tableCol4}>Extended Price</Text>
            </View>
          </View>
          {quoteLines.map((line) => (
            <View style={styles.tr} key={line.id}>
              <View style={styles.rowThird}>
                <View style={styles.tableCol1}>
                  <Text style={{ ...styles.bold, marginBottom: 4 }}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={{ fontSize: 9, opacity: 0.8 }}>
                    {getLineDescriptionDetails(line)}
                  </Text>
                </View>
              </View>
              <View style={styles.colTwoThirds}>
                {line.quantity.map((quantity) => {
                  const prices = pricesByLine[line.id] ?? [];
                  const price = prices.find(
                    (price) => price.quantity === quantity
                  );
                  const netPrice =
                    price?.unitPrice *
                    (1 - (price?.discountPercent ?? 0) / 100);

                  return (
                    <View key={quantity} style={styles.row}>
                      <Text style={styles.tableCol2}>{quantity}</Text>
                      <Text style={styles.tableCol3}>
                        {netPrice ? formatter.format(netPrice) : "-"}
                      </Text>
                      <Text style={styles.tableCol3}>
                        {price ? `${price.leadTime} days` : "-"}
                      </Text>
                      <Text style={styles.tableCol4}>
                        {netPrice ? formatter.format(netPrice * quantity) : "-"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </View>
    </Template>
  );
};

export default QuotePDF;

const styles = StyleSheet.create({
  header: {
    fontSize: 11,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    width: "100%",
  },

  rowThird: {
    display: "flex",
    flexDirection: "row",
    columnGap: 3,
    width: "33%",
  },
  rowTwoThirds: {
    display: "flex",
    flexDirection: "row",
    columnGap: 3,
    width: "66%",
  },
  colTwoThirds: {
    display: "flex",
    flexDirection: "column",
    columnGap: 3,
    width: "66%",
  },
  colThird: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    width: "32%",
  },
  label: {
    color: "#7d7d7d",
    fontWeight: 700,
  },
  bold: {
    fontWeight: 700,
    color: "#000000",
  },
  table: {
    marginBottom: 20,
    fontSize: 10,
  },
  thead: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "20px",
    padding: "6px 3px 6px 3px",
    borderTop: 1,
    borderTopColor: "#CCCCCC",
    borderTopStyle: "solid",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    fontSize: 9,
    fontWeight: 700,
    color: "#7d7d7d",
    textTransform: "uppercase",
  },

  tr: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "6px 3px 6px 3px",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    fontSize: 10,
    fontWeight: 400,
  },
  tfoot: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 3px 6px 3px",
    borderTopStyle: "solid",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    fontWeight: 700,
    color: "#7d7d7d",
    textTransform: "uppercase",
  },
  tableCol1: {
    width: "50%",
    textAlign: "left",
  },
  tableCol2: {
    width: "20%",
    textAlign: "right",
  },
  tableCol3: {
    width: "25%",
    textAlign: "right",
  },
  tableCol4: {
    width: "30%",
    textAlign: "right",
  },
});
