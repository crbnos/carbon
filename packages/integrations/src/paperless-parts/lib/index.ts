import { PaperlessPartsClient } from "./client";

export { OrderSchema } from "./schemas";
export {
  createPartFromComponent,
  findPartByExternalId,
  getCarbonOrderStatus,
  getCustomerIdAndContactId,
  getCustomerLocationIds,
  getEmployeeAndSalesPersonId,
  getOrCreatePart,
  getOrderLocationId,
  insertOrderLines,
} from "./utils";

export async function getPaperlessParts(apiKey: string) {
  const client = new PaperlessPartsClient(apiKey);
  return client;
}
