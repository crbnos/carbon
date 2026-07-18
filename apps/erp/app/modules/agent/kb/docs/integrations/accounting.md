# Accounting

> Post invoices to Xero and keep currency exchange rates current automatically.

Two accounting integrations: **Xero** mirrors your invoices into an external ledger, and **Exchange Rates**
keeps multi-currency math honest. Exchange Rates is available on every plan; Xero is an Enterprise
(Business-plan) integration.

## Xero

Connect over **OAuth**, then choose what Carbon and Xero share. Once connected, Carbon posts **sales and
purchase invoices** to Xero and keeps the two ledgers aligned.

  
  ### Connect over OAuth

  No keys to paste. Authorizing stores the connection.
  
  
  ### Choose what's shared

  Set backfill, the per-entity source of truth, and the default account mapping (below).
  
  
  ### Run the initial sync

  A **Run Initial Sync** action kicks off the first backfill on demand. After that, changes flow continuously, matched to the same Xero record each time so a Carbon customer or invoice never duplicates.
  

  - **Backfill**: Whether to seed Xero with your existing **customers**, **vendors**, and **items** on first connect.
  - **Source of truth**: Per entity (customer, vendor, item, invoice, bill): whether **Carbon** or the **accounting system** wins on conflict.
  - **Account mapping**: The default **sales** and **purchase** account codes, picked from your Xero chart of accounts.

Xero only appears when its OAuth client is configured server-side (`XERO_CLIENT_ID`). Without it the
integration is hidden — see `docs/platform/self-hosting/environment-variables`.

## Exchange rates

Turn it on and it runs — no fields to configure. Carbon refreshes currency **exchange rates daily** so
foreign-currency documents convert against current rates. Exchange Rates is available on **every plan**.

On Carbon Cloud the rates come from **exchangeratesapi.io** by default, fetched against a **EUR** base and
then converted into each company's base currency, so every currency you trade in stays aligned.

## Related

  - Accounting reference How Carbon posts to the ledger — what Xero mirrors.
  - Invoices The sales and purchase invoices that sync to Xero.
