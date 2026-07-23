# Estimating & quoting

> Pull quotes and bills of material from Paperless Parts into Carbon.

## Paperless Parts

Connect with an **API key** plus a **webhook signing secret** (Paperless calls Carbon when something
changes, and the secret verifies those calls).

  
  ### Add your API key

  Provide your Paperless Parts **API key** to authenticate Carbon.
  
  
  ### Set the webhook signing secret

  Add the **webhook signing secret** — Paperless calls Carbon when something changes, and the secret verifies those calls.
  
  
  ### Set import defaults

  On connect you also set the defaults Carbon applies to items it imports: **method type**, **tracking type**, and whether to use the Paperless order number (below).
  

  - **API key**: Authenticates Carbon to Paperless Parts.
  - **Webhook signing secret**: Verifies inbound webhooks from Paperless Parts.
  - **Method type**: Default for imported items: **Purchase to Order** or **Pull from Inventory**.
  - **Tracking type**: Default for imported items: **Inventory**, **Non-Inventory**, or **Batch**.
  - **Use Paperless order number**: Whether to carry the Paperless order number onto the Carbon document.

Imported quotes and BOMs land as Carbon records, ready to turn into sales orders and jobs.

## Related

  - Quotes Where an imported estimate becomes a Carbon quote.
  - Methods & sourcing The bill of materials a Paperless import populates.
