# Research: carrier transit time and ship-by dates

> Date: 2026-11-17
> Feeds: `.ai/specs/2026-11-17-carrier-transit-ship-by-dates.md`

## Questions

1. How do ERPs turn a delivery promise into a ship date?
2. Where do ERPs store transit time, and at what level?
3. Do ERPs count transit time in business days or calendar days?
4. Which dates do ERPs store on the order line?
5. How do ERPs record the actual delivery and compare it to the estimate?
6. Which carrier APIs give transit time without a label?
7. What do the direct competitors of Carbon (job-shop ERPs and MES) do?
8. Which tracking events will a later carrier integration send?

## 1. Delivery promise → ship date

| ERP | Chain |
|-----|-------|
| Business Central | Requested Delivery Date − Shipping Time = Planned Shipment Date. Planned Shipment Date − Outbound Whse. Handling Time = Shipment Date. The availability check runs on Shipment Date. Forward, the chain runs the other way. |
| SAP S/4HANA | Requested delivery date − route transit time = goods-issue date. Goods-issue date − loading time = loading date. Loading date − pick/pack time = material availability date. ATP runs on the material availability date. |
| Epicor Kinetic | Need By − Delivery Days = Ship By. |
| Odoo | Commitment date − security lead time = the scheduled date of the delivery. |
| NetSuite | "Number of Days to Shipment" gives the ship date. Carrier transit needs SuiteScript. |

All five systems keep two dates: the date the goods leave and the date the goods arrive. Transit time is the gap between them.

## 2. Where transit time lives

| ERP | Source of transit time |
|-----|------------------------|
| Business Central | Shipping Agent Service ("Shipping Time"). The Customer card overrides it. Handling time is on the Location. |
| SAP S/4HANA | The route. SAP finds the route from the shipping point, the destination zone and the shipping condition. |
| Epicor Kinetic | "Delivery Days" on the Customer and on each Ship To address. |
| Odoo | The customer lead time on the product, and a security lead time on the company. |

Transit time depends on the destination. So SAP and Epicor attach it to the destination (route or Ship To). Business Central attaches it to the carrier service with a customer override.

## 3. Business days or calendar days

| ERP | Rule |
|-----|------|
| Business Central | Working days. Shipping time counts on the calendar of the shipping agent service. The result then moves to a day the customer is open. With no calendar, every day counts. |
| SAP S/4HANA | Working days on a factory calendar at each step. |
| Epicor Kinetic | A company option, "Consider Working Days". On: skip the non-working days of the site. Off: calendar days. |
| NetSuite | Business days for days-to-shipment, with a cutoff time. |
| Odoo | Calendar days only. |

Business Central, SAP and Epicor skip non-working days while they count. They do not count calendar days and then move the result. So 3 transit days from a Friday land on a Wednesday, not on a Monday.

## 4. Dates on the order line

| ERP | Dates the line stores |
|-----|-----------------------|
| Business Central | Requested Delivery Date, Promised Delivery Date, Planned Delivery Date, Planned Shipment Date, Shipment Date |
| SAP S/4HANA | Each schedule line: delivery date, goods-issue date, loading date, material availability date, transportation planning date |
| Epicor Kinetic | Each release: Need By, Ship By |

All three store every date in the chain. None of them calculates a date at read time.

## 5. Actual delivery vs the estimate

Source tags: **[V]** means a vendor document confirms the fact. **[I]** means an inference or a forum post.

| Product | Actual delivery |
|---------|-----------------|
| SAP S/4HANA | Proof of Delivery (POD). The outbound delivery header holds the POD date in `LIKP-PODAT` and the time in `POTIM` [V]. An inbound IDoc or transaction VLPOD confirms it [V]. The billing due list holds back a POD-relevant delivery until the POD is confirmed [V]. |
| SAP on-time KPI | "Shipped as Planned" compares the planned goods-issue date with the actual goods-issue date. It ignores the factory calendar [V]. |
| Business Central | The posted shipment line has Shipment Date, Requested, Promised and Planned Delivery Date, and Planned Shipment Date. It has no actual delivery date [V]. No built-in on-time report was found [I]. |
| Dynamics 365 SCM | Transport days per mode of delivery set the confirmed ship date and the confirmed receipt date [V]. No actual delivery date was found [I]. |
| NetSuite | An item fulfillment goes Picked → Packed → Shipped [V]. It has no Delivered status [I]. NetSuite calculates the purchase lead time from the last 3 received POs [V]. |
| Odoo | The vendor on-time rate compares the receipt with the planned date, per PO line [V]. `date_done` on a customer delivery is the ship date [I]. |
| Epicor Kinetic | No delivered date and no standard on-time report. Users build one on `ShipHead.ShipDate` [V, forum]. |

Definitions:

- On-time shipping measures the ship date. On-time delivery (OTD) and OTIF measure the delivery date [V, secondary source].
- High on-time shipping with low OTD points at the carrier [V, secondary source].
- No standard OTIF definition exists. In a McKinsey survey, 67% preferred the customer's requested date as the reference [V].
- Sources disagree on early deliveries and on the tolerance window [V].

Tuning from history: SAP routes, BC Shipping Time and D365 transport days are static setup [V]. No product tunes transit time from measured deliveries [I]. A measured average that a user can adopt has no direct match in these products.

## 6. Carrier APIs (for the deferred integration phase)

| Provider | Transit time without a label | Days | Auth |
|----------|------------------------------|------|------|
| UPS Time in Transit | Yes. Origin and destination postal codes and a ship date. | Business days, and a delivery date | OAuth2, free with an account |
| FedEx Service Availability | Yes. Full addresses and an account number. | A commit date | OAuth2, free with an account |
| USPS Service Standards v3 | Yes. ZIP codes and a mail class. | Delivery days | OAuth2, 60 calls per hour by default |
| EasyPost SmartRate `deliver_on` | Yes. Two ZIP codes and a delivery date. It returns a `ship_on_date` for each service. | Calendar days, with p50–p99 percentiles | API key, US only |
| Shippo rates | Yes. It needs a shipment object. | `estimated_days`, an average | API key |
| ShipStation API rates estimate | Yes. ZIP codes and weight. | `delivery_days` | API key |

USPS retired the Web Tools APIs on 2026-01-25. FedEx retired its SOAP Web Services in 2026. Parcel APIs do not cover LTL freight. SMC3 CarrierConnect is the industry source for LTL transit days.

## 7. Direct competitors

Public documentation for ProShop, JobBOSS², E2, Global Shop Solutions, Plex and Paperless Parts needs a login. So most rows for them are gaps.

| Product | Dates | Transit days | Shop floor and shipping | On-time measure |
|---------|-------|--------------|-------------------------|-----------------|
| Epicor Kinetic | Need By (`OrderRel.NeedByDate`, arrive), Ship By (`OrderRel.ReqDate`), job Req By (`JobHead.ReqDueDate`, linked to Ship By) and the job due date (the schedule's end) [V] | "Delivery Days" on the Customer, overridden on the Ship To. Need By − Delivery Days = Ship By. A company setting picks working or calendar days [V] | The MES Work Queue shows start and due dates. It has no days-late flag. Users build one [V, forum] | No standard report [I] |
| Odoo | Sales order delivery date, delivery Scheduled Date, MO Deadline [V] | Calendar days, company-wide security lead time only [V] | A late MO shows its Deadline in red. Shop Floor cards have no late style [V] | Not found |
| MRPeasy | One delivery date per order and per line, the ship date [V] | Not found | Line status: on time, will be late, ready, shipped. A "Late CO" widget [V] | "Deliveries on time %" compares the pick date with the delivery date, so it measures shipping [V] |
| Katana | MO production deadline and delivery deadline [V] | Not found | The schedule sorts by priority, not by date [V] | Not found |
| Fulcrum Pro | A ship-by date on the sales order [V] | Not found | "Ready to ship" goes to the order with the highest priority and the closest ship-by date [V] | Not found |
| ProShop | Delivery dates on the customer PO. Scheduling calculates the date a work order must leave [V, snippet] | Not found | Dashboards list late jobs and jobs the schedule shows as late [V, blog] | Marketing quotes rates above 95% [V] |
| JobBOSS², E2, Global Shop, Plex, Paperless Parts | Due dates and scheduled end dates [V, marketing] | Plex had a "customer transit calendar" in an old article [V, old] | Dispatch lists [V, snippet] | Global Shop lists an on-time shipping report [V, snippet] |

Findings:

1. Only Epicor confirms three separate dates: arrive, ship and job. Carbon's design matches it.
2. No competitor stores transit days per shipping method. Epicor stores them per customer and Ship To.
3. No competitor shows a ship countdown on the shop floor. Epicor users build one themselves.
4. No competitor records the actual delivery date or measures carrier accuracy.

## 8. Tracking events for a later integration

| Provider | Delivered signal | Timestamp |
|----------|------------------|-----------|
| EasyPost | Tracker `status = "delivered"` in a `tracker.updated` event | `tracking_details[].datetime` of the delivered entry |
| Shippo | `tracking_status.status = "DELIVERED"` in a `track_updated` event | `tracking_status.status_date` (UTC) |
| ShipStation API | `status_code = "DE"` in an `API_TRACK` event | `actual_delivery_date` (ISO 8601) |

All three rows are [V]. Shippo webhooks can repeat, so a handler must ignore a repeat. So the data model needs a delivered date and its source (Manual or Carrier). A carrier event arrives in UTC, so the handler converts it to the company's local date.

## Recommendation for Carbon

1. Store transit days on the shipping method, in business days. Let the customer ship-to override it, because transit depends on the destination.
2. Keep two dates, like every ERP above: the line ship date and the order arrive date.
3. Count business days on one calendar: Monday to Friday, minus the company holidays. Skip non-working days while counting.
4. Record the actual delivery date and its source (Manual or Carrier) on the posted shipment.
5. Measure 2 rates per shipping method: delivered by the estimate (carrier accuracy) and delivered by the arrive-by date (OTD). An early delivery counts as on time.
6. Show the ship countdown on the shop floor. No competitor has it.
7. Add a carrier API later. EasyPost first (one key, three carriers, `ship_on_date`). UPS Time in Transit second.

## Sources

- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-date-calculation-for-sales
- https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-to-calculate-order-promising-dates
- https://learn.microsoft.com/en-us/dynamics365/business-central/across-how-to-assign-base-calendars
- https://github.com/StefanMaron/MSDyn365BC.Code.History (SalesLine.Table.al, CalendarManagement.Codeunit.al)
- https://blog.sap-press.com/delivery-scheduling-and-transportation-scheduling-in-sap-s4hana
- https://www.epiusers.help/t/kinetic-2024-1-feature-preview-delivery-days/110107
- https://www.cybrosys.com/blog/how-to-manage-the-delivery-lead-time-in-odoo-18
- https://www.vsimple.com/knowledge-base/netsuite-estimated-and-actual-ship-date
- https://docs.easypost.com/docs/smartrate
- https://docs.goshippo.com/api-reference/rates
- https://docs.shipstation.com/apis/shipengine/openapi/rates/estimate_rates.md
- https://developer.ups.com/api/reference?loc=de_AT&tag=Time-in-Transit
- https://developer.fedex.com/api/en-us/catalog/service-availability/docs.html
- https://developers.usps.com/standardsv3
- https://www.smc3.com/carrierconnect.htm
- https://help.sap.com/saphelp_46c/helpdata/en/c4/13c0da0f9011d3b47f006094b9b9dd/content.htm
- https://userapps.support.sap.com/sap/support/knowledge/en/3720996
- https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.sales.history.sales-shipment-line
- https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/delivery-dates-available-promise-calculations
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1229796.html
- https://www.odoo.com/forum/help-1/how-is-the-vendor-on-time-rate-calculated-182460
- https://www.epiusers.help/t/on-time-delivery-report/60185
- https://www.mckinsey.com/capabilities/operations/our-insights/defining-on-time-in-full-in-the-consumer-sector
- https://versalift.freshdesk.com/support/solutions/articles/31000177086-date-fields-in-epicor
- https://www.epiusers.help/t/work-queue-prioritization/131632
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/reporting/delayed.html
- https://www.mrpeasy.com/resources/user-manual/dashboard/
- https://support.katanamrp.com/en/articles/151-using-the-schedule
- https://fulcrumpro.com/product-update/shipping-status-update
- https://proshoperp.com/better-shop-floor-scheduling/
- https://www.globalshopsolutions.com/pdfs/product-sheets/shipping.pdf
- https://www.supplychainbrain.com/articles/7138-plex-systems-enhances-mrp-functionality
- https://docs.easypost.com/docs/trackers
- https://docs.goshippo.com/docs/tracking/tracking
- https://docs.shipstation.com/apis/shipengine/docs/reference/webhooks-schemas
