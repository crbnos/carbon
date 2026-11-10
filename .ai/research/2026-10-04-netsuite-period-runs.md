# Period Runs (Revenue Recognition and Depreciation) Research: NetSuite Survey

## Summary

This file surveys how NetSuite runs revenue recognition and depreciation for a period. It covers Advanced Revenue Management (ARM) and the Fixed Assets Management SuiteApp (FAM). The questions come from 4 fixes that Carbon proposed after a run posted into a future month and moved the Active period. NetSuite keeps no stored "current period": it reads the current period from the system date. Both NetSuite engines guard future periods, but in different ways. ARM undoes a run cleanly: a void or delete of the journal makes the plan lines recognizable again. FAM has no undo, and partners document a painful manual repair. For catch-up, FAM writes one journal per missed month in that month's own period. ARM puts all catch-up revenue into the period the user selects, and it records both periods on each line.

Scope: NetSuite only, at the request of the user. This survey does not cover SAP. Carry that gap into the spec if one follows.

## Competitors Surveyed

- **NetSuite ARM** — the revenue recognition journal process ("Create Revenue Recognition Journal Entries"). It is the closest match to a Carbon revenue recognition run.
- **NetSuite FAM** — the "Asset Depreciation" process. It is the closest match to a Carbon depreciation run.

## Key Consensus Patterns

### 1. The current period comes from today, not from the last posting

- **ARM**: The Accounting Period Window uses "the system date as the baseline period". A scheduled run posts to the current period. No document says that a run changes a stored current period.
- **FAM**: "Allow Future-dated Depreciation" compares the run date with the current period. No document says that a run changes it.
- **Rationale**: A posting date and the current period are different facts. If a posting can move the current period, one back-dated or future-dated journal corrupts the label for everyone.

### 2. Both engines guard future periods

- **ARM**: Run Now has no guard of its own. The Accounting Period Window locks future periods past a set number. A scheduled run has "Exclude Current and Future Periods".
- **FAM**: The preference "Allow Future-dated Depreciation" is the guard. When it is clear, FAM depreciates "to the current period only".
- **Rationale**: Revenue or depreciation for a month that has not happened misstates the current month. The current month itself stays runnable, because a close often starts before the month ends.

### 3. Undo resets the source records, not only the journal

- **ARM**: "If you void or delete an advanced revenue recognition journal entry, the link to the journal is removed from the revenue recognition plan." The plan becomes recognizable again in the same period.
- **FAM**: No undo exists. A partner documents a 6-step manual repair: delete the journal, delete the depreciation history records, and reset the asset fields. Oracle makes those asset fields read-only, so the repair is unsupported.
- **Rationale**: A journal reversal that leaves the plan line "recognized" or the asset value "depreciated" loses the revenue or the book value for good. ARM shows the right model. FAM shows the cost of not having it.

### 4. Catch-up of missed periods

- **ARM**: Catch-up is opt-in ("Include Prior Periods"). The run puts all of it into the selected posting period. Each plan line keeps 2 fields: the Planned Period (when the revenue was due) and the Posting Period (where its journal posted).
- **FAM**: A run takes a cut-off date. FAM creates one journal "per asset type and per period of depreciation". Each missed month posts in its own period. If that period is closed, FAM posts it to the next open period.
- **Rationale**: Both keep the late amounts visible. FAM puts each month in its own period automatically. ARM puts catch-up in one period, but records the period it was due in.

### 5. No draft run; a run can repeat

- **ARM**: The journals post at once, or go to journal approval. "Estimate" previews the count and amount. A user can run the process "any time and multiple times in a month". A second run finds only lines that have no journal.
- **FAM**: There is no draft run. The forecast depreciation history rows and the Depreciation Schedule report act as the preview. Custom journals can need approval before they post.
- **Rationale**: A second run for the same period picks up late items. NetSuite needs no draft stage, because a run is cheap to repeat and simple to undo (ARM).

## Answers to Research Questions

1. **Can a run post into a future period?** — ARM Run Now: the docs show no guard of its own. The Accounting Period Window locks far-future periods. A scheduled ARM run can exclude current and future periods. FAM: only when "Allow Future-dated Depreciation" is on. The docs do not give the default of that preference.
2. **How does a run catch up missed months?** — FAM: one journal per month, each in its own period. A closed month moves to the next open period. ARM: everything goes into the selected posting period when "Include Prior Periods" is on (an inference from the docs; not stated in words). Each line records its Planned Period and its Posting Period.
3. **Which period does the journal land in?** — FAM: the depreciation month's own period. ARM: the period selected on the run. If that period is closed or locked for A/R, an approved journal goes to the next open period.
4. **Can a user repeat a run, or rebuild it before it posts?** — Neither engine has a draft run. ARM allows repeated runs in one month. Each run takes only lines that have no journal. The docs do not describe a FAM re-run.
5. **How does a user undo a posted run?** — ARM: void or delete the journal. The plan lines become recognizable again in the same period. FAM: no supported undo. Neither engine's docs say whether an undo must start at the latest period.
6. **Does a run change the current period?** — No evidence for either engine. NetSuite reads the current period from the system date.

## Competitor-Specific Details

### NetSuite ARM

- **Run Now fields**: Posting Period (required, not closed or locked), Include Prior Periods, Journal Entry Date, Approve Journal, Subsidiary, Accounting Book, filters, and Select Individual Schedules.
- **Journal Entry Date**: the preference "Default Revenue Recognition Journal Date to" sets Last Day of Period or Current Date.
- **Journal count**: depends on volume, not on periods. Summary mode puts up to 50,000 plans in 1 journal. Detail mode starts a new journal every 1,000 lines.
- **Period status**: A/R Locked, Lock All and Closed refuse revenue recognition journals. Users with Override Period Restrictions can choose an A/R-locked period.
- **Holds**: "Hold Revenue Recognition" pauses a plan. When the hold ends, the missed revenue posts in the plan's Catch Up Period.
- **Is Recognized**: a separate flag for revenue that a manual journal recognized. The run skips lines that have it.
- **Plan updates**: plans update every 3 hours when the preference is Automatic. If a plan updates during a run, the run fails and the user runs again.

### NetSuite FAM

- **Run inputs**: Asset Type(s), Subsidiary(s), Depreciation Period (a cut-off date), and Depreciation Reference.
- **Depreciation History Record (DHR)**: one row per asset per period. Its Posting Reference links it to the journal. FAM pre-computes forecast DHRs for the whole asset life.
- **Summarize Journals By**: Parent, Sub-Category or Asset Type. FAM 3.0 removed one journal per asset.
- **Process**: a background batch with 7 stages. Only one process runs at a time.
- **Locked A/P or A/R**: 2 preferences decide whether the journal moves to the next open period.
- **Asset fields**: Cumulative Depreciation, Last Depreciation Period, Last Depreciation Amount and Last Depreciation Date are always read-only.

## Recommended Approach for Carbon

The table maps each proposed fix to the NetSuite evidence.

| Proposed fix | NetSuite evidence | Recommendation |
|---|---|---|
| 1. The Active period follows today only | NetSuite reads the current period from the system date. | Keep. Stop every posting from moving the Active flag. The next step is to derive the flag from the company's today, as NetSuite does. |
| 2. No run for a future month | FAM "Allow Future-dated Depreciation" (current period only when clear). ARM scheduled runs exclude future periods. | Keep. Allow the current month and earlier. Refuse later months. A company setting like FAM's can come later if a customer asks for it. |
| 3. Reverse Run resets the source records | ARM void or delete makes the plan lines recognizable again. FAM has no undo, and partners call the repair painful. | Keep, and follow ARM. Reverse the journal, set the schedule rows back to Planned, and take the amounts back off the assets. Restrict depreciation to the latest posted run, because later runs build on it. |
| 4. Oldest month first | FAM posts each missed month in its own period. ARM puts catch-up in one period but records the Planned Period and the Posting Period. | Change. Do not refuse. Follow FAM: post one journal per month, each in that month's period. If that month is Closed, post it in the run's period. |
| (new) Repeat a run for the same month | ARM runs "multiple times in a month", and each run takes only lines that have no journal. | Allow a second revenue recognition run for a period that already has a posted run, if rows are still due. Carbon refuses this today. |

Fix 4 changes from the earlier proposal. With per-month journals, a late run puts each amount in the right period. So Carbon has no reason to refuse a run that skips a month. The FAM pattern removes a guard, and the result is still correct.

## Sources

- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4358638894.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4331941758.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4668802106.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4380140655.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4334528792.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4369089832.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4357047027.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4351787245.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4351787732.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4339730171.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4365500917.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1692238.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451349.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1451595.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1452509.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1550020494.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1201085716.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_1201085800.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2158182.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1118051157.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1118051118.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4260547210.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_164861655712.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1492665860.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_N2154557.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_1501564204.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4466155792.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1530828764.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157970301580.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1515625259.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3759800870.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2150936.html
- https://netsuitedocumentation1.gitlab.io/netsuitedocumentation1/FixedAssetsManagement.pdf (2016.2 guide, unofficial mirror)
- https://blog.concentrus.com/netsuite-fixed-asset-how-to-correct-depreciation (partner blog, not Oracle)
