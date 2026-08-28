import { Status } from "@carbon/react";
import type { repairOrderLineStatusType } from "../../sales.models";

type RepairOrderStatusProps = {
  status?: string | null;
};

export function RepairOrderStatus({ status }: RepairOrderStatusProps) {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Confirmed":
      return <Status color="blue">{status}</Status>;
    case "In Progress":
      return <Status color="orange">{status}</Status>;
    case "Completed":
      return <Status color="green">{status}</Status>;
    case "Cancelled":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
}

type CustodyStatusProps = {
  status?: (typeof repairOrderLineStatusType)[number] | string | null;
};

/**
 * Where the customer's unit physically is. This is the answer to "where are my
 * customers' units right now" — the tracked entity itself only knows On Hold
 * vs Consumed, which cannot tell a supplier from a customer.
 */
export function CustodyStatus({ status }: CustodyStatusProps) {
  switch (status) {
    case "Pending":
      return <Status color="gray">Awaiting arrival</Status>;
    case "Received":
      return <Status color="blue">In the shop</Status>;
    case "At Supplier":
      return <Status color="orange">At supplier</Status>;
    case "Repaired":
      return <Status color="yellow">Repaired</Status>;
    case "Shipped":
      return <Status color="green">Shipped back</Status>;
    case "Scrapped":
      return <Status color="red">Scrapped</Status>;
    default:
      return null;
  }
}

export default RepairOrderStatus;
