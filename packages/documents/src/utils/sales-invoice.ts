import type { Database } from "@carbon/database";

export function getLineDescription(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  switch (line?.invoiceLineType) {
    case "Fixed Asset":
      return line?.assetId;
    case "Comment":
      return line?.description;
    default:
      return line?.itemReadableId;
  }
}

export function getLineDescriptionDetails(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  switch (line?.invoiceLineType) {
    case "Fixed Asset":
      return line?.description;
    case "Comment":
    default:
      return line?.description ?? "";
  }
}

export function getLineSubtotal(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  if (line?.quantity && line?.convertedUnitPrice) {
    return (
      line.quantity * line.convertedUnitPrice +
      (line.convertedAddOnCost ?? 0) +
      (line.convertedShippingCost ?? 0)
    );
  }
  return 0;
}

export function getLineTaxesAndFees(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineSubtotal(line) * taxPercent;
  const fees =
    (line.convertedAddOnCost ?? 0) + (line.convertedShippingCost ?? 0);
  return tax + fees;
}

export function getLineTotal(
  line: Database["public"]["Views"]["salesInvoiceLines"]["Row"]
) {
  const taxPercent = line.taxPercent ?? 0;
  const tax = getLineSubtotal(line) * taxPercent;
  return getLineSubtotal(line) + tax;
}

export function getTotal(
  lines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][],
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"],
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"]
) {
  let total = 0;

  lines.forEach((line) => {
    total += getLineTotal(line);
  });

  return (
    total +
    (salesInvoiceShipment.shippingCost ?? 0) * (salesInvoice.exchangeRate ?? 1)
  );
}
