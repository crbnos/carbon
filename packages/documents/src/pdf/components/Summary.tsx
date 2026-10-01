// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Company } from "../../types";

type SummaryProps = {
  company: Company;
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

const Summary = ({ company, items }: SummaryProps) => {
  return (
    <View style={styles.summary}>
      <View style={styles.companyDetails}>
        <Text style={styles.companyName}>{company.name}</Text>
        {company.addressLine1 ? <Text>{company.addressLine1}</Text> : null}
        {company.addressLine2 ? <Text>{company.addressLine2}</Text> : null}
        {company.city ? <Text>{company.city}</Text> : null}
        {company.stateProvince || company.postalCode ? (
          <Text>
            {[company.stateProvince, company.postalCode]
              .filter(Boolean)
              .join(" ")}
          </Text>
        ) : null}
        {company.phone ? <Text>Phone: {company.phone}</Text> : null}
        {company.email ? <Text>Email: {company.email}</Text> : null}
        {company.website ? <Text>Website: {company.website}</Text> : null}
      </View>
      <View style={styles.documentSummary}>
        {items.map((item) => (
          <View key={item.label} style={styles.documentSummaryItem}>
            <Text style={styles.documentSummaryLabel}>{item.label}:</Text>
            <Text style={styles.documentSummaryValue}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

export default Summary;
