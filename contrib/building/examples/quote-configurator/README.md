# Quote Configurator

This example demonstrates how to create a quote with a configurator. It requires a bit of setup in the app.

### Setup

First run Carbon locally, and make sure your company ID and API key are set in your `.env` or `.env.local` file.

```bash
npm run dev
```

1. Setup configured item with material, height, width, and length params.
2. In addition to the standard variables, we'll need to include the item id of the configured part as `CONFIGURED_ITEM_ID` in the environment.
3. You'll also have to create a customer and a contact that matches the email address you use. This example does not include upserting a customer/contact. Instead we fetch the customer by the contact email address.

```bash
cd examples/quote-configurator
npm run start
```

### Relevant Files

- `./lib/carbon.server.ts`
- `./routes/_index.tsx`
