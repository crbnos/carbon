// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { StyleSheet, Text, View } from "@react-pdf/renderer";

type SummaryProps = {
  /** The printed company name; `null` leaves it out. */
  companyName: string | null;
  /** The printed lines under the company name, in order. */
  companyLines: { key: string; text: string }[];
  items: {
    label: string;
    value?: string | null;
  }[];
};

const styles = StyleSheet.create({
  summary: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20
  },
  companyDetails: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    fontSize: 11,
    fontWeight: 500,
    width: "60%"
  },
  companyName: {
    fontSize: 13,
    letterSpacing: -0.5,
    color: "#000000",
    fontWeight: 700
  },
  documentSummary: {
    display: "flex",
    flexDirection: "column",
    rowGap: 3,
    fontSize: 11,
    fontWeight: 500,
    width: "40%"
  },
  documentSummaryItem: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-start",
    marginBottom: 5
  },
  documentSummaryLabel: {
    color: "#7d7d7d",
    fontWeight: 700,
    width: "50%"
  },
  documentSummaryValue: {
    fontWeight: 500
  }
});

const Summary = ({ companyName, companyLines, items }: SummaryProps) => {
  return (
    <View style={styles.summary}>
      <View style={styles.companyDetails}>
        {companyName !== null ? (
          <Text style={styles.companyName}>{companyName}</Text>
        ) : null}
        {companyLines.map((line) => (
          <Text key={line.key}>{line.text}</Text>
        ))}
      </View>
      <View style={styles.documentSummary}>
        {items.map((item) => (
          <View key={item.label} style={styles.documentSummaryItem}>
            <Text style={styles.documentSummaryLabel}>
              {item.label}
              {item.label === "" || item.label.endsWith(":") ? "" : ":"}
            </Text>
            <Text style={styles.documentSummaryValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export default Summary;
