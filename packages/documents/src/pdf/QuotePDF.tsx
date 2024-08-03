import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { generateHTML } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getTotal,
} from "../utils/quote";
import { formatAddress } from "../utils/shared";
import { Header, Summary, Template } from "./components";

interface QuotePDFProps extends PDF {
  quote: Database["public"]["Views"]["quotes"]["Row"];
  quoteLines: Database["public"]["Views"]["quoteLines"]["Row"][];
  quoteCustomerDetails: Database["public"]["Views"]["quoteCustomerDetails"]["Row"];
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
          items={[
            {
              label: "Quote Date",
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
          ]}
        />
        <View style={styles.row}>
          <View style={styles.colThird}>
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
            <Text style={styles.tableCol1}>Description</Text>
            <Text style={styles.tableCol2}>Qty</Text>
            <Text style={styles.tableCol3}>Price</Text>
            <Text style={styles.tableCol3}>Lead Time</Text>
            <Text style={styles.tableCol4}>Total</Text>
          </View>
          {quoteLines.map((line) => (
            <View style={styles.tr} key={line.id}>
              <View style={styles.tableCol1}>
                <Text style={{ ...styles.bold, marginBottom: 4 }}>
                  {getLineDescription(line)}
                </Text>
                <Text style={{ fontSize: 9, opacity: 0.8 }}>
                  {getLineDescriptionDetails(line)}
                </Text>
              </View>
              {/* <Text style={styles.tableCol2}>{line.pricingQuantity}</Text>
              <Text style={styles.tableCol3}>
                <Text>
                  {line.pricingQuantity
                    ? formatter.format(
                        (line.pricingExtendedPrice ?? 0) / line.pricingQuantity
                      )
                    : formatter.format(0)}
                </Text>
              </Text>
              <Text style={styles.tableCol3}>
                <Text>{line.pricingLeadTime ?? 0}</Text>
              </Text>
              <Text style={styles.tableCol4}>
                <Text>{formatter.format(line.pricingExtendedPrice ?? 0)}</Text>
              </Text> */}
            </View>
          ))}
          <View style={styles.tfoot}>
            <Text>Total</Text>
            <Text style={styles.bold}>
              <Text>{formatter.format(getTotal(quoteLines))}</Text>
            </Text>
          </View>
        </View>
        {quote?.notes && (
          <View style={styles.row}>
            <View style={styles.colHalf}>
              <Text style={styles.label}>Notes</Text>
              <Text>
                {generateHTML((quote?.notes ?? {}) as JSONContent, [])}
              </Text>
            </View>
          </View>
        )}
      </View>
    </Template>
  );
};

export default QuotePDF;

const styles = StyleSheet.create({
  row: {
    display: "flex",
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    width: "100%",
  },
  colFull: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    fontSize: 11,
    fontWeight: 500,
    width: "100%",
  },
  colHalf: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    fontSize: 11,
    fontWeight: 500,
    width: "50%",
  },
  colThird: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    fontSize: 11,
    fontWeight: 500,
    width: "32%",
  },
  label: {
    color: "#7d7d7d",
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
    width: "15%",
    textAlign: "right",
  },
  tableCol3: {
    width: "15%",
    textAlign: "right",
  },
  tableCol4: {
    width: "20%",
    textAlign: "right",
  },
});
