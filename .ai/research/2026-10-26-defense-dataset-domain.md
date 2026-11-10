# Defense sUAS demo dataset: domain research

Date: 2026-10-26. Scope: the data an ERP/MES demo needs for a small US maker of Group 1–2 military drones (sUAS = small uncrewed aircraft systems). The goal: a person from Costpoint, IFS A&D, SAP A&D or Epicor at a defense contractor reads the demo as real.

How to read this:
- Each point has its source URL(s). Most are secondary (law firms, vendors, trade press). I mark primary sources (acquisition.gov, Federal Register, army.mil, Deltek help) as **[primary]**.
- Lines marked **(inference)** are my own reasoning for the demo, not something a source says.
- Every section ends with **ERP mapping**: what to seed as items, BOM lines, customers, suppliers, orders, jobs, inspections, NCRs, documents or attributes.
- This file recommends no real company names for seeding. It names real programs and rules only so the invented data matches them.

---

## 0. Baseline facts that frame the whole dataset

- **Group 1 / Group 2 definitions.** Group 1 = 0–20 lb max takeoff weight, under 1,200 ft AGL, under about 100 kt. Group 2 = 21–55 lb, under 3,500 ft AGL, under 250 kt. Exceeding any one limit puts the aircraft in the higher group. [globalsecurity UAV classes](https://www.globalsecurity.org/intell/systems/uav-classes.htm), [Penn State GEOG 892](https://courses.ems.psu.edu/geog892/node/637)
- **July 10, 2025 "Unleashing U.S. Military Drone Dominance" memo.** Group 1 and 2 drones are to be "accounted for as consumable commodities, not durable property". Buying authority goes down to O-6 (colonel) commanders. The memo also rescinds the 2021 guidance implementing NDAA Sec. 848. [memo PDF](https://static.foxnews.com/foxnews.com/content/uploads/2025/07/unleashing-u.s.-military-drone-dominance-osd006689-25-res-final.pdf), [Breaking Defense](https://breakingdefense.com/2025/07/hegseth-signs-unleashing-us-military-drone-dominance-memo/), [Defense One](https://www.defenseone.com/policy/2025/07/drones-are-now-bullets-how-new-pentagon-policy-may-accelerate-robot-warfare/406686)
  - (inference) This explains why real sUAS orders are high-volume and repeat, and come as delivery orders or card buys rather than big one-off programs. A demo with orders for dozens to hundreds of units plus a steady spares flow looks right.
- **Blue UAS moved to DCMA.** The Blue UAS Cleared List is moving from DIU to DCMA (bluelist.dcma.mil). One trade report says the move happened Dec 3, 2025, with a "Cleared" tier and a narrower "Select" tier. [DIU framework page](https://www.diu.mil/blue-uas/framework) **[primary]**, [DefenseScoop](https://defensescoop.com/2025/11/20/dod-drones-blue-uas-list-chinese-parts-motors/), [Unmanned Aerial Online](https://unmanned-aerial.com/blue-uas-green-uas-ndaa-compliant-what-each-list-certifies/)

---

## 1. Compliance concepts that show up as ERP data

### 1.1 Export jurisdiction: ITAR/USML vs EAR/ECCN

- **USML Category VIII (aircraft).** Military UAVs on the list stay under ITAR. VIII(a)(5) covers unarmed military UAVs that are "specially designed to incorporate a defense article", and these count as Significant Military Equipment. VIII(h)(12) covers UAV flight control / vehicle management systems with swarming capability. [Ginger Control](https://gingercontrol.com/blog/drone-uas-eccn-itar), [learnexportcompliance](https://learnexportcompliance.com/insights/bis-streamlining-export-controls-for-drone-exports)
- **ECCN 9A610.a (EAR "600-series").** Military aircraft "specially designed" for military use but not listed in USML VIII(a). The Aug 2026 rule says this explicitly includes UAVs and RPVs "regardless of origin or designation". A non-USML UAV built for a military customer with at least one military-only feature "should be reviewed for control under 9A610.a". [Federal Register 2026-16628, 91 FR 52501](https://www.govinfo.gov/content/pkg/FR-2026-08-14/html/2026-16628.htm) **[primary]**
- **ECCN 9A610.y.33 (new, Aug 13 2026).** "Brackets, carrying cases, controllers, cables and adapters, chargers, docks, mounts, propellers, propeller systems, and propeller blades for UAVs and RPVs described in 9A610.a." [FR 2026-16628](https://www.govinfo.gov/content/pkg/FR-2026-08-14/html/2026-16628.htm) **[primary]**, [Baker McKenzie](https://sanctionsnews.bakermckenzie.com/united-states-streamlines-drone-export-controls-while-imposing-new-section-232-tariffs-on-drone-imports/)
- **ECCN 9A012 (civil UAVs flown beyond the operator's natural sight).** The endurance threshold went from "1 hour or greater to 3 hours or greater", so shorter-endurance UAVs are now AT1 (anti-terrorism) only. Carrying controlled thermal imaging (6A003), lasers (6A005) or inertial equipment (7A) pulls the drone back into tighter control. [FR 2026-16628](https://www.govinfo.gov/content/pkg/FR-2026-08-14/html/2026-16628.htm) **[primary]**, [Ginger Control](https://gingercontrol.com/blog/drone-uas-eccn-itar)
- **USML Category XII (fire control, imaging, guidance).** Covers IR focal plane arrays and imaging systems for military use (XII(c)). An IRFPA that is part of a commercial system moves to the EAR (6A002/6A003). Deltek's Costpoint help ships a full XII sub-category table. [Deltek Costpoint USML Cat XII](https://help.deltek.com/Product/Costpoint/8.0/GA/PDMUSML_CAT_12.htm) **[primary for the software]**, [Akin Gump on XII](https://www.akingump.com/en/insights/alerts/ddtc-and-bis-request-comments-on-additional-proposals-for)
- **USML Category XI (military electronics).** Revised in 2014. I did not get the current XI(a) text. [FR 2014-14681](https://www.govinfo.gov/content/pkg/FR-2014-07-01/html/2014-14681.htm)
- **Encrypted radios.** Radios using cryptography with keys over 56 bits fall under 5A002, unless they qualify as mass-market 5A992.c or the encryption is "ancillary" (Note 4). [BIS encryption](https://www.bis.gov/node/6956), [Steptoe](https://www.steptoe.com/en/news-publications/significant-update-to-us-encryption-export-rules-and-other-commerce-control-list-changes.html)
- **ITAR registration.** Anyone who *manufactures* defense articles must register with DDTC (22 CFR 122.1), even if they never export. Licenses: DSP-5 (permanent export), DSP-73 (temporary export), DSP-61 (temporary import). Agreements: TAA and MLA (22 CFR 124). [CRS IF11441](https://www.everycrsreport.com/files/2026-01-20_IF11441_d96497e5008705b7ac0085ddd9309067bf1592b5.html)
- **Deemed export / proscribed countries.** Releasing ITAR technical data to a foreign person inside the US counts as an export (22 CFR 120.50). China (including Hong Kong) is under a policy of denial (126.1). [Cornell 22 CFR 120.50](https://www.law.cornell.edu/cfr/text/22/120.50), [Cornell 22 CFR 126.1](https://www.law.cornell.edu/cfr/text/22/126.1), [Williams Mullen](https://www.williamsmullen.com/news/important-itar-amendments-additions-list-proscribed-countries)
- **How a real defense ERP stores this (proof it's expected).** Costpoint's Manage Parts → Export Control subtask has these fields: "Export Control" (None / ITAR / EAR / EAR99 / NLR), "USML Category", "USML Sub-category", "Significant Military Equipment" checkbox, "USML" code, "ECCN", and five user-defined export labels. [Costpoint Export Control subtask](https://help.deltek.com/PRODUCT/COSTPOINT/8.2/GA/PDMPART_Export_Control_Subtask.html) **[primary]**
  - Costpoint also has a Manage Licenses/Agreements screen. Its line detail carries Part/Rev, Export Control, USML, ECCN, Mil-Spec, NSN, Article Type (Hardware / Technical Data), Quantity, Unit Price and Line Amount. [Costpoint Licenses/Agreements Details](https://help.deltek.com/PRODUCT/COSTPOINT/8.1/GA/PDMLICAGR_Details_Subtask.html) **[primary]**

**ERP mapping**
- Item attributes: `exportJurisdiction` (ITAR / EAR / EAR99 / NLR), `usmlCategory` + `usmlSubcategory` (e.g. VIII(h)), `eccn` (e.g. 9A610.a, 9A610.y.33, 5A002, 9A012), `significantMilitaryEquipment` (bool), `classificationBasis` (self-classified / CJ / CCATS), `classifiedOn`.
- Plausible demo classifications **(inference, not legal advice)**:
  - Military-configured air vehicle → 9A610.a.
  - Its charger, transit case, propellers and controller → 9A610.y.33.
  - Encrypted mesh radio module → 5A002 (or 5A992.c).
  - Thermal core → 6A003 (or XII(c) if military-only).
  - Drawings / tech data package → technical data under the matching "E" entry.
  - Commercial-derived trainer variant → 9A012 (AT1).
  - A Group 2 variant "specially designed to incorporate a defense article" → USML VIII(a)(5), SME = true.
- Export license record (a document or custom entity): license type (DSP-5 / DSP-73 / BIS license / TAA), number, issue/expiry, authorized value and quantity, end user, country, and the item lines it covers. Link it to the sales order lines of a foreign sale.
- Company setting: ITAR registration number and expiry (a document under company records).
- Employee/user attribute: `usPerson` (bool), used to gate access to ITAR drawings **(inference)**.

### 1.2 CUI, NIST SP 800-171, CMMC, DFARS 252.204-7012

- DFARS 252.204-7012 has required the 110 NIST SP 800-171 controls for systems holding CUI (Controlled Unclassified Information) since 2017. CMMC Level 2 uses those 110 controls. [DoD CIO CMMC About](https://dodcio.defense.gov/cmmc/About) **[primary]**, [Secureframe](https://secureframe.com/cmmc-2-0)
- CMMC timeline: the 32 CFR 170 rule took effect Dec 16, 2024. The 48 CFR / DFARS 252.204-7021 contract rule took effect Nov 10, 2025, and Phase 1 (self-assessment) started then. One source says DoD paused Phases 2–4 on July 13, 2026 pending review; I could not verify that. SPRS score reporting still applies. [Secureframe](https://secureframe.com/cmmc-2-0), [RSI Security](https://blog.rsisecurity.com/cmmc-compliance-timeline-for-small-to-medium-dod-contractors/)
- CUI marking: the NARA registry gives the export-controlled banner as `CUI//SP-EXPT`. DoD practice puts only "CUI" in the banner and the category in a Designation Indicator block on page 1. [NARA CUI Export Control](https://www.archives.gov/cui/registry/category-detail/export-control) **[primary]**, [USMC CUI tips](https://www.hqmc.marines.mil/Portals/61/Docs/HQSVCBN%20Henderson%20Hall/Security/Resources/CUI-Quick-Marking-Tips.pdf)
- Technical documents also carry a DoDI 5230.24 Distribution Statement (A–F) plus an Export Control Warning when they hold export-controlled data. Distribution C = US Government agencies and their contractors; D = DoD and DoD contractors only. [DoDI 5230.24](https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/523024p.pdf) **[primary]**, [DTIC marking guide](https://discover.dtic.mil/wp-content/uploads/2023/02/GuideToMarkingDocuments_2023.pdf)

**ERP mapping**
- Document attributes on drawings, specs and test procedures: `cuiMarking` (e.g. CUI, category EXPT), `distributionStatement` (A–F + reason + determination date), `exportControlWarning` (bool).
- Company/supplier attributes: `sprsScore` and date, `cmmcLevel` (self or C3PAO) and date, `dfars7012FlowedDown` (bool) on the supplier.
- Purchase order notes / terms: flow-down clauses (252.204-7012, 252.225-7052, 252.246-7008, 52.204-25) as standard PO terms. This is what an ex-Costpoint user expects to see on a PO **(inference)**.

### 1.3 Sourcing restrictions: NDAA 848, ASDA, Blue UAS, Section 889, batteries, magnets, specialty metals

- **FY2020 NDAA Sec. 848.** Bars DoD from buying or running drones made in a covered foreign country (the PRC, per ModalAI), or drones using these items from there:
  - flight controllers
  - radios and data transmission devices
  - cameras
  - gimbals
  - ground control systems / operating software, judged by the place of development
  - network connectivity / data storage, judged by where it sits or who administers it

  Two other summaries (Penn State, an Alaska state notice) list the covered countries as China, Russia, Iran and North Korea, so the sources disagree. [ModalAI](https://www.modalai.com/blogs/blog/what-the-new-defense-acts-mean-for-drone-developers), [Penn State](https://courses.ems.psu.edu/geog892/node/725), [Alaska notice](https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=156754)
- **FY2024 NDAA American Security Drone Act (Secs. 1821–1832).** Enacted Dec 22, 2023. Bars federal purchase of drones from "covered foreign entities", and bars operating them after Dec 22, 2025. Implemented through FAR 52.240-1. Contractors check the FASC list in SAM. [FAR 52.240-1](https://www.acquisition.gov/far/52.240-1) **[primary]**, [ModalAI](https://www.modalai.com/blogs/blog/what-the-new-defense-acts-mean-for-drone-developers)
- **"NDAA compliant" is a self-declaration.** No government issues it. Blue UAS (DoD) and Green UAS (AUVSI) are the audited lists. [thedroneu](https://www.thedroneu.com/blog/ndaa-compliant-drones-guide/), [Unmanned Aerial Online](https://unmanned-aerial.com/blue-uas-green-uas-ndaa-compliant-what-each-list-certifies/)
- **What Blue UAS treats as "critical".** Officials say Sec. 848 targets parts that store or move data (cameras, comms links, comms chips). "Motors were not considered one of those critical components." Most cleared drones use China-sourced motors. [DefenseScoop](https://defensescoop.com/2025/11/20/dod-drones-blue-uas-list-chinese-parts-motors/)
- **Blue UAS Framework.** A list of NDAA-compliant, cyber-tested components and software. Clearance is model- and configuration-specific. Feb 2025 picks included a flight controller, an ESC, radios/datalinks, cameras, a Remote ID beacon, a GNSS receiver and autonomy computers. [DIU refresh announcement](https://www.diu.mil/latest/blue-uas-refresh-list-and-framework-platforms-and-capabilities-selected) **[primary]**, [ExecutiveGov](https://www.executivegov.com/articles/diu-blue-uas-list-framework-37-drones-components), [ModalAI framework components](https://www.modalai.com/en-tw/collections/blue-uas-framework-components)
- **DCMA clearance submission** asks for company ID, product description, a hardware + software BOM, critical-component documentation and an NDAA self-certification. DCMA teardown checks the BOM against the actual hardware. [Inside Unmanned Systems: Drone Dominance supply chain](https://insideunmannedsystems.com/inside-the-drone-dominance-supply-chain-what-every-u-s-drone-company-must-source-and-by-when/)
- **Drone Dominance phased sourcing** (per trade press, not verified against dronedominance.mil). Phase 2 = Aug 2026, Phase 3 = Feb 2027, Phase 4 = Aug 2027. "NCC" = non-covered country.
  - Motors: NCC assembly plus 10 USC 4863 specialty metals, then a DFARS magnet sourcing plan, then NCC magnets/winding with "disclosed rare earth feedstock origin".
  - Batteries: NCC pack assembly with no 1260H-listed entities (e.g. CATL), then NCC cells.
  - Flight controllers: NCC assembly, ASDA sourcing and no Sec. 889 parts, then NCC PCB fab and firmware repos not hosted in covered countries.
  - GNSS: NCC PCB, then NCC receiver modules.
  - GCS: NCC assembly, and electronics only from original manufacturers or authorized distributors.

  [Inside Unmanned Systems](https://insideunmannedsystems.com/inside-the-drone-dominance-supply-chain-what-every-u-s-drone-company-must-source-and-by-when/)
- **Section 889 (FAR 52.204-25).** No covered telecom/video gear from Huawei or ZTE. The clause covers Hytera, Hikvision and Dahua gear only for security and national-security uses. The offeror's representation goes in 52.204-24. [FAR 52.204-25](https://www.acquisition.gov/far/52.204-25) **[primary]**
- **Batteries, FY2024 NDAA Sec. 154 (secondary source).** From Oct 1, 2027, DoD may not buy batteries from CATL, BYD, Envision, EVE, Gotion, Hithium or their successors. That includes cases where they make the majority of the battery's components. [18650batterystore summary](https://www.18650batterystore.com/pages/ndaa-compliant-batteries)
- **Magnets / tantalum / tungsten: DFARS 252.225-7052.** A contractor may not deliver NdFeB or SmCo magnets melted or produced in China, Russia, Iran or North Korea. From Jan 1, 2027 that widens to "mined, refined, separated, melted, or produced". Industry is lobbying for a delay; no delay is confirmed. [acquisition.gov 252.225-7052](https://acquisition.gov/dfars/252.225-7052-restriction-acquisition-certain-magnets-tantalum-and-tungsten.) **[primary]**, [Crowell](https://www.crowell.com/en/insights/client-alerts/dod-expands-restrictions-on-supply-chain-for-certain-magnets-tantalum-and-tungsten), [Adamas](https://www.adamasintel.com/u-s-defense-contractors-seek-second-dfars-delay-as-pentagons-200b-deal-team-six-mobilizes-for-rare-earth-independence/)
  - **Correction to the brief:** 252.225-7052 is the *magnets/tantalum/tungsten* clause. **Specialty metals** (titanium, certain steels, nickel/cobalt alloys, zirconium) are **DFARS 252.225-7009**: melted or produced in the US or a qualifying country. The clause exempts electronic components and COTS items that meet its exception. [Cornell 252.225-7009](https://www.law.cornell.edu/cfr/text/48/252.225-7009) **[primary]**
- **Buy American (DFARS 252.225-7001).** Domestic component content must be ≥65% of component cost for deliveries 2024–2028, rising to ≥75% from 2029. Qualifying-country components count. The test leaves out labor and overhead. [Pillsbury](https://pillsburylaw.com/en/news-and-insights/dod-final-rule-eo14005.html), [JD Supra](https://www.jdsupra.com/legalnews/dod-publishes-final-rule-implementing-7158533)
- **Section 232 tariffs.** The President proclaimed tariffs on drone imports on the same day as the Aug 2026 BIS rule. That is one more reason to track country of origin per part. [DLA Piper](https://www.dlapiper.com/en-us/insights/publications/2026/08/two-us-drone-actions-reshape-export-controls-and-import-tariffs)

**ERP mapping**
- Item attributes:
  - `countryOfOrigin` (ISO code, required on every purchased part)
  - `ndaa848Category` (flight controller / radio / camera / gimbal / GCS software / none)
  - `blueUasFrameworkListed` (bool + listing date + listed model/config)
  - `containsNdFeBMagnet` (bool) + `magnetOriginCountry` + `rareEarthFeedstockOrigin`
  - `specialtyMetal` (Ti / steel / none) + `meltCountry`
  - `section889Reviewed` (bool)
  - `battery1260hCheck` (pass/fail)
  - `domesticComponent` (bool, for Buy American)
  - `pcbFabCountry` and `firmwareRepoLocation` for electronics
- BOM-level rollup on the end item: "% domestic component cost" and "any covered-country part?". This is the screen an ex-A&D person would look for **(inference)**.
- Supplier attributes: `ndaaComplianceLetter` (document + date + expiry), `authorizedDistributor` (bool, see 3.4), `fascListChecked` (date).
- Seed one realistic exception to make the demo credible **(inference)**. For example, a motor whose magnet origin is "PRC" flagged as non-compliant for 2027 deliveries, with an open supplier corrective action asking for a magnet sourcing plan.

---

## 2. Identification and traceability

- **CAGE code.** 5-character alphanumeric ID that DLA assigns during SAM registration. Required on offers and for SPRS. Foreign firms get an NCAGE. [FAR 52.204-16](https://www.acquisition.gov/far/52.204-16) **[primary]**, [NFFS](https://www.nffs.org/news/cage-code)
- **NSN.** 13 digits = FSC (4) + NIIN (9). The NIIN starts with a 2-digit NATO country code (00/01 = US). FSC **1550 = Unmanned Aircraft**, e.g. an NSN like 1550-01-561-0012. [DLA NSN brochure](https://www.dla.mil/Customer-Support/Brochures/Details/Article/2893363/self-help-tools-side-by-side-comparison/) **[primary]**, [41 CFR 101-30](https://www.gpo.gov/fdsys/pkg/CFR-2014-title41-vol2/pdf/CFR-2014-title41-vol2-sec101-30-001.pdf), [samsearch FSC 1550](https://samsearch.co/nsn-lookup/1550-unmanned-aircraft)
  - (inference) A new small maker's items usually have **no NSN yet**. NSNs show up on mature spares lines. Seed NSNs on only a few spares and leave the rest blank.
- **IUID / UII (DFARS 252.211-7003, JAN 2023).** The clause requires a unique mark on:
  - delivered items with government unit cost ≥ $5,000
  - items under $5,000 if the schedule lists them
  - embedded subassemblies, components and parts if the contract specifies them
  - "items with warranty requirements"
  - serially managed reparables
  - special tooling / special test equipment

  The contractor reports UIIs through the WAWF receiving report. For embedded items, it uses WAWF, the IUID Registry, or DD Form 1423. [acquisition.gov 252.211-7003](https://www.acquisition.gov/dfars/252.211-7003-item-unique-identification-and-valuation.) **[primary]**
- **UII constructs.** Construct 1 = Issuing Agency Code + Enterprise ID (CAGE) + serial unique across the whole enterprise. Construct 2 = IAC + Enterprise ID + original part number + serial unique within that part number (the common choice). Data Matrix ECC 200 uses data identifiers `17V` (CAGE), `1P` (part number) and `S` (serial) under header `[)>RS06`. A sample concatenated UII: `D1HLD9ABCDE000001`. [252.211-7003](https://www.acquisition.gov/dfars/252.211-7003-item-unique-identification-and-valuation.) **[primary]**, [Mil-Pac IUID](https://help.milpac.com/comply/html/iuid--item-unique-id.html), [DuraLabel](https://resources.duralabel.com/infographics/military-uii-labeling), [Wikipedia MIL-STD-130](https://en.wikipedia.org/wiki/MIL-STD-130)
- **Marking quality.** The maker must verify (grade) each MIL-STD-130 mark, and the mark should last the life of the item. DoD does not accept commercial look-alike codes that fail verification. [Wikipedia IUID](https://en.wikipedia.org/wiki/Item_Unique_Identification)
- **Receiving report.** WAWF (part of PIEE) replaced the paper DD 250 as the acceptance document. A DD 250 printout often still travels with the shipment. Source-inspected shipments can't ship until the government quality rep (QAR) signs in WAWF. [Mil-Pac DD250](https://help.milpac.com/comply/html/dd250--receiving-report-form.html), [Mil-Pac QAR](https://help.milpac.com/comply/html/qar-quality-assurance-represen.html), [AcqNotes](https://acqnotes.com/acqNote/department-of-defense-form-250)
  - A real 2008 sUAS IDIQ said: "use of WAWF-RA fulfills the requirements for submission of DD Form 250s"; WAWF-RA was "mandatory for this award". [SEC exhibit, BATMAV IDIQ](https://www.sec.gov/Archives/edgar/data/1368622/000114036108005826/ex10_1.htm) **[primary]**
- **DD Form 1149** (Requisition and Invoice/Shipping Document). Used to move government property between government and contractor, e.g. GFP coming in, or repaired units returning. [EverySpec DD 1149](https://everyspec.com/DoD/DoD-FORMS/DD_FORM_1149_JAN2016_55524/), [WHS form page](https://www.esd.whs.mil/Directives/forms/dd1000_1499/DD1149/) **[primary]**
- **Shelf life (DoDM 4140.27).**
  - Type I = non-extendable, marked with an expiration date. Letter codes, e.g. H = 12 months, M = 24 months.
  - Type II = extendable after inspection or test, marked with an inspect/test date. Numeric codes.
  - Contracts typically require ≥85% of shelf life left when the government receives the item.

  [DoDM 4140.27 Vol 1](https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodm/414027_vol1.PDF) **[primary]**, [Mil-Pac shelf-life codes](https://g3.milpac.com/resources/wawf/Shelf-Life_Codes.htm)
- **Composite prepreg.** Suppliers specify storage at about −18 °C or colder, and a full thaw before opening. The shop keeps an out-time log **per roll**, and keeps it after the roll is used up. Example limits: one oven-cure prepreg allows 28 days out-time and 24 months frozen life; autoclave prepregs are often around 15 days out and 12 months frozen. [DeltaTrak brief](https://deltatrak.com/wp-content/uploads/2024/11/SB0002_Carbon-Fiber-Prepeg_13K1.pdf), [Graco Roberts](https://www.gracoroberts.com/composites/prepregs/), [NASA NTRS](https://ntrs.nasa.gov/api/citations/20110016110/downloads/20110016110.pdf)
- **Lithium batteries.** Makers and distributors of cells, batteries and battery-powered equipment must make a UN 38.3 test summary available (since Jan 1, 2020). It stays valid unless the design changes. [PHMSA interp 23-0040](https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/docs/standards-rulemaking/hazmat/interpretations/77931/230040.pdf) **[primary]**, [ICAO/PRBA FAQ](https://www2023.icao.int/safety/DangerousGoods/WG18/DGPWG.18.IP.004.3.en.pdf). The Navy treats lithium batteries as hazardous and approves them per application (NAVSEA S9310). [EverySpec S9310](https://everyspec.com/USN/NAVSEA/NAVSEA_S9310-AQ-SAF-010_4137)

**ERP mapping**
- Company record: CAGE code. Customer and supplier records: CAGE (the government identifies issuing and admin offices by DoDAAC, but I did not research DoDAACs).
- Items: `nsn` (optional, format `1550-01-xxx-xxxx` for the air vehicle), `iuidRequired` (bool), `uiiConstruct` (1 / 2), `serialized` (bool), `shelfLifeType` (I / II / none), `shelfLifeCode`, `shelfLifeMonths`, `storageTemp`, `hazmatUN` (UN3480 = cells/batteries alone, UN3481 = packed with or in equipment; these UN numbers come from the search query, and the page fetched did not show them).
- Serialized tracking: end item **air vehicle**, **GCS**, and serialized subcomponents: flight controller, radio module, EO/IR gimbal, GNSS/CRPA antenna, battery packs. Each serial gets a UII string like `D` + CAGE + PN + SN, and keeps parent/child genealogy (embedded-item reporting needs this).
- Lot tracking: LiPo/Li-ion cells (cell maker lot + date code), prepreg rolls (batch + out-time accumulated), adhesives and potting (batch + expiry), carbon tube stock (mill cert/heat lot).
- Documents on receipts: CoC, UN 38.3 summary per battery P/N, prepreg cert with batch, mill cert for metal parts.
- Shipping documents: WAWF receiving report number (e.g. a "Combo" invoice+RR) recorded on the shipment, DD 250 traveler printout, DD 1149 for GFP/repair moves.

---

## 3. Quality

### 3.1 AS9100D and nonconformance (MRB / NCR / CAPA)

- AS9100D clause 8.7 "Control of Nonconforming Outputs" (formerly 8.3 in Rev C) requires identifying, segregating and dispositioning nonconforming outputs. [ElsMar thread on 8.7](https://elsmar.com/elsmarqualityforum/threads/effective-nonconforming-process-for-as9100-8-7.79312/)
- Typical MRB (Material Review Board) dispositions: use-as-is, rework, repair, return to supplier, scrap. Significant or repeat problems go to formal corrective action. [QT9 MRB glossary](https://qt9software.com/glossary/material-review-board-mrb)
- **Use-as-is and repair need approval from the design authority**. When the customer owns the design, that means customer approval (quoted from AS9100C 8.3 in practitioner forums). [ElsMar](https://elsmar.com/elsmarqualityforum/threads/8-3-non-conforming-product-aerospace.29108/page-2)
- AS9100 is a typical "higher-level quality" standard named in FAR 52.246-11. The clause flows down for critical or complex items. [FAR 52.246-11](https://www.acquisition.gov/far/52.246-11) **[primary]**, [DLA industry day](https://www.dla.mil/Portals/104/Documents/Aviation/IndustryDays/2019/Day%202%20General%20Session%20for%20Posting.pdf)

### 3.2 AS9102 First Article Inspection

- Three forms: **Form 1** Part Number Accountability, **Form 2** Product Accountability (materials, special processes, functional test, each backed by a cert), **Form 3** Characteristic Accountability (every ballooned characteristic and its measured result). Balloon numbers on the drawing match Form 3 characteristic numbers. Current revision is AS9102 Rev C (June 2023). [InspectionXpert](https://www.inspectionxpert.com/fai/as9102), [Lockheed Martin RMS FAI guide](https://sustainability.lockheedmartin.com/content/dam/lockheed-martin/eo/documents/suppliers/rms/rms-quality-fai-July-2023.pdf), [Lockheed Martin UK SQAG001](https://www.lockheedmartin.com/content/dam/lockheed-martin/uk/documents/suppliers/SQAG001.pdf)
- First article testing can rule out destination inspection, so origin (source) inspection applies. [DLAD 46.4](https://www.acquisition.gov/index%2Ephp/dlad/subpart-46.4-%E2%80%93-government-contract-quality-assurance) **[primary]**

### 3.3 Government source inspection (DCMA)

- DFARS 246.402: source QA is normally not required on contracts or orders under $400,000, unless an exception applies (critical characteristics, regulation, MOA, CO findings). [DFARS 246.402](https://www.acquisition.gov/index%2ephp/dfars/246.402-government-contract-quality-assurance-source.) **[primary]**
- A DCMA QAR performs contract quality assurance. Inspection and acceptance can happen at different places. [Mil-Pac QAR](https://help.milpac.com/comply/html/qar-quality-assurance-represen.html)

### 3.4 Counterfeit prevention and GIDEP

- **DFARS 252.246-7007** (counterfeit detection system). It has 12 criteria: training, inspection and test, processes to remove counterfeits, traceability, procurement controls, reporting and quarantine, suspect-part identification, system design and maintenance, flow-down, awareness of trends, GIDEP screening, and obsolescence. It applies only to contractors under the Cost Accounting Standards (CAS). DoD does not use it in small-business set-asides. [Cornell 252.246-7007](https://law.cornell.edu/cfr/text/48/252.246-7007) **[primary]**, [Luna policy](https://lunainc.com/sites/default/files/assets/files/Corporate%20Info/Counterfeit_Part_Prevention_Policy_2025-09-11.pdf_final.pdf)
- **DFARS 252.246-7008** (sources of electronic parts, JAN 2023). Buy from the original manufacturer, its authorized suppliers, or suppliers that buy only from those. Applies even below the simplified acquisition threshold and to COTS buys. Flows down to all tiers except the original manufacturer. [acquisition.gov 252.246-7008](https://acquisition.gov/node/36780/printable/print) **[primary]**, [Venable](https://www.venable.com/choosing-a-supplier-dod-issues-new-rules-on-the-sources-of-electronic-parts-08-18-2016/)
  - (inference) A small sUAS maker will usually be bound by 7008, and by 7007 only through a prime's flow-down. So the demo should show "authorized distributor" status on electronics suppliers.
- **SAE standards:** AS5553 (electronic parts), AS6174 (all other materiel), AS6496 (authorized distributors), AS6081 (independent distributors/brokers), AS6171 (test methods). [CALCE overview](https://calce.umd.edu/node/1921), [SAE AS5553](https://saemobilus.sae.org/content/as5553)
- **GIDEP.** Government–industry exchange of Alerts, Safe-Alerts, Problem Advisories, Agency Action Notices, counterfeit reports and obsolescence notices. [NASA GIDEP overview](https://sma.nasa.gov/docs/default-source/sma-disciplines-and-programs/GIDEP/gidep_overview.pdf) **[primary]**
- **FAR 52.246-26** (Reporting Nonconforming Items). Screen GIDEP, and report counterfeit or suspect counterfeit parts within 60 days. Applies to items under 52.246-11 higher-level quality or designated critical. Excludes FAR Part 12 commercial items. [FAR 52.246-26](https://www.acquisition.gov/far/52.246-26) **[primary]**, [Taft](https://www.taftlaw.com/news-events/law-bulletins/reporting-nonconforming-items-the-governments-expansion-of-the-counterfeit-reporting-rule/)

### 3.5 Certificates of Conformance

- FAR 52.246-15 CoC template: date furnished, contractor name, contract number, carrier, bill of lading, and a statement that the supplies match the contract's quality, specs, drawings, packaging, marking and part number. Quantity is stated on the CoC or the acceptance document. Signed with date and title. Needs CAO authorization before use. [FAR 52.246-15](https://www.acquisition.gov/far/52.246-15) **[primary]**

### 3.6 Calibration

- AS9100D 7.1.5.2: the organization keeps measuring equipment traceable to national/international standards, in a register with a recall method. If a check finds equipment out of tolerance, the organization must assess whether earlier measurements are still valid. ISO/IEC 17025-accredited cal certs are the usual evidence. [Micro Precision](https://microprecision.com/blog/as9100-calibration-requirements/), [Utah MEP](https://mep.utah.edu/tag/as9100d/)

### 3.7 Workmanship standards

- IPC/WHMA-A-620 Class 3 for cables/harnesses, and IPC-A-610 Class 3 for PCB assemblies. These are the usual drawing/PO callouts for defense work. [TT Electronics](https://www.ttelectronics.com/blog/cable-harness-standards/), [Wevolver IPC-A-610](https://www.wevolver.com/article/ipc-a-610-acceptability-of-electronic-assemblies)

**ERP mapping**
- **Inspection plans.** Seed 4 plan types: receiving, in-process, final, and FAI (AS9102) for the first article of each new P/N revision. Receiving checks: CoC present, cert matches the PO spec revision, quantity, visual, UN 38.3 summary on file, and a counterfeit risk check on electronics. Record the FAI as an inspection with Form 1/2/3 sections, characteristic rows and balloon numbers.
- **NCRs.** Disposition codes: Use-As-Is, Rework, Repair, Return to Vendor, Scrap. Fields: `requiresCustomerApproval` (true for UAI/repair on customer-designed product), MRB members, linked CAPA/SCAR. Seed a mix of internal and supplier-caused NCRs (see section 8 for examples).
- **CAPA / SCAR records** linked to NCRs.
- **GIDEP screening log** (document or custom record): alert number, affected P/N, screened date, result "no impact" or "suspect stock quarantined".
- **Gauges / calibration**: torque drivers, crimp tools (pull test), calipers, scales (weight-and-balance), multimeters, a thrust stand load cell. Each has a cal due date, cal vendor and 17025 cert. Seed one overdue gauge that blocks an operation **(inference)**.
- **Supplier quality attributes**: AS9100 cert number and expiry, IPC QML (harness vendor), ISO 17025 (cal lab), authorized-distributor letters.
- **Shipment quality data**: `sourceInspectionRequired` (bool on the sales order line), QAR name and WAWF sign-off date.

---

## 4. Contracts and customers

### 4.1 Who buys
- **US Army (PEO Aviation / UAS Project Office, Redstone Arsenal).**
  - Company-Level sUAS Directed Requirement: the Army picked 2 vendors in Sep 2024 ($14.417M) and bought through DLA's Tailored Logistics Support 10-year IDIQ. The Army checked both systems against FY2020 NDAA compliance and the Blue List. [army.mil](https://www.army.mil/article/279603/the_u_s_army_selects_vendors_for_the_company_level_small_uncrewed_aircraft_system_directed_requirement_for_brigade_combat_teams) **[primary]**
  - SRR (Short Range Reconnaissance) Tranche 2 production began Aug 2025. [army.mil SRR T2](https://www.army.mil/article/288117) **[primary]**
  - PBAS FPV sources-sought notice in 2025. [Breaking Defense](https://breakingdefense.com/2024/09/army-selects-two-attritable-uass-for-company-level-recon-surveillance-and-target-acquisition/)
- **DIU** runs Commercial Solutions Openings with prototype OTs under 10 USC 4022. The statute allows a follow-on production award without new competition if three conditions hold: the prototype was competitive, it finished successfully, and the agreement allowed a follow-on. DIU's average is about 120 days to award. [DAU OT guide](https://aaf.dau.edu/aaf/contracting-cone/ot/prototype/), [Spencer Fane](https://www.spencerfane.com/insight/defense-innovation-unit-the-pentagons-front-door-for-unmanned-systems-technology-companies/)
- **SOCOM** has bought sUAS directly (e.g. All Environment Capable Variant sUAS) and funds Group 1 R&D. [AeroVironment AECV release](https://www.avinc.com/resources/press-releases/view/aerovironment_awarded_u.s._special_operations_uas_contract), [Military Embedded Systems](https://militaryembedded.com/unmanned/test/ussocom-experimental-uas-contract-won-by-berry-aviation)
- **Unit-level card buys** by O-6 commanders after the July 2025 memo. [military.com](https://365.military.com/daily-news/opinions/how-pentagon-put-drone-testing-credit-card.html), [Defense One](https://www.defenseone.com/policy/2025/07/drones-are-now-bullets-how-new-pentagon-policy-may-accelerate-robot-warfare/406686)
- **FMS vs DCS.**
  - FMS: the US government sells to the foreign government under an LOA. The contractor signs a normal FAR contract with the US government.
  - DCS: the contractor sells directly to a foreign MOD under a DDTC license (or BIS for 600-series).
  - A 2024 policy allows certain military UAS to go by direct sale instead of FMS only.

  [Covington FMS guide](https://www.insidegovernmentcontracts.com/wp-content/uploads/sites/49/2022/03/Covington-Guide-to-Foreign-Military-Sales-and-Financing-2022.pdf), [learnexportcompliance](https://www.learnexportcompliance.com/export-license-requirements-of-direct-commercial-sales-v-foreign-military-sales/), [Baker McKenzie](https://sanctionsnews.bakermckenzie.com/us-government-aims-to-ease-restrictions-on-sales-of-us-origin-unmanned-aerial-systems)
- **Prime contractors as customers** (invented prime buys a payload or radio subassembly with flowed-down clauses) **(inference)**. That matches the flow-down rules in 52.246-11, 252.246-7008 and 252.204-7012 cited above.

### 4.2 Contract structure
- **IDIQ.** A master contract with min/max. Orders are delivery orders for supplies and task orders for services. Each order can be FFP, CPFF or T&M. Multiple-award IDIQs give awardees a fair chance to compete for each order. [Contractology](https://contractology.com/guides/contract-types/), [samsearch](https://samsearch.co/glossary/idiq-task-order)
- **A real sUAS IDIQ's CLIN layout** (BATMAV, USAF/AFSOC, 2006–2011) **[primary]**:

  | CLIN | Description | Type |
  |---|---|---|
  | 0001 | Development and Integration | CPFF |
  | 0002 | Systems | FFP |
  | 0003 | Initial Spares | FFP |
  | 0004 | Training ("six students per class") | FFP |
  | 0005 | Repair and Return | T&M (hourly rates + ceiling) |
  | 0006 | Data (CDRLs) | FFP, Not Separately Priced |

  - Year-prefixed CLINs per fiscal year (e.g. 2002 = FY07 systems, 3002 = FY08).
  - Contract min $300,000, max $45,000,000. Per-order minimum $2,500.
  - IUID clause 252.211-7003 with a UID report CDRL "concurrent with associated end item delivery".
  - GFP listed in an attachment: mapping software, a rugged laptop.

  [SEC exhibit 10.1](https://www.sec.gov/Archives/edgar/data/1368622/000114036108005826/ex10_1.htm)
- **CLIN numbering.** DFARS 204.71 governs it. CLINs are 4-digit numbers (0001–9999), and SLINs add 2 letters/digits (e.g. 0001AA; I did not verify that format against the regulation). The DD Form 1423 CDRL is always an *exhibit* (lettered A, B…, skipping I and O). [DFARS 204.71](https://www.acquisition.gov/dfars/subpart-204.71-uniform-contract-line-item-numbering-system) **[primary]**, [Oracle public-sector docs](https://docs.oracle.com/cd/E26401_01/doc.122/e48927/T555203T555678.htm)
- **Progress payments.** DoD customary rate is 80% of costs for large business and 90% for small business (DFARS 232.501-1). FAR baseline is 80% / 85%. [DFARS 232.5](https://www.acquisition.gov/dfars/subpart-232.5-progress-payments-based-costs) **[primary]**
- **GFP.** FAR 52.245-1 requires a property management system: records, receiving, inventory, reports. DFARS 252.211-7007 covers GFP reporting, and 252.245-7001…7004 cover tagging, loss reporting, PMS administration and disposal. [CBH](https://www.cbh.com/insights/articles/contractor-property-management-system-compliance-guide/), [GE contract listing](https://www.geaerospace.com/sites/default/files/FA8650-15-D-2501-A00001.pdf)
- **DCAA accounting basics.** Cost-type and T&M work needs an "adequate" accounting system, checked by the SF 1408 pre-award survey. The survey looks for 5 things: direct and indirect costs kept apart, direct costs collected by contract/job, a logical indirect allocation, timekeeping by cost objective, and costs under general ledger control. [BDO](https://www.bdo.com/insights/industries/government-contracting/building-a-strong-foundation-sf-1408-accounting-system-requirements), [CBH](https://www.cbh.com/insights/articles/dcaa-accounting-system-requirements-for-government-contractors/)
- **Warranty.**
  - FAR 52.246-17: warranty on noncomplex supplies; the CO fills in the period.
  - DFARS 252.246-7001: warranty of data, default 3 years.
  - DFARS 252.246-7006 (Warranty Tracking of Serialized Items): tracks the UII of each warranted item and has a "Source of Repair Instructions" attachment.

  [FAR 52.246-17](https://www.acquisition.gov/far/52.246-17) **[primary]**, [DFARS PGI 246.7](https://www.acquisition.gov/dfarspgi/pgi-246.7-warranties) **[primary]**

**ERP mapping**
- **Customers** (all invented names, real-shaped). Seed 6:
  1. an Army program office that buys under an IDIQ
  2. a SOCOM component
  3. a DIU-sponsored OT agreement
  4. a prime contractor (commercial PO with flow-downs)
  5. an FMS case that goes through a US Army contracting command
  6. one DCS foreign MOD customer (needs the export license record)

  Customer fields: CAGE (or DoDAAC), contracting office, ship-to (depot/unit), WAWF required (bool), DCMA office.
- **Sales order header**: contract number (made-up but DoD-shaped, e.g. `W58RGZ-26-D-0042`; I did not verify the DoDAAC prefix W58RGZ against a source), contract vehicle (IDIQ / OT / commercial PO / FMS), order type (Delivery Order number), contract type (FFP / CPFF / T&M), clauses list, `sourceInspection`, `iuidRequired`, `progressPaymentRate`.
- **Sales order lines = CLINs**: `clin` (0001, 0002…), `slin` (optional), description, contract type per line, quantity, unit price, NSP flag for data CLINs, required delivery date.
- **Jobs/projects**: one job per CLIN or delivery order, so the ERP collects costs by contract. That matches the DCAA requirement **(inference)**. Employees charge labor by operation to that job.
- **GFP items**: separate inventory ownership "Government", with GFP tag/UII, received on a DD 1149, never costed into the product. Example: a government-loaned rugged laptop or test GCS radio (matches the BATMAV GFP list).
- **Invoices/receipts**: invoice references the CLIN and the WAWF document number. Progress payment requests are optional for the demo.

---

## 5. Supplier categories and the documents each provides

Category list (we invent the names). Sources: Blue UAS Framework picks, the Drone Dominance supply-chain areas, and the documents that the clauses above require.

| Category | Why it matters | Documents on receipt / in supplier file |
|---|---|---|
| Flight controller / autopilot | NDAA 848 critical; Blue UAS Framework category; firmware repo location asked | CoC, NDAA compliance letter, country of origin, PCB fab country, firmware version / repo location statement, serial list |
| Mesh radio / datalink | 848 critical; encryption ECCN (5A002/5A992.c) | CoC, NDAA compliance letter, export classification (ECCN) letter, serial list, RF test report |
| EO/IR gimbal / camera | 848 critical (camera, gimbal); thermal core may be 6A003 / USML XII | CoC, NDAA compliance letter, ECCN/USML statement, serial list, boresight/calibration report |
| GNSS receiver / CRPA anti-jam antenna | Drone Dominance GNSS area; M-code claims need checking | CoC, NDAA compliance letter, country of origin, test report |
| Motors | Magnets under 252.225-7052; Drone Dominance wants a magnet sourcing plan and rare-earth feedstock origin | CoC, magnet origin declaration (melt and, from 2027, mine/refine), specialty-metals statement if steel/Ti shafts, run-in test data |
| ESCs | Blue UAS Framework category (DIU added an ESC in 2025) | CoC, NDAA compliance letter, firmware version |
| Battery cells / packs (LiPo, Li-ion) | Sec. 154 banned makers from Oct 2027; Drone Dominance battery area; hazmat | CoC with cell lot/date code, UN 38.3 test summary, cell maker declaration (not a 1260H entity), SDS |
| Carbon fiber tube / plate / prepreg | Shelf life + out-time; batch traceability | Material cert with batch, storage/out-time limits, CoC |
| Machined metal parts (motor mounts, hinges, Ti fasteners) | Specialty metals 252.225-7009 | CoC, mill cert with melt country, FAI (AS9102) for first lot |
| Harness / cable assembly house | IPC/WHMA-A-620 Class 3 | CoC, continuity/hi-pot test report, IPC QML cert |
| PCB assembly (EMS) | IPC-A-610 Class 3; 252.246-7008 | CoC, AOI/X-ray summary, authorized-source statement for parts |
| Electronics distributor | 252.246-7008 / AS6496 | CoC with traceability to OCM, authorized-distributor letter |
| Adhesives / potting / conformal coat | Shelf life Type I/II | CoC, batch, expiry date |
| Transit cases / soft cases / packaging | 9A610.y.33 "carrying cases"; MIL-STD-129 marking (cited via the Mil-Pac IUID source) | CoC |
| Calibration lab | AS9100 7.1.5 | ISO/IEC 17025 cert + per-gauge cal certs |
| Environmental test lab | MIL-STD-810H tailoring | Test report per serial / per qualification article |

Sources: [DIU refresh](https://www.diu.mil/latest/blue-uas-refresh-list-and-framework-platforms-and-capabilities-selected), [Inside Unmanned Systems](https://insideunmannedsystems.com/inside-the-drone-dominance-supply-chain-what-every-u-s-drone-company-must-source-and-by-when/), [Vertiq ESC on Framework](https://www.unmannedsystemstechnology.com/2025/02/vertiqs-81-08-g2-module-added-to-dius-blue-uas-framework/), [CRPA overview](https://www.unmannedsystemstechnology.com/feature/improving-uncrewed-gnss-resilience-with-crpa-technology/), [PHMSA UN38.3](https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/docs/standards-rulemaking/hazmat/interpretations/77931/230040.pdf), [TT Electronics IPC-620](https://www.ttelectronics.com/blog/cable-harness-standards/), [IPC QML release](https://ipc.org/news-release/manufactured-assemblies-corp-llc-earns-ipcwhma-620-qualified-manufacturers-listing). The document list per row is my synthesis from the clauses above **(inference)**.

- "NDAA compliance letter" is a vendor self-assertion, not a government approval. [thedroneu](https://www.thedroneu.com/blog/ndaa-compliant-drones-guide/), [Penn State](https://courses.ems.psu.edu/geog892/book/export/html/725)

**ERP mapping**
- Supplier records: category, CAGE, approval status (Approved / Conditional / Disqualified), AS9100 cert expiry, NDAA compliance letter expiry, authorized-distributor flag, CMMC/SPRS, and "flow-downs acknowledged" date.
- Approved Supplier List per item: give critical items a single approved source, and give commodity items two **(inference)**.
- Purchase order lines: required-documents checklist (CoC, UN 38.3, mill cert, FAI) driven by item attributes. A missing doc blocks receipt or creates an NCR.

---

## 6. Manufacturing and test flow for a Group 1/2 sUAS

Steps marked with sources. The overall order is my synthesis **(inference)**.

1. **Receiving inspection.** Docs check (CoC, certs, UN 38.3), counterfeit screen for electronics, visual, sample measurements, FAI for new revisions. Prepreg goes straight to the freezer and its out-time clock starts. (see 3.2, 3.4, 2)
2. **Composite fabrication.** Thaw prepreg, cut plies, lay up arms/frame, cure (oven or autoclave), trim/drill. Or cut and bond purchased carbon tubes. Log out-time per roll. [DeltaTrak](https://deltatrak.com/wp-content/uploads/2024/11/SB0002_Carbon-Fiber-Prepeg_13K1.pdf), [Graco Roberts](https://www.gracoroberts.com/composites/prepregs/)
3. **Harness build.** Cut/strip/crimp, pull test, continuity / hi-pot, to IPC/WHMA-A-620 Class 3. [circuitassembly](https://www.circuitassembly.com/ipc-whma-a-620-explained/)
4. **Avionics integration.** Mount the flight controller, ESCs, radio, GNSS/CRPA, companion computer; torque checks with calibrated drivers. Record child serials against the parent air vehicle (embedded UII genealogy). [252.211-7003(e)](https://www.acquisition.gov/dfars/252.211-7003-item-unique-identification-and-valuation.)
5. **Firmware load and configuration.** Load the controlled firmware version, select the frame type, set sensor orientation. In PX4/QGroundControl, everything except tuning can be done in any order, and tuning must be last. Record the firmware hash/version per serial. [PX4 config](https://docs.px4.io/main/zh/config_mc/), [QGC sensors](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/setup_view/sensors_px4.html)
6. **Calibration.** Compass (rotate through every orientation), gyroscope (still on a flat surface), accelerometer (multi-orientation), optional level horizon. ESC calibration for PWM/OneShot ESCs; DShot generally doesn't need it. Remove propellers before motor tests. [QGC sensors](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/setup_view/sensors_px4.html), [PX4 MC config](https://docs.px4.io/main/zh/config_mc/)
7. **Motor/ESC run-in.** Props off, then a thrust-stand check. I found **no public source** for run-in durations or limits; invent them and label them as internal procedure values.
8. **Payload integration and boresight** for the EO/IR gimbal: video stream check. [Gambit job posting via search](https://job-boards.eu.greenhouse.io/skdse/jobs/5001551101)
9. **Weight and balance** with a calibrated scale **(inference)**.
10. **Tethered hover / flight acceptance test (EOLT).** A standard flight test card per serial: hover trim stability, sensor fusion health, gimbal video quality, return-to-base failsafe. Shops use tethered hover rigs indoors, where there is no GPS. [Gambit EOLT posting](https://job-boards.eu.greenhouse.io/skdse/jobs/5001551101), [Prime Air EOLT posting](https://abilitylinks.org/jobs/680617829/apply), [hover test patent US11117681](https://patents.google.com/patent/US11117681), [Cerberon EOL robots](https://oboronka.mezha.ua/en/nimecka-kompaniya-stvorila-robotiv-dlya-perevirki-droniv-309053/)
11. **Environmental qualification (MIL-STD-810H)**, on qualification articles, not every unit. Methods: 514.8 vibration, 501.7 high temp, 502.7 low temp, 506.6 rain, 510.7 sand/dust. The program tailors the levels to the mission profile; one rugged-product example used −20 °C / 55–70 °C operating. [Curtiss-Wright PacStar MIL-STD list](https://curtisswrightds.com/system/files/2024-03/MIL-STD-Testing-Typically-Performed-on-PacStar-Designed-Products.pdf), [Kiwa](https://www.kiwa.com/en/de/services/testing/Defence-Testing-according-to-MIL-STD/)
12. **IUID marking and verification.** Apply the data plate / Data Matrix (17V CAGE, 1P PN, S SN), then grade-verify it. [DuraLabel](https://resources.duralabel.com/infographics/military-uii-labeling)
13. **Final inspection + CoC + (if required) DCMA source inspection** sign-off in WAWF. (see 3.3, 3.5)
14. **Kitting / packing.** Air vehicles, GCS, batteries (hazmat-packed UN3481 if inside equipment), chargers, spares, field repair kit, manuals into transit cases or rucksack. (see 7)
15. **End-item data package per serial** **(inference)**: as-built config (child serials + firmware), calibration results, acceptance flight test card, FAI reference, CoC, UII, open/closed NCRs.

**ERP mapping**
- Work centers: Receiving Inspection, Freezer/Material Prep, Composite Layup, Cure Oven, Trim/Drill, Harness Bench, Avionics Integration, Firmware Station, Calibration Station, Thrust Stand, Tethered Hover Cage, Flight Test Range, Environmental Lab (outside service), IUID Marking, Final Inspection, Kitting/Pack-out.
- Routing on the air vehicle job (operations with attached inspection steps):
  - harness → integration → firmware load (record version)
  - → sensor cal (record pass)
  - → motor run-in (record thrust/current per motor)
  - → hover test (record vibration/trim)
  - → flight acceptance test card (pass/fail per item)
  - → IUID mark/verify (record UII + grade)
  - → final inspection
- Outside processing: environmental test at an outside lab (a PO for the service, with the report as a document); calibration service.
- Tooling: layup molds and test fixtures as special tooling (IUID-eligible under 252.211-7003(c)(1)(iv)).

---

## 7. Product and aftermarket structure

- **System composition (real reference).** Army RQ-11B Raven: "three air vehicles, a ground control station (GCS), a remote video terminal", plus gimbaled payloads, batteries, chargers, field repair kit and spares. "Operator training is ten days." [army.mil Raven](https://www.army.mil/article/137604/rq_11b_raven_small_unmanned_aircraft_systems_suas) **[primary]**. The USAF fact sheet: three AVs, two GCS, transit cases and support equipment. [af.mil Raven](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104533/rq-11b-raven/) **[primary]**
- **SRR-class quadcopter.** Example: about 1.6 kg, more than 35 min endurance, about 8 km range, EO/IR payload. Integrates with Uncrewed Vehicle Control and the Android Tactical Assault Kit (ATAK). [army.mil SRR T2](https://www.army.mil/article/288117) **[primary]**, [The Defense Post](https://thedefensepost.com/2025/08/29/us-army-short-range-drone/)
- **Contract layout** for systems / initial spares / training / repair-and-return / data. See the BATMAV CLINs in 4.2. [SEC exhibit](https://www.sec.gov/Archives/edgar/data/1368622/000114036108005826/ex10_1.htm)
- **Sustainment.**
  - Separate support contracts for spares, training, maintenance and repairs, including electronics and composite repair at a depot (Australia, Wasp AE, 2019).
  - Repeat spares purchase orders (A$8.1M, 2022).

  [Australian Defence Minister release](https://www.minister.defence.gov.au/media-releases/2019-09-25/contract-awarded-wasp-small-unmanned-aerial-systems-fleet) **[primary]**, [ADM / XTEK spares](https://www.australiandefence.com.au/news/xtek-receives-spare-parts-order-from-defence)
- **Warranty on serialized items.** DFARS 252.246-7006 tracks it by UII, with a "Source of Repair Instructions" attachment. [PGI 246.7](https://www.acquisition.gov/dfarspgi/pgi-246.7-warranties) **[primary]**

**ERP mapping**
- **Sellable "system" item** (make-to-order kit BOM), e.g. "<Model> System, Gen 2":
  - 2× Air Vehicle (serialized, IUID, 9A610.a)
  - 1× Ground Control Station (serialized, IUID; rugged tablet + radio + controller)
  - 1× Remote video / ATAK end-user device **(inference)**
  - 1× Payload: EO/IR gimbal (serialized)
  - 6× Flight battery pack (serialized or lot; UN3481 when packed with equipment)
  - 1× Charger (9A610.y.33)
  - 1× Spares kit (props, arms, landing gear, antennas, hardware)
  - 1× Field repair kit (tools, adhesive with shelf life)
  - 1× Rucksack / transit case (9A610.y.33)
  - 1× Operator & maintainer manuals (technical data, Distribution D + export warning)
- **Service items**: New Equipment Training (per class, e.g. 6 students, 10 days), Field Service Rep days, data/CDRL deliverables (NSP).
- **Spares catalog**: arm assembly, propeller set, battery pack, GCS radio, gimbal, airframe shell. A few carry NSNs (FSC 1550 / others), all carry country of origin and ECCN.
- **Repairs / RMA (depot repair)**: the customer returns a serialized unit on a DD 1149 / RMA. Then:
  1. receiving inspection
  2. teardown/evaluation inspection
  3. NCR with failure code
  4. quote: T&M under the Repair & Return CLIN, or no charge under warranty (the UII and the warranty start/end decide)
  5. repair job
  6. retest with the same flight acceptance card
  7. ship back with a CoC
- **Warranty record per serial**: start event (acceptance date), duration (e.g. 12 months, invented), usage limit (flight hours, invented), source of repair = depot.

---

## 8. Seed-scenario checklist (all inference: concrete "realism" hooks for the demo)

- One active IDIQ with three delivery orders at different statuses: delivered/accepted in WAWF, in production, newly received.
- One OT prototype agreement with milestone-based billing.
- One FMS-funded order and one DCS order with an export license record (DSP-5 or BIS) that expires mid-dataset.
- One prime-contractor PO buying a radio/payload subassembly with flow-downs.
- A full serialized genealogy for at least one delivered air vehicle: FC, radio, gimbal, GNSS and battery serials, firmware version, UII string, flight test card.
- NCRs:
  - supplier CoC cites a superseded spec revision (a common FAI rejection reason per the AS9102 sources)
  - out-of-tolerance torque driver triggering a look-back on units built since the last good calibration
  - prepreg roll over its out-time limit, scrapped
  - battery pack swelling at receiving, returned to vendor
  - a GIDEP alert hitting a capacitor P/N, stock quarantined
- One supplier on "Conditional" status for missing magnet-origin data ahead of the Jan 1, 2027 change to 252.225-7052.
- A depot repair RMA under warranty and one billed T&M.
- GFP: one government-loaned GCS radio or laptop held in a separate ownership bucket.
