import { tool } from "../lib/tool.ts";
import z from "npm:zod@^3.24.1";


export const prompt = {
  name: "carbon-purchasing-prompt",
  description: "Instructions for using the Carbon Purchasing MCP effectively",
  instructions: `
This server provides access to Carbon, an ERP for manufacturing. Use it to effectively complete the tasks of a purchasing and procurement department.

When handling purchase order requests:
1. First identify the part details (including quantities and measurements)
2. Use getPart to look up the part ID
3. If no supplier is explicitly specified in the prompt:
   - Use suggestSupplierForParts to get recommended suppliers
   - Ask the user to confirm which supplier they want to use
4. Only proceed with createPurchaseOrder when both part and supplier are confirmed
5. If there are multiple options for a part or supplier, ask the user to confirm which one they want to use
6. If there are no options, ask the user for clarification

For example:
- If user says "create a purchase order for 5lb of 1/4" steel":
  1. First look up the part ID for "1/4" steel"
  2. Then ask user to specify a supplier, potentially offering suggestions
  3. Only create the PO once supplier is confirmed

- If user says "create a purchase order for 5lb of 1/4" steel from MetalCorp":
  1. Look up part ID for "1/4" steel"
  2. Look up supplier ID for "MetalCorp"
  3. Create the PO with both IDs

Key capabilities:
- Create and update purchase orders
- Search for suppliers and parts
- Suggest suppliers for parts
- Search for existing purchase orders
- Search for open purchase orders
- Search for purchase order history


Tools:
- getPart
  - Search for a part by readable id or description
  - Returns an id that can be used to create a purchase order
- getSupplier
  - Search for suppliers by a specific name from the prompt, a deduced description, or a list of part ids
  - Returns an id that can be used to create a purchase order
- suggestSupplierForParts
  - Suggest a list of suppliers for a given list of parts
- createPurchaseOrder
  - Create a purchase order with multiple parts
`
};

const createPurchaseOrder = tool({
  name: "createPurchaseOrder",
  description: "Create a purchase order",
  args: z.object({
    supplierId: z.string(),
    parts: z.array(z.object({
      partId: z.string(),
      quantity: z.number().positive().default(1),
      unitPrice: z.number().optional(),
    })),
  }),
  async run(client, args, context) {
    console.log('createPurchaseOrder', args);
    console.log('context', context);
    return '91011'
  },
});

const getPart = tool({
  name: "getPart",
  description: "Search for a part by description or readable id",
  args: z.object({
    readableId: z.string().optional(),
    description: z.string().optional(),
  }).refine((data) => data.readableId || data.description, {
    message: "Either readableId or description must be provided",
  }),
  async run(client, args, context) {
    console.log('getPart', args);
    console.log('context', context);
    return args.readableId || (args.description + '-1234')
  },
});

const getSupplier = tool({
  name: "getSupplier",
  description: "Search for suppliers by a specific name as specified by the user, a deduced description, or a list of part ids",
  args: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    partIds: z.array(z.string()).optional(),
  }).refine((data) => data.name || data.description || data.partIds, {
    message: "Either name, description, or partIds must be provided",
  }),
  async run(client, args, context) {
    console.log('getSupplier', args);
    console.log('context', context);
    return '932093'
  },
});


const suggestSupplierForParts = tool({
  name: "suggestSupplierForParts",
  description: "Suggest a list of suppliers for a given list of parts",
  args: z.object({
    partIds: z.array(z.string()),
  }),
  async run(client, args, context) {
    console.log('suggestSupplierForParts', args);
    console.log('context', context);
    return [
      {
        id: "932093",
        name: "MetalCorp",
        description: "A supplier of metal parts",
      },
      {
        id: "932094",
        name: "SteelCo",
        description: "A supplier of steel parts",
      },
    ]
  },
});



export const tools = [createPurchaseOrder, getPart, getSupplier, suggestSupplierForParts];
