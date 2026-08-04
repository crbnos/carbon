# EDI Support Research: Best Practices Survey

## Summary

Surveyed how enterprise and mid-market ERPs implement EDI (X12/EDIFACT exchange of
orders, acknowledgments, ASNs, and invoices), how modern API-first EDI platforms
(Stedi, Orderful) and managed networks (SPS Commerce, TrueCommerce, Cleo) divide the
work, and what the standards themselves require (envelopes, control numbers, 997
acknowledgment reconciliation, partner implementation guides). The strongest
consensus: **no modern ERP builds or maintains its own translator + partner-map
ecosystem** — retail EDI is a compliance treadmill (SPS alone absorbs ~9,000 retailer
spec changes per year) — but the ERP must own the parts a provider cannot: trading
partner records, document-to-record mapping, item/location cross-references, the
review/exception queue, ASN generation from real shipment data, and the status
lifecycle. Parsing X12 is roughly 10% of the problem; partner-specific validation,
acknowledgment tracking, control numbers, transport (AS2/SFTP/VAN), and certificate
management are the other 90% and are exactly what providers sell. The sell-side flow
(inbound 850 → sales order; outbound 855/856/810) is what trading partners *mandate*;
buy-side EDI is voluntary and rare in the mid-market. Automotive release accounting
(830/862, cumulative quantities, scheduling agreements) is a distinct, much deeper
model that should be phased separately.

## Competitors Surveyed

- **SAP S/4HANA** — the enterprise reference: IDoc architecture, partner profiles,
  status lifecycles, Integration Suite Trading Partner Management, automotive
  scheduling agreements.
- **NetSuite** — the pure-ecosystem pattern: zero native EDI; certified providers
  (SPS, TrueCommerce, Celigo, B2BGateway) do translation/connectivity; the ERP owns
  records and workflow.
- **Epicor Kinetic** — acquired a provider (1 EDI Source) for the pipe; its
  differentiated piece is the in-ERP Demand Management workflow (contracts →
  schedules → orders, Demand Workbench for exceptions).
- **Plex** — native vertical EDI: proof that owning EDI in-ERP wins when the partner
  universe is bounded (automotive OEMs) and the value is tight coupling of
  release → CUM → ship → ASN → label.
- **Stedi / Orderful / Cleo / TrueCommerce / SPS Commerce** — the provider landscape
  an embedded EDI feature would build on or compete with.

## Key Consensus Patterns

### 1. The trading partner profile is the central entity — not the transaction set

- **SAP**: partner profile (WE20) / TPM Trading Partner Agreements: per partner, per
  message type, per direction — IDs with qualifier schemes, structure version,
  transport channel, ack behavior, error-routing owner.
- **Stedi**: "Partnership" = connection + transaction settings + guide + ack config.
- **Epicor**: per-partner acceptance rules ("Always Accept" vs "Accept If No Errors").
- **Standards reality**: the base X12 spec is deliberately generic; every large buyer
  publishes an implementation guide that constrains it. "Supporting the 850" really
  means supporting N partner-specific variants. Per-partner configuration (IDs +
  qualifiers, version, transport, ack policy, doc set, test/prod flag) **is** the
  core data model.
- **Rationale**: partner variance is the irreducible complexity of EDI; every mature
  system converges on partner-centric config.

### 2. Rent the translator and the pipe; own the mapping and the workflow

- **NetSuite**: no native EDI at all; providers own translation, connectivity, maps,
  partner certification. ERP owns order/fulfillment/invoice records + exception UX.
- **Epicor**: bought the provider, still runs it as a semi-detached unit; user
  sentiment says acquisition ≠ integration (billed PS hours for AS2 cert rotations).
- **Build-vs-buy consensus**: OSS JS parsers (node-x12, x12-parser, node-edifact)
  cover syntax only, are thinly maintained, and provide none of the chargeback-
  preventing layer (partner guides, ack reconciliation, control numbers, AS2 certs,
  VAN interconnects). AS2 operational pain is notorious (silent cert expiry).
- **Plex exception**: native works when the partner set is small, shared across the
  customer base, and brutal about compliance (automotive).
- **Rationale**: translation/connectivity is undifferentiated compliance work with
  brutal maintenance economics; document workflow and ERP record mapping is the
  differentiated part only the ERP can do.

### 3. Inbound documents land in a staging/review queue with an explicit status lifecycle

- **SAP**: every message is persisted (IDoc) with an append-only status history;
  errors are resumable states worked as queues (BD87 cockpit); terminal-success (53),
  resumable-error (51), terminal-dead (68). Editing a message archives the original.
  The *preferred* fix is "correct the master data, reprocess the unchanged message."
- **Epicor**: Demand Workbench for correcting errored inbound demand; per-partner
  auto-accept rules.
- **Industry pattern**: neither blanket auto-create nor blanket reject. Clean orders
  flow straight to sales orders; dirty orders hold for review (statuses: failed /
  rejected / accepted-with-errors / delayed). Silent drop into a failed batch is the
  named anti-pattern.
- **Rationale**: the message is legal/commercial evidence and must be kept verbatim;
  errors are usually ERP-side data gaps (missing cross-reference), so reprocessing
  the untouched message after fixing data is safer than editing the message.

### 4. Resolution is table-driven cross-referencing, per partner

- **SAP**: EDPAR (external partner/ship-to code ↔ internal customer, per sender),
  EDSDC (partner → org context + order type), customer-material info records.
- **Epicor/Cetec**: dedicated customer part cross-reference; EDI demand processing
  resolves inbound lines through it; outbound docs echo the *buyer's* part numbers
  and location codes back.
- **Resolution ladder**: per-customer part cross-ref → UPC/GTIN fallback → internal
  part → exception queue, where the operator's fix *persists a new cross-reference*.
- **Ship-to codes**: buyers send their own location codes (N1*ST qualifier 92, or
  DUNS); seller maintains a location-code cross-reference or orders stall at
  shipping.
- **Rationale**: cross-references turn recurring manual fixes into one-time setup;
  the exception queue is where the tables get built organically.

### 5. Documents map 1:1 to ERP records, generated from the real transaction

| EDI doc | Direction (sell-side) | ERP record | Trigger |
|---|---|---|---|
| 850 PO | inbound | Sales Order (via review queue) | partner sends |
| 855 PO Ack | outbound | from Sales Order | order accepted/reviewed (24h SLA typical) |
| 860 PO Change | inbound | Sales Order update (review) | partner sends |
| 856 ASN | outbound | from Shipment | ship/post — after truck leaves, before it arrives |
| 810 Invoice | outbound | from Sales Invoice | invoice posted (often 24h SLA) |
| 997 FA | both | status update on the doc, not a record | automatic |

- **Universal rule**: 855/856/810 must be generated from one shared order record so
  pricing/quantities cannot drift; the 856 must be generated from **actual pick/pack
  /ship data at ship-confirm**, never from the order (stale-ASN is the classic
  chargeback bug).
- **SAP/NetSuite/Epicor/Plex** all agree on this mapping; Plex sends the ASN
  automatically when the ship transaction posts.

### 6. Acknowledgments are status updates with SLA timers, not documents

- **SAP**: inbound 997 becomes a status record on the outbound IDoc (status 16).
- **Standards**: outbound side must send a 997 for every inbound group (typically
  within 24h — contractual at many retailers) and must reconcile a 997 for every
  outbound group (match on the group control number), alerting on timeout or
  rejection. A silently rejected 810 never gets paid ("revenue leakage").
- **Providers**: Stedi/Orderful auto-generate inbound 997s; the ERP still needs the
  outbound-ack state machine surface (sent → acknowledged/rejected/timeout).

### 7. Control numbers and dedup are the ERP's ledger even when a provider envelopes

- ISA13 (interchange), GS06 (group), ST02 (transaction) — incrementing counters per
  partner relationship, persisted, echoed back in acks for reconciliation; receivers
  dedup on repeated ISA13.
- **Caveat (Stedi)**: when a platform re-envelopes, wire control numbers are not
  yours — correlate on the platform's transaction IDs instead, but keep your own
  idempotency keys.

### 8. The ASN requires a packaging hierarchy the order model doesn't have

- 856 HL structures (Shipment→Order→Tare→Pack→Item and variants) are dictated per
  partner. Pick-and-pack ASNs require knowing which items and quantities are in
  which carton; each carton/pallet gets an SSCC-18 license plate printed as a
  GS1-128 label that must match the ASN's MAN segment exactly — scan-based receiving
  depends on it, and label↔ASN mismatch is the #1 chargeback source (fines $50–$1,000
  per violation; Walmart OTIF at 3% of PO value).
- Simplest compliant variant (SOI: shipment→order→item, no packaging detail) is
  accepted by some partners; retail generally demands carton-level detail.

### 9. Automotive release accounting is a separate, deeper model

- **SAP/Plex/Oracle/QAD**: scheduling agreements (blanket per customer-part+ship-to,
  price fixed once), releases *replace* the forward schedule rather than appending,
  dual horizon (830/DELFOR forecast feeds MRP; 862/DELJIT firm feeds shipping), and
  a cumulative-quantity ledger (customer CUM required/received vs supplier CUM
  shipped, in-transit netting, high-water authorization for cancellation claims, CUM
  resets at model year). CUM discrepancies raise warnings, never auto-correct.
- Discrete-PO order models cannot represent this. It is the defining automotive-ERP
  capability (why suppliers buy Plex/QAD) and a natural later phase.

## Answers to Research Questions

1. **Minimal viable transaction set** — 850 + 855 + 856 + 810 + 997 is the
   near-universal starter set mandated by retail/industrial buyers (Amazon Vendor
   Central's basics are exactly these). Next additions in practice: 860/865
   (changes), 846 (inventory, drop-ship), 940/945 (3PL). Automotive instead runs
   830 (+862) inbound → 856 outbound with invoicing often replaced by ERS/self-bill.
2. **Data model** — trading partner profile (IDs + qualifier schemes, doc set,
   version/guide, transport, ack policy, test/prod), a persisted document/transaction
   record with raw payload + append-only status history + link to the ERP record,
   per-partner cross-reference tables (parts, ship-to locations), control-number
   counters, and an ack-reconciliation state machine (SAP, Stedi, standards research
   all agree).
3. **Architecture** — mid-market consensus is ERP + embedded provider. Managed
   networks (SPS/TrueCommerce) suit no-IT customers but are ticket-driven black
   boxes; API-first platforms (Orderful ~$189/partner/mo unlimited docs, Stedi
   pay-per-transaction) are built to be embedded by SaaS platforms and expose
   JSON in/out with webhooks. Building a translator in-house is uniformly
   discouraged (OSS JS parsing is thin; the hard 90% is partner variance + ops).
4. **Lifecycle** — inbound: received → validated/translated (provider) → staged →
   matched/resolved → posted to ERP record, with resumable error states and
   reprocess-after-data-fix; outbound: generated → transmitted → acknowledged /
   rejected / timeout, with SLA timers. Success states get archived; error states
   are worked as queues (SAP status model, Epicor Workbench, Celigo dashboards).
5. **Partner-specific requirements** — handled via machine-readable implementation
   guides (Stedi Guides, SAP MIG/MAG) or provider-maintained maps (SPS/Orderful
   network). 004010 remains the dominant commercial version; the partner dictates
   version, structure, transport, and ack policy, so all of it is per-partner config.
6. **Transport** — big-box retail requires AS2 (or a VAN speaking AS2 for you);
   mid-market/3PL commonly SFTP; Europe adds OFTP2/EDIFACT. Providers absorb all of
   this; an embedded integration only needs the provider's HTTPS API + webhooks.
7. **Document↔record mapping** — see consensus pattern 5; buy-side (outbound 850 to
   suppliers, inbound 855/856/810, three-way match) is the same machinery reversed
   but adoption is partner-by-partner and rare in the mid-market (supplier
   enablement is the binding constraint; web-EDI portals routinely fail on
   adoption). Sell-side first is the unanimous ordering.
8. **Manufacturing-specific flows** — 830/862 with CUM accounting (pattern 9), HL
   pack hierarchies + SSCC-18/GS1-128 labels for the 856 (pattern 8), AIAG labels in
   automotive; retailer compliance programs (Walmart SQEP/OTIF, Target, Amazon)
   monetize ASN/label errors, so ASN-from-actual-ship-data and label/ASN coherence
   are the two things an ERP must get structurally right.

## Competitor-Specific Details

### SAP
- Message type vs structure version split (ORDERS vs ORDERS05) let SAP evolve
  structures for 30 years without breaking partners — worth copying as
  `documentType` + `version`.
- Status numerology (51/53/68), config scattered across a dozen transactions, and
  misnamed fields (external ID in `LIFNR`) are the named anti-patterns; modern TPM
  collapses config into one partner-centric object with agreements.
- Per-partner-per-message "post-processing agent" routes failures to a named
  business owner, not a shared IT queue; the workflow-inbox-flood failure mode is
  documented (KBA 2164759) — prefer queue/monitor with mass actions (AIF model).

### NetSuite ecosystem
- Certified-provider division of labor; provider dashboards for wire-level status,
  ERP-side workflows for business-level exceptions. Managed caveat: map changes go
  through provider support tickets.

### Epicor
- Demand Management: demand contracts per customer → schedules → firm/unfirm sales
  order releases or forecasts; Demand Workbench + per-partner Accept rules is the
  best mid-market exception-UX reference. Automotive CUM support is effectively
  third-party (AutoCOR) — evidence the automotive layer is genuinely hard.

### Plex
- Native EDI module: partners, mailboxes, documents; ASN + 810 transmit
  automatically on ship; AIAG labels and release accounting in one flow. The
  benchmark for "EDI as an ERP feature, not a bolt-on."

### Stedi
- The cleanest embed contract: partnership + guide → JSON in/out, webhook
  `transaction.processed`, POST to generate outbound with auto control numbers +
  auto 997s. **Risk**: GTM has pivoted hard to healthcare clearinghouse (Series B
  Sept 2025); the B2B/retail platform persists but isn't where investment goes.
- Free published guide catalog (Walmart, Home Depot, etc.) is a useful reference
  regardless of provider choice.

### Orderful
- Explicit "Embedded EDI for SaaS platforms" product: one API, pre-connected
  network (10k+ partner guidelines), partner-specific validation before send
  (chargeback prevention), ~$189/partner/mo unlimited documents, onboarding in
  days. The strongest candidate for a Carbon-embedded provider on paper.

## Recommended Approach for Carbon

1. **Own the workflow, rent the wire (NetSuite/Plex hybrid).** Build the in-ERP
   surface Plex proves valuable — trading partner records, document staging +
   status lifecycle, exception queue, ASN-from-shipment, cross-references — and
   integrate an API-first provider (Orderful-style; abstract the provider the same
   way `packages/ee/src/accounting` abstracts Xero/QBO/Rillet) for translation,
   validation, connectivity, and 997 generation. Do not write or adopt an X12
   parser as the foundation.
2. **Phase 1 = sell-side minimal set**: inbound 850 → staged EDI document → review
   queue (auto-release when clean, per-partner setting à la Epicor) → sales order;
   outbound 855 from order acceptance; outbound 856 on shipment post; outbound 810
   on sales invoice post; ack status tracking with timers. This is what customers'
   trading partners mandate and what wins deals.
3. **Data model** (SAP-lessons applied, readable states, one partner-centric
   object): `ediTradingPartner` (linked to customer, IDs live in
   `externalIntegrationMapping`), `ediDocument` (direction, type, version, raw +
   JSON payload, status: received/staged/needs_review/posted/sent/acknowledged/
   rejected/failed, append-only events, link to SO/shipment/invoice), per-partner
   doc enablement + auto-release flag. Reuse `customerPartToItem` for part
   cross-refs; add a ship-to location cross-reference.
4. **Reuse existing Carbon rails**: `defineIntegration` registry +
   `companyIntegration.metadata` for provider credentials; webhook route →
   Inngest job ingress (Xero/Jira pattern) for inbound documents; hook outbound
   generation into PO-finalize-style branches on shipment/invoice post.
5. **Defer but don't preclude**: 860/865 changes, buy-side EDI (outbound 850 —
   natural branch in the existing PO finalize route), 846/940/945, and the
   automotive 830/862 + CUM + scheduling-agreement model (a separate spec; requires
   a blanket-order/release concept Carbon doesn't have).
6. **ASN packaging**: Carbon has no carton/pallet model — the spec must decide
   between a minimal SOI-structure ASN first (works for many industrial partners)
   vs. building carton-level packing (required for retail compliance + GS1-128
   labels). Recommend minimal first with the packing model designed as the fast
   follow, since label↔ASN coherence is where chargebacks live.

## Sources

### Standards
- https://www.stedi.com/edi/x12/transaction-set/850 · /856 · /997 · /999
- https://www.stedi.com/edi/x12/segment/ISA
- https://www.stedi.com/blog/control-numbers-in-x12-edi
- https://www.stedi.com/blog/getting-started-with-the-x12-file-format
- https://www.stedi.com/edi/edifact
- https://x12.org/examples
- https://ediacademy.com/blog/x12-key-standards-2026-updates/
- https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-enterprise-integration-x12-ta1-acknowledgment
- https://www.orderful.com/blog/retailer-edi-compliance-steps
- https://www.boldvan.com/blog/amazon-edi-requirements-for-vendor-central-teams-850-855-856-810-and-997-basics
- https://www.boldvan.com/blog/edi-997-reconciliation-how-to-automate-acknowledgment-tracking-and-stop-revenue-leakage
- https://edicomgroup.com/blog/edi-integration-oem-tier-automotive
- https://www.seeburger.com/resources/good-to-know/ansi-x12-edi-830-planning-schedule-message
- https://www.drummondgroup.com/services/as2-testing-and-certification/
- https://www.astera.com/type/blog/edifact-vs-x12

### SAP
- https://www.guru99.com/all-about-idocdefinition-architecture-implementation.html
- https://sap4tech.net/mapping-edi-code-message-types-sap/
- http://sapbasiskishore.blogspot.com/2014/09/idoc-status-codes-and-reprocess-reports.html
- https://ecosio.com/en/blog/reprocessing-idocs-in-sap-erp/
- https://mdpgroup.com/en/blog/trading-partner-management-tpm/
- https://help.sap.com/docs/integration-suite/isuite-trading-partner-management/trading-partner-management
- https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/sap-erp-functionality-for-edi-processing-partner-determination-for-inbound/ba-p/13717698
- https://www.dataxstream.com/blog/sap-idoc-sales-area-cross-reference/
- https://mdpgroup.com/en/blog/what-is-the-sap-application-interface-framework-aif/
- https://learning.sap.com/courses/describing-sap-for-automotive-supply-chain-and-manufacturing/listing-key-features-of-sales-scheduling-agreements-in-sap
- https://community.sap.com/t5/enterprise-resource-planning-q-a/cumulative-quantities-on-sched-agreement-forecast-in-inbound-idoc-delfor/qaq-p/8386018

### Mid-market ERPs
- https://www.brokenrubik.com/blog/netsuite-edi-integration-guide
- https://www.spscommerce.com/products/fulfillment/integrated-fulfillment/system-integrations/netsuite-2/
- https://www.truecommerce.com/integrations/erp/netsuite/edi/
- https://www.businesswire.com/news/home/20240827558786/en/Celigo-Launches-B2B-Manager-to-Simplify-Self-Service-EDI-Management
- https://www.epicor.com/en-us/newsroom/news-releases/epicor-acquires-electronic-data-interchange-edi-solution-provider-1-edi-source/
- https://tomerlin-erp.com/edi-demand-management/
- https://www.epiusers.help/t/epicor-edi-professional-services-charges/136598
- https://www.aimcom.com/aim-autocor/
- https://www.yumpu.com/en/document/view/22984096/electronic-data-interchange-edi-plex-systems
- https://www.erpresearch.com/compare/infor-cloudsuite-vs-plex-for-automotive
- https://www.boldvan.com/blog/plex-smart-manufacturing-platform-offers-edi-connectivity-via-bold-van
- https://graceblood.com/blog/best-practices-for-erp-providers-integrating-third-party-edi/

### Providers / build-vs-buy
- https://www.stedi.com/docs/edi-platform/getting-started
- https://www.stedi.com/docs/edi-platform/guides/what-is-a-stedi-guide
- https://www.stedi.com/docs/api-reference/edi-platform/post-transactions
- https://www.stedi.com/pricing
- https://www.healthcareittoday.com/2025/09/09/announcing-stedis-70-million-series-b-to-build-the-only-ai-enabled-clearinghouse/
- https://www.orderful.com/product/platform
- https://www.orderful.com/solutions/saas-platforms
- https://www.orderful.com/blog/edi-pricing-guide
- https://getfoundational.com/best-managed-edi-providers/
- https://www.cleo.com/cleo-integration-cloud
- https://intuitionlabs.ai/articles/x12-edi-vendors-startups
- https://news.ycombinator.com/item?id=29822773
- https://www.npmjs.com/package/node-x12
- https://github.com/tdecaluwe/node-edifact
- https://michaelachrisco.github.io/Electronic-Interchange-Github-Resources/

### Manufacturing workflows / compliance
- https://www.stacksync.com/blog/edi-850-855-856-automation
- https://ediacademy.com/blog/856-asn-mapping-hl-segment/
- https://hub.acctivate.com/articles/edi-advance-ship-notice-856-pick-and-pack-file-structure
- https://www.ediwerx.com/856-series-asn-hierarchical-structures/
- https://ediacademy.com/blog/gs1-128-sscc-18-labels-edi-guides/
- https://www.crstl.ai/blog/walmart-edi-requirements-the-complete-2026-guide
- https://blog.inymbus.com/amazon-asn-workflow-compliance-and-chargeback-prevention
- https://getproductiv.com/target-compliance-asn-accuracy
- https://docs.oracle.com/cd/E18727_01/doc.121/e16351/T414584T414595.htm
- https://ps.nafta.extra.fcagroup.com/sites/itb-ebus/Shared%20Documents/862ShippingSchedule.pdf
- https://www.cetecerp.com/support/how-to/how-to-create-cross-part-references-customer-parts-vendor-parts-mfg-part-numbers/
- https://ecosio.com/en/blog/web-edi-portals-supplier-adoption/
- https://www.boldvan.com/blog/edi-855-purchase-order-acknowledgment-codes-how-to-confirm-change-or-reject-a-po
- https://www.orderful.com/blog/edi-856-guide-reducing-errors-and-optimizing-packing
