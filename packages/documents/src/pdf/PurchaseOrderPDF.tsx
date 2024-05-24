import type { Database } from "@carbon/database";
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal,
} from "../utils/purchase-order";
import { formatAddress } from "../utils/shared";
import { Header, Summary, Template } from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
}

// TODO: format currency based on settings
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const PurchaseOrderPDF = ({
  company,
  meta,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  title = "Purchase Order",
}: PurchaseOrderPDFProps) => {
  const {
    supplierName,
    supplierAddressLine1,
    supplierAddressLine2,
    supplierCity,
    supplierState,
    supplierPostalCode,
    supplierCountryCode,
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryState,
    deliveryPostalCode,
    deliveryCountryCode,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerState,
    customerPostalCode,
    customerCountryCode,
  } = purchaseOrderLocations;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
        keywords: meta?.keywords ?? "purchase order",
        subject: meta?.subject ?? "Purchase Order",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Date",
              value: purchaseOrder?.orderDate,
            },
            {
              label: "PO #",
              value: purchaseOrder?.purchaseOrderId,
            },
          ]}
        />
        <View style={styles.row}>
          <View style={styles.colThird}>
            <Text style={styles.label}>Supplier</Text>
            <Text>{supplierName}</Text>
            {supplierAddressLine1 && <Text>{supplierAddressLine1}</Text>}
            {supplierAddressLine2 && <Text>{supplierAddressLine2}</Text>}
            <Text>
              {formatAddress(supplierCity, supplierState, supplierPostalCode)}
            </Text>
            <Text>{supplierCountryCode}</Text>
          </View>
          {dropShipment ? (
            <View style={styles.colThird}>
              <Text style={styles.label}>Ship To</Text>
              <Text>{customerName}</Text>
              {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
              {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
              <Text>
                {formatAddress(customerCity, customerState, customerPostalCode)}
              </Text>
              <Text>{customerCountryCode}</Text>
            </View>
          ) : (
            <View style={styles.colThird}>
              <Text style={styles.label}>Ship To</Text>
              <Text>{deliveryName}</Text>
              {deliveryAddressLine1 && <Text>{deliveryAddressLine1}</Text>}
              {deliveryAddressLine2 && <Text>{deliveryAddressLine2}</Text>}
              <Text>
                {formatAddress(deliveryCity, deliveryState, deliveryPostalCode)}
              </Text>
              <Text>{deliveryCountryCode}</Text>
            </View>
          )}
        </View>
        <View style={styles.row}>
          <View style={styles.colThird}>
            <Text style={styles.label}>Supplier Order #</Text>
            <Text>{purchaseOrder?.supplierReference}</Text>
          </View>
          <View style={styles.colThird}>
            <Text style={styles.label}>Requested Date</Text>
            <Text>{purchaseOrder?.receiptRequestedDate}</Text>
          </View>
          <View style={styles.colThird}>
            <Text style={styles.label}>Promised Date</Text>
            <Text>{purchaseOrder?.receiptPromisedDate}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.colThird}>
            <Text style={styles.label}>Shipping Method</Text>
            <Text>{purchaseOrder?.shippingMethodName}</Text>
          </View>
          <View style={styles.colThird}>
            <Text style={styles.label}>Shipping Terms</Text>
            <Text>{purchaseOrder?.shippingTermName}</Text>
          </View>
          <View style={styles.colThird}>
            <Text style={styles.label}>Payment Terms</Text>
            <Text>{purchaseOrder?.paymentTermName}</Text>
          </View>
        </View>
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={styles.tableCol1}>Description</Text>
            <Text style={styles.tableCol2}>Qty</Text>
            <Text style={styles.tableCol3}>Price</Text>
            <Text style={styles.tableCol4}>Total</Text>
          </View>
          {purchaseOrderLines.map((line) => (
            <View style={styles.tr} key={line.id}>
              <View style={styles.tableCol1}>
                <Text style={{ ...styles.bold, marginBottom: 4 }}>
                  {getLineDescription(line)}
                </Text>
                <Text style={{ fontSize: 9, opacity: 0.8 }}>
                  {getLineDescriptionDetails(line)}
                </Text>
              </View>
              <Text style={styles.tableCol2}>
                {line.purchaseOrderLineType === "Comment"
                  ? ""
                  : `${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode}`}
              </Text>
              <Text style={styles.tableCol3}>
                {line.purchaseOrderLineType === "Comment"
                  ? null
                  : formatter.format(line.unitPrice ?? 0)}
              </Text>
              <Text style={styles.tableCol4}>
                {line.purchaseOrderLineType === "Comment"
                  ? null
                  : formatter.format(getLineTotal(line))}
              </Text>
            </View>
          ))}
          <View style={styles.tfoot}>
            <Text>Total</Text>
            <Text style={styles.bold}>
              {formatter.format(getTotal(purchaseOrderLines))}
            </Text>
          </View>
        </View>
        {purchaseOrder?.notes && (
          <View style={styles.row}>
            <View style={styles.colHalf}>
              <Text style={styles.label}>Notes</Text>
              <Text>{purchaseOrder?.notes}</Text>
            </View>
          </View>
        )}
      </View>
    </Template>
  );
};

export default PurchaseOrderPDF;

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
