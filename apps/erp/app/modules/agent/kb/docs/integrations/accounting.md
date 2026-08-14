# Accounting

> Mirror invoices, bills, and GL journals to Xero, QuickBooks, or Rillet, and keep exchange rates current.

Carbon keeps an external accounting ledger in step with what happens inside the ERP. Three ledgers are
supported — **Xero**, **QuickBooks Online**, and **Rillet** — plus an **Exchange Rates** service that keeps
multi-currency math honest. The ledger sync is an Enterprise (Business-plan) feature; Exchange Rates is free
on every plan.

## How the sync works

Once a ledger is connected, Carbon pushes **customers**, **vendors**, **items**, **sales invoices**, **bills**,
and its automated **GL journals** to the ledger. **Carbon is the source of truth**: its edits always win, and
every record is matched to the same external record each time, so a customer or invoice never duplicates.
Payments recorded in the ledger flow **back** into Carbon to settle the matching invoice or bill.

Connecting a ledger means every automated GL posting Carbon makes is mirrored to it. There is no toggle to
turn that off. Journals you post by hand (`Manual` source) never sync — only automated postings do.

Payment write-back settles the Carbon document from the ledger side: a payment recorded against an invoice in
Xero, QuickBooks, or Rillet comes back as a Carbon payment and an invoice settlement,
then posts to Carbon's general ledger. Rillet can also push Carbon-recorded
payments outbound; Xero and QuickBooks are pull-back only.

## Connect a ledger

Xero and QuickBooks Online connect over **OAuth** — no keys to paste. Rillet uses a per-company **API key**.

  
  ### Authorize the connection

  For Xero or QuickBooks, authorizing over OAuth stores the connection. For Rillet, paste the connection
  fields below.
  
  
  ### Configure the sync

  Set the account mapping, dimensions, and posting-sync options (below) before the first push.
  
  
  ### Run the initial sync

  Xero exposes a **Run Initial Sync** action that seeds the ledger on demand. After that, changes flow
  continuously.
  

Rillet's connection fields:

  - **API key**: The Rillet API key that authenticates the connection. Stored as a secret.
  - **Environment**: **Production** (`api.rillet.com`) or **Sandbox** (`sandbox.api.rillet.com`).
  - **Subsidiary ID**: Optional. The Rillet subsidiary (entity) that Carbon posts into, for multi-entity ledgers.
  - **Webhook token**: Optional secret. Inbound payment write-back stays off until this is set.

Xero appears only when `XERO_CLIENT_ID` is set, and QuickBooks Online only when `QUICKBOOKS_CLIENT_ID` is set
(see `docs/platform/self-hosting/environment-variables`). Rillet has no such gate — it
authenticates per company with its own API key, so it is always available.

## Configure the sync

An accounting integration has four tabs beyond the basic connection settings.

  - **Account Mapping**: Map each Carbon posting account to a code in the provider's chart of accounts. Posted journals push using the mapped provider account. Use **Suggest with AI** or **Match by code** to fill the map, then resolve anything left unmapped.
  - **Dimensions**: Map Carbon dimensions to the provider's tracking slots. Xero and QuickBooks expose two slots. Rillet sends every dimension on each line and provisions the matching fields automatically, so the slot editor does not apply to it.
  - **Posting Sync**: Choose how posted journals reach the ledger (see below).
  - **Sync Activity**: Watch every sync operation and retry the ones that failed (see below).

The **Posting Sync** tab controls three things:

  - **Source types**: Posted journals with these source types always sync. A per-type **Daily summary** toggle groups a day's journals of that type into one provider entry instead of sending each individually.
  - **AR / AP representation**: How receivables and payables reach the ledger. Each is either **Documents** (push the invoice or bill itself) or **Off — handled outside the sync**.
  - **Books lock date**: A manual date before which Carbon will not push new entries, so a closed period stays closed.

## Watch it run

The **Sync Activity** tab is an inbox of every sync operation, with **Status**, **Entity**, **Direction**
(push or pull), **Trigger**, **Attempts**, **Last Attempt**, and any **Error**. Filter by status, **Retry** or
**Skip** a failed operation, **Re-send** a completed one, or **Retry all** at once. When failed operations
remain after an outbound sweep, Carbon raises an in-app notification so the sync never fails silently.

Reconciliation runs weekly and writes the **Sync Tie-Out** report (**Accounting → Reports → Sync Tie-Out**).
It lays out one row per accounting period, account, and integration, comparing what Carbon **Posted** against
what actually **Synced**, and against the **Provider** balance. Any **Internal** or **External Delta** is
flagged so a drift between the two ledgers is visible before it becomes a month-end surprise.

Sync Activity answers "did this record make it across?" one operation at a time. Tie-Out answers "do the two
ledgers agree?" per account and period. The Sync Activity tab links straight to the tie-out summary for the
integration.

## Exchange rates

Turn it on and it runs — no fields to configure. Carbon refreshes currency **exchange rates daily** so
foreign-currency documents convert against current rates. Exchange Rates is available on **every plan**.

On Carbon Cloud the rates come from **exchangeratesapi.io** by default, fetched against a **EUR** base and
then converted into each company's base currency, so every currency you trade in stays aligned.

## Related

  - Accounting reference How Carbon posts to the ledger — what the sync mirrors.
  - Invoices The sales and purchase invoices that sync to your ledger.
