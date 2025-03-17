import { tool } from "../lib/tool.ts";
import z from "npm:zod@^3.24.1";

const getCustomerIdFromName = tool({
  name: "getCustomerIdFromName",
  description: "This function returns a customer id from a customer name",
  args: z.object({
    name: z.string(),
  }),
  async run(args) {
    console.log({ args });
    return `123943203`;
  },
});

const getSalesOrdersByCustomerId = tool({
  name: "getSalesOrdersByCustomerId",
  description: "This function returns sales orders for a customer id",
  args: z.object({
    customerId: z.string(),
  }),
  async run(args) {
    console.log({ args });
    return `[{"id": "123943203", "name": "John Doe", "status": "open"}, {"id": "123943204", "name": "Jane Doe", "status": "closed"}]`;
  },
});

export const salesTools = [getCustomerIdFromName, getSalesOrdersByCustomerId];
