# Customer, Supplier and Employee Record Layout Research: Best Practices Survey

## Summary

This survey looks at how 9 products lay out a customer record. It also covers the supplier and employee records, because Carbon will use one layout for all three. The trigger is an after-sales service manager who wants "one-stop shopping". They want one place for sales history with quantities, serials, field service, RMAs, training, feedback and contacts.

The products agree on a 4-part skeleton:

1. A header with identity, status, owner and 4–7 key values.
2. A default **Overview** that summarizes, not an edit form.
3. Related-record **cards**. Each card shows a count, the top 3–10 rows and a link to the full filtered list.
4. An activity feed, in a side panel or a tab.

Heavy lists go to secondary tabs that load only when the user opens them. Carbon's customer page opens on an edit form today. It has no summary values, and 4 of its related lists are links that leave the page.

## Competitors Surveyed

- **SAP S/4HANA / Fiori** — the enterprise reference. Object page floorplan, the Customer – 360° View app (F2187A), installed base, supplier evaluation, Ariba Supplier 360°, SuccessFactors People Profile.
- **Salesforce** (Sales Cloud, Service Cloud, Manufacturing Cloud) — the reference for an account page. Highlights Panel, related lists, Assets, Return Orders, activity timeline.
- **Microsoft Dynamics 365 / Business Central** — Account form, Field Service assets, the Business Central customer card FactBox pane.
- **Oracle NetSuite** — customer record subtabs, customer dashboard, Customer 360, Field Service Management assets.
- **Odoo** — one partner form for customers and vendors, smart buttons, chatter.
- **HubSpot** — three-column and two-column record layouts, data highlights, association cards, feedback surveys.
- **Attio** — a modern CRM record page with highlights and relationship tabs.
- **Twenty** — an open-source React CRM. Carbon can read its implementation.
- **Workday, BambooHR, Coupa, Plex, Epicor** — employee and supplier record patterns.

## Key Consensus Patterns

### 1. The default view is a summary, not the edit form

- **SAP**: Customer – 360° View opens on an Overview tab: recent documents, contacts, recent deliveries and documents that wait for approval. The fields live in a General Data tab.
- **Salesforce**: Details (every field) is one tab among Related and Activity. The performance guidance says: "keep the Details component off the default tab."
- **Dynamics 365**: The Summary tab opens first. Microsoft's reference account layout puts key fields, a contacts subgrid and the timeline on it.
- **NetSuite**: Customer 360 is read-only and opens on Overview: recent activity, Sales This Year, lifetime value and top selling items.
- **HubSpot**: The Overview tab is the default, and nobody can delete it.
- **Twenty**: The "Home" tab (fields plus relation cards) is pinned on the left. The first tab on the right is Timeline.
- **Workday**: The worker profile opens on Summary.
- **Rationale**: The person who opens a record wants to know "what is going on with this customer". The page answers that question first. The edit form is for the rare time when a fact changes.

### 2. The header shows identity, status, owner and a few key values

- **SAP**: The header holds facets. A form facet holds at most 5 label-value pairs. A key-value facet shows a KPI. SAP says the header "contains only essential information."
- **Salesforce**: The Highlights Panel shows the first 7 fields of the compact layout, and up to 12 with the Dynamic Highlights Panel. Up to 10 action buttons show before the overflow menu.
- **Dynamics 365**: The header has up to 4 read-only fields. A flyout shows more.
- **HubSpot**: The data highlights card shows up to 4 properties. **Attio**: the Highlights section shows up to 6 widgets.
- **SuccessFactors**: The person header adds up to 3 fields to photo, title, department and location.
- **Rationale**: 4–7 values fit on one line at desktop width. More values push the content below the fold.

### 3. Related records are summary cards with a count, top rows and "View all"

- **SAP**: A table with up to 20 rows shows all of them. A table with 20–100 rows shows 10 rows and a "More" button. A table with more than 200 rows shows 10–20 rows and "Show All (x)".
- **Salesforce**: A related list card shows 6 records in a wide column and 3 in a narrow column. Each row has up to 4 fields, and the card has a View All link. Related List Quick Links show a count per list.
- **Dynamics 365**: The Recent records card shows 4 rows by default.
- **Twenty**: A relation card shows 5 records. "More (N)" adds 5 more. At the end, the button opens the filtered list page.
- **Odoo**: A smart button shows a count or a money amount ("Sales 12", "Invoiced $40k"). A click opens the list, filtered to the partner and its child contacts.
- **Business Central**: The "Sales Hist. Sell-to" FactBox shows a count tile per document type (quotes, orders, invoices, return orders, posted shipments). Each tile opens a filtered list.
- **Rationale**: A count tells the user that records exist. The top rows answer the common question. "View all" reuses the module's full list page, so the record page never copies a list's filters and columns.

### 4. Heavy content goes to secondary tabs, which load on demand

- **SAP**: The anchor bar is the default. Use tabs when topics have "complex content, such as long tables". Use no more than 4 grid tables on an anchor-bar page. The page loads section by section.
- **Salesforce**: Only the default tab renders at load. Visible components: 0–5 is best, 8 is acceptable, 10 or more is a problem. Put at most 3 related lists on a tab.
- **Dynamics 365**: The default tab runs every data fetch at open. A secondary tab loads when the user opens it. Microsoft says to keep only the most-used subgrids on the default tab.
- **Business Central**: FactBoxes load one by one from the top. An off-screen FactBox loads when the user scrolls to it. The statistics run in a background task.
- **Rationale**: A 360 page reads from many tables. If the default view reads them all, the page is slow for every visit.

### 5. The activity feed sits in a side panel or a tab, newest first

- **SAP**: The timeline "does not have a fixed location". If people read it next to the content, put it in a side panel. If people read it seldom, put it in a tab. Notes are not timeline entries. Notes go in their own tab.
- **Salesforce**: The Activity tab is in the right column. "Upcoming & Overdue" is at the top. Past activity is grouped by month. Filters cover date range, owner and activity type.
- **Dynamics 365**: The timeline shows 10 records per page, newest first. Filters cover record type, status and date. A user can pin up to 15 records.
- **HubSpot**: One pinned activity per record. Filters cover type, user and time frame.
- **Twenty**: The timeline shows created, updated, deleted, restored, linked and unlinked events, grouped by month.
- **Rationale**: The activity feed answers "what happened lately". It is secondary to the summary, so it sits beside the summary or behind a tab, not on top of it.

### 6. The installed base hangs off the customer and starts from the shipped serial

- **SAP**: Goods issue copies the partner from the delivery into the serial number record. An installed base can come from a sales order ("as sold"). The customer equipment record holds the warranty end date, the install address and the service history.
- **Salesforce**: An Assets related list on the account. Parent Asset builds a hierarchy. An asset links to cases, work orders, entitlements and service contracts. Return Orders is a related list on the account.
- **Dynamics 365 Field Service**: An "Assets and Locations" tab on the account shows a tree of functional locations with the assets inside. RMAs live in the Inventory area, not on the account.
- **NetSuite FSM**: Site, then Machine (item + serial), then Component.
- **Odoo**: A "Lot/Serial Numbers" button on the partner opens the serials delivered to that customer. Repairs hang off the serial, not the partner.
- **Rationale**: Service starts from "which unit". The customer page lists the units. The unit's own page holds its service history.

### 7. Customer, supplier and employee records share one skeleton

- **SAP**: One Business Partner record holds the customer, supplier and employee roles.
- **Business Central**: Microsoft says the Vendor Card is built "like the Customer Card page". It has the same FactBoxes: statistics, history tiles, links and notes.
- **Odoo**: Customers and vendors use one `res.partner` form. The employee form uses the same shape: smart buttons, tabs and chatter.
- **NetSuite**: Customer, vendor and employee records all use subtabs plus a dashboard with KPI and transaction portlets.
- **Rationale**: One skeleton means one set of components, and a user learns the page once.

### 8. Items with an expiry use a three-state badge

- **SAP Ariba**: Each supplier certificate shows Valid, Expiring or Expired, plus its expiry date.
- **BambooHR**: Each training shows its due date. Orange means expired or past due. Gray means upcoming.
- **Plex**: Suppliers record certificate dates, and Plex sends an email before a certificate expires.
- **Rationale**: The user needs to see what needs action. A date alone needs mental arithmetic.

## Answers to Research Questions

1. **Which regions make up a record page?** A header (identity, status, owner, 4–7 values, actions). A main column that opens on a summary (all 9 products). Related-record cards with a count and "View all" (SAP, Salesforce, Dynamics 365, Twenty, Odoo, Business Central). An activity feed in a side panel or a tab (SAP, Salesforce, Dynamics 365, HubSpot).
2. **One page or tabs, and what goes first?** Tabs, with a light default tab. SAP prefers one page with anchors until the content gets heavy, then tabs. Salesforce, Dynamics 365, NetSuite Customer 360, HubSpot and Workday all open on a summary tab. Salesforce gives a budget for that tab: 5–8 components, 3 related lists at most.
3. **How do related lists summarize, and which values go in the header?** A count, the top 3–10 rows and a link to the full list (pattern 3). Header values: customer revenue this year, open orders and balance (Business Central, NetSuite). Supplier: spend, on-time %, quality % (SAP, Odoo, Plex).
4. **How do service products show installed base, cases and training?** The asset or serial list sits on the customer, and the service history sits on the asset (pattern 6). RMAs show on the account in Salesforce and in NetSuite's Customer 360 counts. Dynamics 365 keeps RMAs in Inventory. No surveyed product has a standard object for **training delivered to a customer**. Salesforce skills apply to service resources only. This is open ground for Carbon.
5. **What feeds the activity timeline?** In CRMs: emails, calls, meetings, tasks and notes (Salesforce, HubSpot, Dynamics 365). In Twenty: record events and field changes. SAP keeps notes apart from the timeline. Carbon has no email or call activity, so its feed is record events: documents created and status changes.
6. **Does the layout carry over to suppliers and employees?** Yes (pattern 7). Supplier records add a score (spend, on-time, quality), certificates with expiry and risk. Employee records add availability (time off, schedule), training and certifications with expiry, and skills.

**Feedback to engineering.** HubSpot links each survey response to the contact and the company. HubSpot has no native board that sends feedback to a product team; a workflow creates the follow-up ticket. Carbon's Issues already do more: an issue links to a customer, item and serial, and has assignees, actions and reviewers.

## Competitor-Specific Details

### SAP S/4HANA / Fiori
- The object page header collapses to 2 lines when the user scrolls. A KPI stays visible the longest.
- The first section has no title.
- A side panel holds only contextual content, never object data and never a finalizing action.
- Customer – 360° View (F2187A) has 5 tabs: Overview, Business Documents, Fulfillment, Product and Prices, General Data. Business Documents is one list with a type dropdown. Fulfillment lists late sales orders. Product and Prices lists products ordered and returned in a period.
- Credit data is in a separate app, Manage Credit Accounts (F4596): exposure, limit use, overdue by period, DSO, last payment.
- The Overall Supplier Evaluation is a weighted average of price, quantity, quality, time, questionnaire and PPM scores, over the previous year to date.

### Salesforce
- The Account page has a Highlights Panel, a main column with Related and Details tabs, and a right column with Activity and Chatter.
- The admin sets which tab opens first. Partner blogs report that Activity opens first on standard pages, and that most sellers then click Details.
- Manufacturing Cloud adds Sales Agreements and Account Forecasts. The Asset Interactive Hierarchy shows 3 views: Current, As Installed, As Maintained.

### Dynamics 365 / Business Central
- The Field Service account has a Servicing tab: billing account, price list, service territory, work hour template.
- Field Service creates a customer asset when a work order product marked "Convert to Customer Asset" is used.
- The Business Central Customer Card Statistics FastTab has 5 groups: General, Balance, Payments, Sales This Year, Interactions. General holds Customer Since, Days Since Last Sale and Distinct Items Sold. Payments holds average days late and % paid late.
- The FactBox pane order: picture, documents, sales history tiles, customer statistics, dimensions, workflow status, links, notes.

### NetSuite
- The customer record has 11 subtabs. Sales has 7 subtabs, including Items Purchased (read-only) and Upsell.
- Customer 360 has 5 tabs: Overview, Opportunities and Estimates, Orders and Returns, Receivables, Activity. Each metric card links to a workbook.
- So NetSuite keeps 3 views of one customer: the form, a portlet dashboard the user can change, and Customer 360.

### Odoo
- Each installed app adds its own smart button to the partner form. A button can hide when its count is 0. Extra buttons go to a "More" menu.
- Chatter logs every field change, beside or below the form.

### HubSpot and Attio
- HubSpot's newer default layout has 2 columns: tabs (Overview, Activities, Intelligence, Revenue) and a right sidebar (key information, associations, attachments).
- HubSpot report cards filter a report to the record itself.
- Attio's left sidebar shows the first 5 attributes and has its own search.

### Twenty
- Implementation: the server defines the page as tabs of widgets (`standard-company-page-layout.config.ts`). The first tab pins to a left column on desktop and becomes a normal tab on mobile.
- A relation widget shows 5 rows and "More (N)". The final click opens the related object's index page, filtered to the record.
- The active tab is in the URL hash.

### Supplier and employee products
- **Ariba Supplier 360°**: Summary opens first. The other areas include Contacts, Certificates, Activity log, Risk, Qualifications and Questionnaires.
- **Workday**: tabs run down the left side. Career holds certifications, skills and the learning transcript. Absence holds time-off balances.
- **BambooHR**: tabs are Personal, Job, Timesheet, Time Off, Emergency, Documents, Notes, Benefits, Training, Performance.
- **Epicor Kinetic**: on-time delivery needs a custom query. It is not a standard supplier page value.

## Recommended Approach for Carbon

1. **Add an Overview as the default child route of the customer, supplier and employee pages.** Move today's form to "Details", and keep it in the sidebar. This follows pattern 1 (all 9 products). `_index.tsx` redirects to `details` today; point it at the overview.
2. **Keep Carbon's shell: the header card, the left `DetailSidebar` and `RecordOutlet`.** The left navigation plays the role of the tab list in Salesforce and Workday. Each sidebar entry already loads only when the user opens it (pattern 4). Do not build a new page frame.
3. **Show 4 values in the header row of the overview, with `MetricCard`.** Customer: revenue in the last 12 months, open orders, open balance, units in service. Supplier: spend in the last 12 months, open purchase orders, on-time %, quality issues. Employee: shift, next scheduled work, training due. This follows pattern 2 (Dynamics 365 and HubSpot use 4).
4. **Build the overview from summary cards.** Each card has a title with a count, up to 5 rows and "View all" to the existing filtered list. This follows pattern 3 (Twenty uses 5). Reuse `OverviewSection` / `AttentionRow` from `ProjectOverview.tsx` and `RelatedDocument`. Keep the overview to 6–8 cards (Salesforce's 5–8 budget).
5. **Customer overview cards, in this order:**
   1. Needs attention: overdue invoices, late orders, open RMAs, open issues.
   2. Purchases by item: quantity shipped, last order date.
   3. Installed base: serials with a warranty badge.
   4. Service: open service orders and the last visit.
   5. Returns (RMAs).
   6. Training.
   7. Feedback (issues).
   8. Contacts.

   This follows patterns 3 and 6, and NetSuite's Items Purchased and Top Selling Items.
6. **Turn the RFQs, Quotes, Orders and Invoices sidebar links into in-page counts.** They leave the page today. A count on each entry follows Salesforce Quick Links and the Business Central history tiles.
7. **Put the activity feed in the right side panel of the overview.** It shows record events, newest first, grouped by month. This follows pattern 5 (SAP side panel, Salesforce right column). Notes stay separate (SAP). `DocumentSidebar`'s activity feed reads the audit log, which is plan-gated. The spec must decide what a company without the audit log sees.
8. **Read the overview values through one RPC per record type** (for example `get_customer_overview`). No per-customer rollup exists today, and 8 cards as 8 separate queries would make the slow default view that pattern 4 warns against. The RPC returns counts and top rows in one call.
9. **Use one three-state badge for expiry** on supplier certificates, employee training and the customer warranty: valid, expiring, expired. This follows pattern 8 (Ariba, BambooHR).
10. **Customer training is a new record** (no product has one). Show it on the customer overview and on the contact.

## Sources

- https://experience.sap.com/fiori-design-web/object-page/
- https://experience.sap.com/fiori-design-web/dynamic-page-layout/
- https://experience.sap.com/fiori-design-web/object-page-content-area-sap-fiori-elements/
- https://experience.sap.com/fiori-design-web/timeline/
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/a376cd9ea00d476b96f18dea1247e6a5/ed46ef43a0c145bca2db07f438b66f57.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/918bca53037f408f91a2295d04ac16bc/be5747120f22446dbaeabc02044722d3.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/918bca53037f408f91a2295d04ac16bc/653183f312e1480d989c29877e39236c.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25de5f7eadc94d688aa3ce34de0cd09b/3edfb853ff98b44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25de5f7eadc94d688aa3ce34de0cd09b/ee7bb6535fe6b74ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25de5f7eadc94d688aa3ce34de0cd09b/c628b753128eb44ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25de5f7eadc94d688aa3ce34de0cd09b/0a7bc1536ca9b54ce10000000a174cb4.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/adbae5bcd5994f159bf2847a11397b61/f3dead0401a54383869d090629f146e8.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0e602d466b99490187fcbb30d1dc897c/97954958371c9144e10000000a4450e5.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/0e602d466b99490187fcbb30d1dc897c/c7258333af7a4eca955967f013a35360.html
- https://help.sap.com/docs/SAP_Ariba/911046c05f35456b9c5ac7ba3266cc8a/ee17596f06ac4fb980c5228709f28cd2.html
- https://help.sap.com/docs/SAP_Ariba/aba524a8b2444714b289cee09bd4c377/0265f916214e44b5ab946bb73854b20e.html
- https://help.sap.com/docs/SAP_SUCCESSFACTORS_PLATFORM/7e56af8b533f439395da01074e7aca7a/0862b148110d46febd6a91dcd222715d.html
- https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition-sourcing-and-procurement/outlining-supplier-evaluation_d7f0d2f8-dc2b-4b19-a377-2bc5d2c70620
- https://learning.sap.com/courses/sap-ariba-supplier-management-supplier-lifecycle-management/understanding-the-supplier-360-profile
- https://learning.sap.com/learning-journeys/implement-sap-s-4hana-cloud-public-edition-for-sourcing-and-procurement/maintaining-business-partner-master-data_b4f2836d-945e-4ee9-a1b4-312f32d42c6f
- https://blogs.sap.com/2022/06/06/customer-360-customer-insights-sales/
- https://trailhead.salesforce.com/content/learn/modules/lightning-experience-for-salesforce-classic-users/work-with-your-data
- https://trailhead.salesforce.com/content/learn/modules/field_service_maint/field_service_maint_assets
- https://help.salesforce.com/s/articleView?language=en_US&id=platform.compact_layout_overview.htm&type=5
- https://help.salesforce.com/s/articleView?id=activity_timeline_filters.htm&language=en_US&type=5
- https://help.salesforce.com/s/articleView?id=fs_create_return_orders.htm&language=en_US&type=5
- https://help.salesforce.com/s/articleView?id=ind.mfg_asset_interactive_hierarchy.htm&language=en_US&type=5
- https://help.salesforce.com/s/articleView?id=000390330&language=en_US&type=1
- https://www.salesforceben.com/the-analyze-button-improve-your-salesforce-lightning-page-load-speed/
- https://www.salesforceben.com/ultimate-guide-to-salesforce-dynamic-related-lists/
- https://www.salesforceben.com/save-your-users-clicks-with-salesforce-quick-links/
- https://www.apexhours.com/dynamic-highlights-panel/
- https://www.asagarwal.com/how-to-increase-no-of-visible-action-buttons-on-a-record-page/
- https://tether.ie/lightning-page-defaults/
- https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/main-form-presentations
- https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/design-productive-forms
- https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/design-performant-forms
- https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/set-up-timeline-control
- https://learn.microsoft.com/en-us/dynamics365/sales/accounts-contacts
- https://learn.microsoft.com/en-us/dynamics365/customer-service/use/oc-customer-summary
- https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/add-display-components-to-case-form
- https://learn.microsoft.com/en-us/dynamics365/field-service/accounts
- https://learn.microsoft.com/en-us/dynamics365/field-service/functional-locations
- https://learn.microsoft.com/en-us/dynamics365/field-service/assets
- https://learn.microsoft.com/en-us/dynamics365/field-service/process-return
- https://learn.microsoft.com/en-us/dynamics365/guidance/resources/field-service-customize-forms
- https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-adding-a-factbox-to-page
- https://learn.microsoft.com/en-gb/training/modules/master-supplemental-personal-data-dynamics-365-business-central/3-vendor
- https://github.com/StefanMaron/MSDyn365BC.Code.History/blob/w1-27/BaseApp/Source/Base%20Application/Sales/Customer/CustomerCard.Page.al
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/subsect_161887259374.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N592097.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_2124027515.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_0709124630.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1077516.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0814010048.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4849482517.html
- https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html
- https://github.com/odoo/odoo/blob/18.0/addons/sale/views/res_partner_views.xml
- https://github.com/odoo/odoo/blob/18.0/addons/stock/views/res_partner_views.xml
- https://github.com/odoo/odoo/blob/18.0/addons/repair/models/stock_lot.py
- https://knowledge.hubspot.com/object-settings/customize-records
- https://knowledge.hubspot.com/records/understand-the-default-record-layout
- https://knowledge.hubspot.com/object-settings/create-cards-on-records
- https://knowledge.hubspot.com/records/use-cards-on-records
- https://knowledge.hubspot.com/records/filter-activities-on-a-record-timeline
- https://developers.hubspot.com/docs/api-reference/latest/crm/objects/feedback-submissions/guide
- https://knowledge.hubspot.com/customer-feedback/how-do-i-send-a-customer-loyalty-survey
- https://attio.com/help/reference/managing-your-data/records/configure-record-pages
- https://attio.com/help/reference/managing-your-data/records/create-and-view-records
- https://github.com/twentyhq/twenty/blob/main/packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/page-layout-config/standard-company-page-layout.config.ts
- https://github.com/twentyhq/twenty/blob/main/packages/twenty-front/src/modules/page-layout/widgets/field/components/FieldWidgetRelationRecordsCard.tsx
- https://hr.virginia.edu/sites/default/files/TALENT%20COE/Workday/Navigating%20your%20Worker%20Profile.pdf
- https://help.bamboohr.com/s/article/1152030
- https://help.bamboohr.com/s/article/587758
- https://plex.rockwellautomation.com/en-us/products/enterprise-resource-planning/suppliers-and-purchasing-management.html
- https://www.epiusers.help/t/supplier-on-time-score/44149
