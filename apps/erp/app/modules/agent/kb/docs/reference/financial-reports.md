# Financial statement reports

> The Balance Sheet, Income Statement, and Trial Balance built from posted journals by account class.

Three reports read the same posted `docs/reference/accounting` and present it three ways. The **Balance Sheet** shows what the company owns and owes as of a date; the **Income Statement** shows revenue minus expense over a period; the **Trial Balance** lists every posting account with its debit or credit balance. All three come from the same balance engine, so they tie out to each other by construction.

They live under Accounting and each require the `accounting` view permission. Like everything financial, they only show data once **accounting enabled** is on — see `docs/reference/accounting` for that switch. With it off, journals are never written and every balance reads zero.

## The three statements

  - **Balance Sheet**: Assets, Liabilities, and Equity as of an end date. Reads the cumulative balance up to that date, so there is no start date to pick. Carbon appends a computed **"Net Income"** equity line so the sheet ties.
  - **Income Statement**: Revenue and Expense activity between a start and end date. Reads the net change within the range, not a running total.
  - **Trial Balance**: Every posting (leaf) account with its balance split into a debit or credit column, across a date range. Normal-debit classes (Asset, Expense) show a positive balance as a debit; normal-credit classes (Liability, Equity, Revenue) show it as a credit.

The split isn't three data sources. The Balance Sheet and Trial Balance are the same account set at a cutoff; the Income Statement is the movement across a window. Every account carries an `incomeBalance` marker of either **"Balance Sheet"** or **"Income Statement"**, set when the account is created, that decides which statement it appears on. Asset, Liability, and Equity accounts are Balance Sheet; Revenue and Expense are Income Statement.

Balances always exclude **Draft** journals. Only posted (and reversed) entries move a report, so an unposted entry sitting in the Journal Entries list has no effect on any statement until it posts. This is why the account ledger, the reports, and the `docs/reference/period-close` snapshots all agree.

## How a balance is built

Every report starts from a single balance function that reads the posted ledger and returns three numbers per account:

  - **balance**: All-time cumulative balance, no date bound. The running total of every posted line on the account.
  - **balanceAtDate**: Cumulative balance from inception up to the report's **end date**. This is the *as-of* figure the Balance Sheet shows.
  - **netChange**: Activity *within* the start-to-end window only. This is the movement the Income Statement shows, and the period column on the Trial Balance.

Group (heading) accounts don't hold postings; their totals roll up from their children. Because a debit and a credit are stored with opposite signs, the roll-up is **sign-aware by account class**. Asset and Revenue accounts add to their parent; Liability, Equity, and Expense subtract. That single rule makes the accounting identities fall out cleanly: a Balance Sheet root nets Assets minus Liabilities minus Equity to roughly zero, and the Income Statement root is Revenue minus Expense, which *is* net income.

Undistributed profit lives in the Revenue and Expense accounts until a period close moves it. A Balance Sheet drawn at any date would otherwise be out of balance, because that profit belongs in equity. Carbon closes the gap by summing every Income Statement leaf account (Revenue minus Expense, with the same sign rule) and surfacing it as a single **"Net Income"** line inside the Equity group. It is a calculated row, not a real account you can post to. Don't create a "Net Income" account in the chart of accounts.

## Period and date selection

Each report has a period picker at the top, but they don't pick the same thing:

- The **Balance Sheet** is *as-of*: you choose an end date only (presets like **"Today"**, **"End of Last Month"**, **"End of Last Quarter"**, **"End of Last Fiscal Year"**, or a custom **"As of"** date). There is no start date, because the sheet is a cumulative snapshot.
- The **Income Statement** and **Trial Balance** are *range*: you choose a start and end date (presets like **"This Month"**, **"Last Quarter"**, **"This Fiscal Year"**, **"Fiscal Year to Date"**, **"All Time"**, or a custom range). Fiscal presets follow the company's fiscal start month from `docs/reference/period-close`.

These pickers slice by **posting date**, not by the `docs/reference/period-close` a journal landed in, so a report window can span open and closed periods freely. Closing a period doesn't change what a report shows; it just snapshots balances so the reads stay fast.

Alongside the date picker, a company selector lets you view a single company or roll several together (multi-company consolidation, with currency translation when a **"Show translated"** toggle is on), and an account search filters the tree by name or number.

## What the reports do not slice

There is one gap worth stating plainly, because it's easy to assume otherwise.

Journal lines can carry reporting dimensions (location, department, cost center, and custom axes), but the Balance Sheet, Income Statement, and Trial Balance **do not** offer a dimension filter. They aggregate every posting on an account regardless of its dimension tags. To analyze the ledger by dimension, use the `docs/reference/dimensions` tooling, not these three statements.

The account ledger drawer (the drill-down you get by clicking an account on any of these reports) lists that account's individual posted lines for the same window, so a report figure always traces back to the transactions that make it up.

## Related

  - Accounting & the ledger The journal, accounts, and the accounting-enabled switch these reports read from.
  - Dimensions & cost centers The tag axes the core statements do not slice by, and where to analyze them instead.
  - Period close Fiscal periods, the balance snapshots that keep reports fast, and fiscal-year settings.

## Troubleshooting

The financial reports (Balance Sheet, Income Statement, Trial Balance) rarely throw string errors; the common problems are wrong-looking numbers with a precondition cause.

### "Why are all my numbers zero"
The company's **accounting enabled** setting is off, so no journal entries have ever been written. Reports read the posted general ledger, and there is nothing to read. Turn accounting on in company settings; balances accrue from postings made after that point. A brand-new company with accounting on but no posted documents also reads zero until the first shipment, invoice, receipt, or journal posts.

### "Why do my numbers look too low / an entry is missing"
Balances exclude **Draft** journals. An entry that is still Draft in the Journal Entries list does not move any report until it is posted. Post it (or check its status) and the figure updates. Reversed journals *do* count, as their offsetting entry.

### "Why is my Balance Sheet out of balance / Assets ≠ Liabilities + Equity"
The Balance Sheet appends a computed **"Net Income"** equity line that carries undistributed Revenue-minus-Expense into equity. If a figure still looks off, it is almost always a date-selection issue (an as-of date before some postings) or an account created with the wrong class or `incomeBalance` marker (for example a Revenue account flagged Balance Sheet), which misroutes it in the sign-aware roll-up. Check the account's class and Balance Sheet vs Income Statement setting in the chart of accounts.

### "Why doesn't my dimension filter change the totals"
There isn't one. The core statements aggregate every posting on an account regardless of dimension tags. Dimension analysis is a separate tool, not a filter on these three reports.

### "Balance Sheet has no start date field"
By design. The Balance Sheet is an as-of snapshot (cumulative balance up to the end date), so it exposes only an end date. The Income Statement and Trial Balance are range reports and take both a start and end date.

### Preconditions to check first
- **accounting enabled** must be on (off by default) or every balance is zero.
- The report window is by **posting date**, independent of accounting-period close status; closing a period does not hide its postings from reports.
- The signed-in user needs the `accounting` view permission to open any of the three reports.
