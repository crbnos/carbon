# Supplier & Customer Bank Details — How Mature ERP/Accounting Systems Model Them

Research for Carbon (manufacturing ERP). Scope: **counterparty** bank details — the bank accounts we pay suppliers into (ACH/SEPA/wire) and the ones we refund customers to / direct-debit from. This is *not* about our own company bank accounts.

Every substantive claim below cites a URL. Where I could not verify something from a primary source, it is explicitly marked **[UNVERIFIED]**.

---

## 1. Field set

### 1.1 Odoo — the most useful reference, because the source is readable

Odoo stores counterparty bank accounts in `res.partner.bank`, one record per account, linked to a partner (a partner is both customer and supplier in Odoo). Field definitions read from the 18.0 source at [`odoo/addons/base/models/res_bank.py`](https://github.com/odoo/odoo/blob/18.0/odoo/addons/base/models/res_bank.py):

| Field | Type | Required | Notes |
|---|---|---|---|
| `acc_number` | Char | **Yes** | The account number. This is the only required data field. |
| `partner_id` | Many2one → `res.partner` | **Yes** | Account holder (the counterparty) |
| `sanitized_acc_number` | Char, computed + stored | No | Normalized form of `acc_number`, used for uniqueness/matching |
| `acc_holder_name` | Char, computed + stored | No | Help text: "Account holder name, in case different than…" |
| `acc_type` | Selection, computed | No | Help: "Bank account type: Normal or IBAN. Inferred from…" — i.e. IBAN-ness is **derived**, not a separate column |
| `allow_out_payment` | Boolean | No | Help: "This account can be used for outgoing payments" |
| `bank_id` | Many2one → `res.bank` | No | The bank institution |
| `bank_name`, `bank_bic` | Char, related | No | Denormalized from `res.bank` |
| `currency_id` | Many2one → `res.currency` | No | |
| `company_id` | Many2one → `res.company`, related+stored | No | Multi-company scoping |
| `country_code` | Char, related | No | |
| `sequence` | Integer (default 10) | No | Ordering — this is how "primary" is expressed |
| `active` | Boolean (default True) | No | Soft archive |

Unique constraint: `unique(sanitized_acc_number, partner_id)` — "The combination Account Number/Partner must be unique." ([source](https://github.com/odoo/odoo/blob/18.0/odoo/addons/base/models/res_bank.py))

The **bank institution** is a separate model, `res.bank`, with `name` (required), `street`, `street2`, `zip`, `city`, `state`, `country`, `country_code`, `email`, `phone`, `active`, and `bic` — help text "Sometimes called BIC or Swift." ([source](https://github.com/odoo/odoo/blob/18.0/odoo/addons/base/models/res_bank.py))

**Design lesson from Odoo:** there is no `iban` column, no `routing_number` column, no `sort_code` column. There is *one* generic `acc_number` string, and the format is inferred and validated per country. Local clearing codes (sort code, etc.) are pushed out to community addons — e.g. `partner_bank_code` ([PyPI](https://pypi.org/project/odoo-addon-partner-bank-code/19.0.1.0.0.1/)) and `partner_bank_sort_code`, described as "Adds a field in banks to manage Sort Codes" ([PyPI](https://pypi.org/project/odoo10-addon-partner-bank-sort-code/10.0.1.0.0.99.dev3/)).

### 1.2 NetSuite

NetSuite's counterparty bank data lives on **Entity Bank Details** records, unlocked by the Electronic Bank Payments / EFT bundle. For US vendors, the documented fields are ([Oracle NetSuite help, section N1660722](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1660722.html)):

| Field label (verbatim) | Requirement |
|---|---|
| **Name** | Unique name for this bank detail record |
| **Payment File Format** | `ACH-CCD/PPD` or `ACH-CTX (Free Text)` |
| **Type** | Whether this is the vendor's **primary or secondary** bank account |
| **Bank Account Number** | Up to 17 digits |
| **Bank Number** | The 9-digit routing number of the entity's bank |

Prerequisite: the **EFT Bill Payment** checkbox must be ticked on the vendor's Bank Payment Details subtab before bank details can be created. Multiple bank accounts per vendor are supported. Note this specific page is US/ACH-only — IBAN, SWIFT/BIC and currency are not in it; NetSuite exposes those through other country-specific payment file formats. **[UNVERIFIED]** — I did not find a single NetSuite page enumerating the international field set, so I can't give verbatim NetSuite IBAN/BIC field labels.

Enabling EFT is what makes the bank fields appear on vendor, employee and bank account records at all ([Oracle NetSuite help](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1659433.html)).

### 1.3 Microsoft Dynamics 365 Business Central

Business Central has a dedicated **Vendor Bank Account** table (table 288). Documented sensitive fields: **Bank Branch No.**, **Bank Account No.**, **SWIFT Code**, **IBAN Code** ([Microsoft Learn — Set Up Vendor Bank Account](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-set-up-vendors-bank-accounts)). The doc notes vendor bank accounts store "contact information, SWIFT, and IBAN codes."

Microsoft's docs call these fields out explicitly as "sensitive business data" — that phrasing is theirs, and it's the hook for the field-monitoring feature covered in §4.5.

BC also tracks **historical IBANs** when a vendor's bank account number changes — a shipped release-plan feature, "keep track historical iban number when vendor bank account number changes" ([Microsoft release plan](https://learn.microsoft.com/en-us/dynamics365-release-plan/2021wave2/smb/dynamics365-business-central/keep-track-historical-iban-number-when-vendor-bank-account-number-changes)). Relevant to us: they treat the *change history* of the account number as a first-class requirement, not an afterthought.

### 1.4 Dynamics 365 Finance (the larger sibling)

D365 Finance has a `VendBankAccount` table and a configurable approval workflow over it (covered in detail in §5). Field-level detail not fully enumerated here — **[UNVERIFIED]**.

### 1.5 SAP Business One

Business partner bank accounts are stored in table **OCRB** ("BP Bank Accounts"). It holds IBAN and BIC/SWIFT; the DI API object exposes a `BPBankAccounts` collection containing a `BICSwiftCode` field ([SAP Community](https://community.sap.com/t5/enterprise-resource-planning-q-a/table-name-for-iban-and-swift-code/qaq-p/6315134), [SAP Community — DTW Update BIC/SWIFT Code in OCRB](https://community.sap.com/t5/enterprise-resource-planning-q-a/dtw-update-bic-swift-code-in-ocrb/qaq-p/9096909)). A BIC/SWIFT can be defined per bank account. SAP's SEPA guide confirms IBAN and BIC are the account and bank identifiers ([SAP SEPA How-To Guide, PDF](https://help.sap.com/doc/011000358700001155172013e/9.1/en-US/HowTo_SEPA_BFFs_91.pdf)).

Full OCRB column list **[UNVERIFIED]** — I could not find an authoritative public field dictionary for OCRB.

### 1.6 Xero

Xero is the outlier and the most instructive one. On a Contact, bank details are essentially: **BankAccountNumber**, **BankAccountName**, and **Details** (a payment reference/particulars field). The API historically exposes only `BankAccountDetails` (the number) — `BankAccountName` and `Details` are *not* settable via the API, and Xero's own response explains why:

> "Setting these details will be addressed after work has been done to add an enhanced permissions model to the API as there are quite specific rules about when a user can edit these details."
> — [Xero Developer Ideas](https://xero.uservoice.com/forums/5528-xero-accounting-api/suggestions/2480450-be-able-to-specify-and-get-all-the-bank-account-de)

Without `BankAccountName` populated, batch payments fail ([Xero Community](https://community.xero.com/developer/discussion/10516528/); [Batch Payments API](https://developer.xero.com/documentation/api/accounting/batchpayments)).

**This is a direct signal for Carbon:** a mature vendor deliberately withheld API write access to counterparty bank fields because they hadn't built a permission model granular enough to govern it. Bank detail writes need their own permission before they need an API.

### 1.7 QuickBooks Online

QBO does not let you read back the full number at all. It masks to the **last four digits** for employees, contractors and vendor payment setups, and the full account/routing numbers cannot be viewed from normal QBO screens ([QuickBooks Community](https://quickbooks.intuit.com/community/other-questions-9/how-can-i-see-full-account-number-and-routing-number-of-my-vendors-and-contractors-92412)). Intuit's guidance when you need to verify is to get a voided check or a signed direct-deposit authorization form out-of-band — not to read it back out of the system.

### 1.8 Synthesis — the field set worth modelling

| Concern | Field | Notes |
|---|---|---|
| Holder | `account_holder_name` | Often differs from the supplier's legal name — a real fraud signal when it does |
| Account | `account_number` *or* `iban` | Odoo proves one generic field + inferred type works |
| Bank id (intl) | `swift_bic` | 8 or 11 chars, ISO 9362 |
| Bank id (local) | `routing_number` (US, 9 digits) / `sort_code` (UK, 6) / `BSB` (AU, 6) | A `(clearing_code_type, clearing_code)` pair generalizes better than one column per country |
| US-only | `account_type` (checking / savings) | Required by ACH; NetSuite has a "Bank Account Type" field |
| Routing context | `country`, `currency` | |
| Bank | `bank_name`, `bank_address` | Wires often need the bank's address |
| Control | `is_primary` / `sequence`, `active`, `allow_out_payment` | |

US ACH needs routing + account + account type. There is no IBAN in the US. International needs IBAN + BIC. A payments-capable schema needs both shapes, and a per-country clearing code (sort code, BSB, etc.) is entered into the ISO 20022 clearing field, e.g. Australian BSB as `AU` + 6 digits ([Nordea country-specific bank connection information, PDF](https://www.nordea.fi/Images/147-81974/electronicforeigncurrencypayments-countryspecificbankconnectionInformation-feb2022en.pdf); [Nacha ISO 20022 Credit Transaction Guide, PDF](https://www.nacha.org/system/files/2023-08/NACHA_ISO20022_Guide_pain.001_credit%2008-09-23.pdf)).

---

## 2. Cardinality

**Unanimous across every system I checked: MANY bank accounts per supplier, with one designated for default use.** Nobody models it as one-to-one.

- **Odoo** — `res.partner.bank` is a one-to-many off the partner (`bank_ids`). Ordering is by `sequence`; the first is effectively the default. There is no boolean `is_primary` field in 18.0 ([source](https://github.com/odoo/odoo/blob/18.0/odoo/addons/base/models/res_bank.py)).
- **NetSuite** — "You can set up multiple bank accounts for each vendor," and the **Type** field explicitly selects *primary or secondary* ([Oracle](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1660722.html)).
- **Business Central** — "If a vendor has one or more bank accounts…"; additional accounts are managed on the **Vendor Bank Account List** page, and a single default is chosen via the **Preferred Bank Account Code** field on the **Payments** FastTab of the vendor card, which then flows onto payment journal lines ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-set-up-vendors-bank-accounts)).

### What distinguishes the accounts

1. **Currency** — Odoo has `currency_id` on the account. A supplier billing in USD and EUR needs one account per currency.
2. **Company / legal entity** — Odoo's `company_id`. In a multi-company install, the account may belong to only one of your entities.
3. **Country / payment rail** — a supplier may have a domestic ACH account and an international IBAN.
4. **Direction / purpose** — Odoo's `allow_out_payment` boolean gates whether an account can receive *outgoing* payments at all. This is the cleanest expression I found of "this account is for receiving payments from us" vs. "we merely know about it."
5. **Lifecycle** — `active` for soft-archive; BC keeps historical IBANs after a change.

**Recommendation for Carbon:** many-to-one, with an explicit default per (supplier, currency) rather than a single global primary — the currency dimension is the one that actually bites. Do not hard-delete; archive, because a paid invoice must still resolve which account it was paid to.

---

## 3. Validation

### 3.1 IBAN — ISO 13616, mod-97

This is the one with a real checksum, and every serious system implements it. Odoo's implementation, verbatim from [`addons/base_iban/models/res_partner_bank.py`](https://github.com/odoo/odoo/blob/18.0/addons/base_iban/models/res_partner_bank.py):

```python
def validate_iban(iban):
    iban = normalize_iban(iban)
    if not iban:
        raise ValidationError(_lt("There is no IBAN code."))

    country_code = iban[:2].lower()
    if country_code not in _map_iban_template:
        raise ValidationError(_lt("The IBAN is invalid, it should begin with the country code"))

    iban_template = _map_iban_template[country_code]
    if len(iban) != len(iban_template.replace(' ', '')) or not re.fullmatch("[a-zA-Z0-9]+", iban):
        raise ValidationError(...)

    check_chars = iban[4:] + iban[:4]
    digits = int(''.join(str(int(char, 36)) for char in check_chars))  # BASE 36: 0..9,A..Z -> 0..35
    if digits % 97 != 1:
        raise ValidationError(_lt("This IBAN does not pass the validation check, please verify it."))
```

The algorithm, stated plainly:

1. Strip spaces, uppercase.
2. Check the first two chars are a known ISO 3166-1 country code, and that the **length matches that country's expected IBAN length** — this is a per-country table, not a constant. Odoo ships 86 country templates.
3. Move the first four characters (country code + 2 check digits) to the end.
4. Replace each letter with its base-36 value (`A`=10 … `Z`=35), producing a very long integer.
5. Valid iff that integer **mod 97 == 1**.

Note step 2: a length table per country is mandatory. Mod-97 alone will happily accept a truncated IBAN. Odoo raises a message naming the expected template, "Where B = National bank code, S = Branch code, C = Account No, k = Check digit."

Worth knowing: Odoo has had a bug report titled "IBAN validation ignored" ([odoo#49900](https://github.com/odoo/odoo/issues/49900)) — even a mature implementation can end up with the validator not firing on some code paths. Validate on the model/DB layer, not only in the form.

Business Central also validates IBAN ([Dynamics community](https://community.dynamics.com/blogs/post/?postid=e20b8e6f-b472-44cf-9d3c-ae9ec0b91e90)).

### 3.2 ABA / US routing number — weighted mod-10

Nine digits. Weights `3 7 1` repeating across the nine positions:

```
position: 1 2 3 4 5 6 7 8 9
weight:   3 7 1 3 7 1 3 7 1
```

Valid iff `3*(d1+d4+d7) + 7*(d2+d5+d8) + 1*(d3+d6+d9) ≡ 0 (mod 10)`. The 9th digit is the check digit, computed from the first eight ([BrainJar validation algorithms](http://www.brainjar.com/js/validation/); [Apache Commons Validator `ABANumberCheckDigit`](https://commons.apache.org/validator/apidocs/org/apache/commons/validator/routines/checkdigit/ABANumberCheckDigit.html)). A single mistyped digit, or two transposed digits, almost always breaks it.

Caveat worth stating to users: a valid checksum means the number is *well-formed*, not that the bank exists or the account exists. Real assurance needs a routing directory lookup or a bank-side account validation service.

### 3.3 SWIFT / BIC — ISO 9362, format only

**8 or 11 characters, no checksum.** Structure ([Swift — Business Identifier Code](https://www.swift.com/standards/data-standards/bic-business-identifier-code); [ISO 9362:2014](https://www.iso.org/standard/60390.html); [XMLdation knowledge base](https://knowledge.xmldation.com/support/iso20022/general_rules/bic)):

| Positions | Content |
|---|---|
| 1–4 | Institution / business party prefix — **4 letters** |
| 5–6 | Country code — **2 letters**, ISO 3166-1 alpha-2 |
| 7–8 | Location code — **2 alphanumeric** |
| 9–11 | Branch code — **optional, 3 alphanumeric**; `XXX` denotes the primary/head office |

Regex: `^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$`. Validation is structural only — you cannot detect a typo in a BIC by arithmetic. The only real check is a lookup against the Swift BIC directory.

### 3.4 Local clearing codes — format only

- **UK sort code** — six digits, conventionally `12-34-56`; hierarchically addresses clearing bank → region → branch ([Wikipedia: Sort code](https://en.wikipedia.org/wiki/Sort_code)).
- **Australian BSB** — six numerals, first two or three identify the bank ([Wikipedia: Bank state branch](https://en.wikipedia.org/wiki/Bank_state_branch)).

Neither carries a general-purpose checksum. **[UNVERIFIED]** — some UK banks apply modulus checks over sort code + account number together (the "modulus checking" weight tables), but I did not verify a primary source for that in this pass; treat as a lead, not a fact.

### 3.5 Validation posture

Checksums catch typos. They catch **zero** fraud — a fraudster supplies a real, valid account number belonging to themselves. Do not let a green "valid IBAN" tick imply the account is legitimate. §5 is where actual fraud control lives.

---

## 4. Security & compliance

### 4.1 PCI-DSS — your instinct is correct: NOT in scope

Confirmed from the PCI Security Standards Council's own FAQ, "Does PCI DSS apply to bank account data?":

> Bank account data, such as branch identification numbers, bank account numbers, sort codes, routing numbers, etc., are **not considered payment card data, and PCI DSS does not apply** to this information.

([PCI SSC FAQ](https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/Does-PCI-DSS-apply-to-bank-account-data/))

The one exception: if a bank account number *is* a PAN or contains a PAN, PCI DSS applies. Not our case.

### 4.2 What regime DOES apply

**Nacha — the closest thing to a mandate for US ACH.** Nacha's "Supplementing Data Security Requirements" rule requires covered entities to:

> "protect DFI Account Numbers used in the initiation of Entries by rendering them **unreadable when stored electronically**"

([Nacha](https://www.nacha.org/rules/supplementing-data-security-requirements))

- **Who:** non-consumer Originators that are not Participating DFIs, Third-Party Senders, and Third-Party Service Providers performing ACH processing functions. Financial institutions are excluded (already regulated).
- **Thresholds:** Phase 1 effective **June 30, 2021** for entities exceeding **6 million** ACH entries/year; Phase 2 effective **June 30, 2022** for entities exceeding **2 million**/year. Thereafter, any entity crossing 2M entries in a calendar year must comply by June 30 of the following year.
- **Acceptable methods:** the rule is implementation-neutral — "Encryption, truncation, tokenization, destruction, or having the financial institution store, host, or tokenize the account numbers, are among options."

**Relevance to Carbon:** Carbon almost certainly sits below 2M ACH entries/year today, so the rule likely does not *bind* us — but (a) it's the de facto standard of care, (b) a customer's own compliance team may push it down to us contractually, and (c) if Carbon ever originates ACH on customers' behalf, the Third-Party Sender / TPSP language starts to matter. "Unreadable when stored electronically" is a good design target regardless.

Note also: ACH data has no PCI-equivalent *enforced* standard; Nacha best practices are largely advisory outside the rule above ([Modern Treasury](https://www.moderntreasury.com/journal/what-is-the-pci-of-bank-payments); [Skyflow](https://www.skyflow.com/post/are-you-protecting-your-customers-ach-banking-data-heres-why-you-should)). And the asymmetry matters: a card charge needs PAN + expiry + CVV, whereas ACH needs only a routing number (public) plus an account number — so **the account number alone is the whole secret** ([Modern Treasury](https://www.moderntreasury.com/journal/what-is-the-pci-of-bank-payments)).

### 4.3 GDPR

- A bank account number / IBAN **is personal data** when it relates to an identifiable natural person (a sole-trader supplier, an individual contractor, a customer being refunded). For a limited company supplier, the account number alone is generally not personal data, though the contact names attached to it are.
- It is **not** Article 9 special-category data. Article 9's list (racial/ethnic origin, political opinions, religious beliefs, trade union membership, genetic, biometric, health, sex life, sexual orientation) is a **closed category**, and financial data is not on it ([Article 9 text](https://gdpr-info.eu/art-9-gdpr/); [VeraSafe](https://verasafe.com/blog/special-categories-of-personal-data-under-the-gdpr/)). So no Article 9 lawful-basis gymnastics required.
- **Article 32 (Security of processing)** is the operative one. It requires "appropriate technical and organisational measures to ensure a level of security appropriate to the risk," and names **pseudonymisation and encryption** of personal data as example measures, alongside confidentiality/integrity/availability/resilience and regular testing ([Art. 32 GDPR](https://gdpr-info.eu/art-32-gdpr/)).
- Article 32 is **risk-proportionate, not absolute** — regulators do not require that every byte be encrypted, but they expect encryption where it is an effective and proportionate risk reduction. For a field whose disclosure enables direct financial loss, that bar is easily met.

Practical consequence: bank details are a strong candidate for GDPR erasure/rectification requests and for inclusion in a data-processing record. **[UNVERIFIED]** — I did not research retention-period guidance specific to bank details; note that tax/audit retention obligations usually conflict with erasure requests here.

### 4.4 NIST 800-171 / SOC 2

- **NIST SP 800-171** protects **CUI** in nonfederal systems ([NIST SP 800-171r3](https://csrc.nist.gov/pubs/sp/800/171/r3/final)). Commonly cited examples of CUI include **bank routing numbers and account numbers** alongside SSNs and credit card numbers ([Kiteworks](https://www.kiteworks.com/risk-compliance-glossary/protect-cui-with-nist-800-171-compliance/)). This only binds Carbon if Carbon (or its customers, flowing it down) handles federal contract information — **highly relevant for a manufacturing ERP**, since defense/aerospace manufacturers are exactly the population subject to 800-171/CMMC. Worth flagging to whoever owns Carbon's compliance posture: if we target defense manufacturing, 800-171 is a live constraint, not a hypothetical. **[UNVERIFIED]** — whether Carbon's actual customer base triggers this.
- **SOC 2** has no field-level rule for bank accounts. It's a controls audit against Trust Services Criteria; the **Confidentiality** criterion is where this lands, and auditors will look for access restriction, encryption, and change logging as evidence ([framework comparison](https://stackcyber.com/posts/compliance-framework-comparison)). Practically: whatever we build, SOC 2 wants us to be able to *demonstrate* who can see bank details and who changed them — which argues for audit logging as a compliance deliverable, not just a nice-to-have.

### 4.5 Encryption at rest — is field-level encryption standard?

**Honest answer: there is no single published standard, and I could not find an ERP vendor stating "we field-level-encrypt vendor bank details." Marked [UNVERIFIED] as a universal claim.**

What I *can* establish:

- Nacha's rule says "unreadable when stored electronically" and accepts **encryption, truncation, tokenization, or destruction** — a menu, not a mandate for one technique ([Nacha](https://www.nacha.org/rules/supplementing-data-security-requirements)). Disk-level/TDE encryption is generally **not** considered to satisfy "render unreadable" in the spirit of these rules, because it protects against stolen disks but not against an application-level or DBA-level read — but I did not find Nacha explicitly saying TDE is insufficient. **[UNVERIFIED]**.
- GDPR Art. 32 names encryption as an example measure, proportionate to risk, without specifying the layer ([Art. 32](https://gdpr-info.eu/art-32-gdpr/)).
- QBO's behaviour — the full number is not retrievable through the UI at all ([QuickBooks Community](https://quickbooks.intuit.com/community/other-questions-9/how-can-i-see-full-account-number-and-routing-number-of-my-vendors-and-contractors-92412)) — is consistent with storage that the application deliberately does not read back for display. Whether that's encryption or tokenization, Intuit doesn't say.

**Pragmatic recommendation for Carbon:** treat disk/DB-level encryption as the floor, not the answer. The threat that matters is not a stolen disk — it's a compromised app-level credential, an over-broad internal role, or a leaked DB dump/backup. Application-layer encryption of `account_number` / `iban` with a KMS-held key, plus a separately-stored plaintext `last4` for display, gets you: (a) "unreadable when stored," (b) masked UI for free, (c) decryption becomes an auditable event. That is a meaningfully different security property from TDE and costs little at Carbon's likely data volume.

### 4.6 Masking in the UI

Masking to the **last four digits** is observably the norm:

- **QuickBooks Online** — "you'll normally only see the last four digits" for employees, contractors and vendor payment setups; full numbers are not viewable from regular QBO screens, and Intuit's recommended path to verify is a voided check or authorization form obtained out-of-band ([QuickBooks Community](https://quickbooks.intuit.com/community/other-questions-9/how-can-i-see-full-account-number-and-routing-number-of-my-vendors-and-contractors-92412)).
- Government/public-sector systems mask on reports as a deliberate control — e.g. Texas Comptroller change requests "Mask Account Numbers on Monthly Direct Deposit Reports" and "Mask Account Numbers on Direct Deposit Reports" ([ACR 60446](https://fmx.cpa.texas.gov/fmx/changes/tins/2021/60446.php), [ACR 60486](https://fmx.cpa.texas.gov/fmx/changes/tins/2022/60486.php)). Note: these are *reports*, not just screens — masking must cover exports and printed output too, which is easy to forget.

**Who can see the full number?** The best-documented model is **Xero's**: editing contact bank account details requires a distinct **"bank account admin"** permission, which is *not* granted by default and must be explicitly added to a user. It can only be added to the advisor, standard, invoice-only (purchases), or invoice-only (approve & pay) roles ([Xero Central — Give users the bank account admin permission](https://central.xero.com/s/article/Give-Contact-Bank-Account-Admin-permission-to-a-user)). Xero also cited "quite specific rules about when a user can edit these details" as the reason the API can't write them ([Xero Developer Ideas](https://xero.uservoice.com/forums/5528-xero-accounting-api/suggestions/2480450-be-able-to-specify-and-get-all-the-bank-account-de)).

**[UNVERIFIED]** — I could not confirm whether Xero's bank-account-admin permission also gates *viewing* (as opposed to editing) the number, nor whether Xero masks in list views.

**Recommendation:** separate `view_full_bank_details` from `edit_bank_details` from ordinary supplier read access. Default everyone to masked. Log every unmask.

### 4.7 Audit logging / change tracking

**Yes, this is standard, and it's the single most consistent finding across vendors.**

- **Business Central** ships a **field monitoring** feature aimed squarely at this. Microsoft's own doc: some vendor bank account fields "contain sensitive business data, such as the **Bank Branch No.**, **Bank Account No.**, **SWIFT Code**, and **IBAN Code** fields. You can monitor such fields and get notified when someone changes their values" ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-set-up-vendors-bank-accounts)). Setup nominates the monitored fields and a notification recipient, via the Monitored Fields Worksheet — a practitioner walkthrough covers table 288 / Bank Acct No. specifically ([Kristen Hosman](https://www.kristenhosman.com/2024/05/scenario-client-wants-field-monitoring.html)).
- **Business Central** also retains **historical IBANs** across changes ([Microsoft release plan](https://learn.microsoft.com/en-us/dynamics365-release-plan/2021wave2/smb/dynamics365-business-central/keep-track-historical-iban-number-when-vendor-bank-account-number-changes)).
- **D365 Finance** keeps full workflow history on bank account approvals — "select **Workflow > View history**" ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/vendor-bank-account-workflow)).

**Why it matters:** in a BEC/vendor-fraud incident, the forensic question is always *who changed the account number, when, from what value, and from which session*. Without before/after values you cannot answer it, cannot recall the payment credibly, and cannot support an insurance or law-enforcement claim. Change history is also the substrate for the detective controls in §5 — you cannot notify on a change you did not record.

**Design note:** the audit log must store the *old and new values*. But those values are the sensitive data — so an audit log of bank detail changes inherits the same encryption and access controls as the field itself, or you've just created an unprotected plaintext copy. This is an easy and common mistake.

---

## 5. Fraud — BEC / vendor bank detail fraud

### 5.1 The threat, with numbers

FBI IC3 PSA I-060923-PSA, "Business Email Compromise: The $50 Billion Scam" ([ic3.gov](https://www.ic3.gov/PSA/2023/psa230609)), reports for October 2013 – December 2022:

- **277,918** total domestic and international incidents
- **$50,871,249,501** in total exposed dollar losses globally
- US victims specifically: **137,601** victims, **$17,328,435,141** in losses

The attack pattern relevant to us: a fraudster (often via a compromised supplier mailbox — "vendor email compromise") emails AP claiming the supplier's bank details have changed. The change is applied. Subsequent legitimate invoices are paid to the fraudster. Nothing is technically exploited; the ERP does exactly what it was told.

### 5.2 Guidance

IC3's recommendations, verbatim from the PSA, with the first being the one that matters here:

> - "**Use secondary channels or two-factor authentication to verify requests for changes in account information.**"
> - "Ensure the URL in emails is associated with the business/individual it claims to be from."
> - "Be alert to hyperlinks that may contain misspellings of the actual domain name."
> - "Refrain from supplying login credentials or PII of any sort via email."
> - "Verify the email address used to send emails, especially when using a mobile or handheld device"
> - "Ensure the settings in employees' computers are enabled to allow full email extensions to be viewed."
> - "Monitor your personal financial accounts on a regular basis for irregularities, such as missing deposits."

([IC3 PSA 230609](https://www.ic3.gov/PSA/2023/psa230609))

The standard operational elaboration is to **call back on a phone number already on file from a prior invoice — never a number supplied in the change request itself** ([U.S. Bank](https://www.usbank.com/corporate-and-commercial-banking/insights/risk/mitigation/BEC-recognize-a-scam.html)). FBI also frames BEC as exploiting routine trusted business relationships rather than technical vulnerabilities ([FBI](https://www.fbi.gov/how-we-can-help-you/scams-and-safety/common-frauds-and-scams/business-email-compromise)).

### 5.3 What ERPs actually implement

**D365 Finance — the reference implementation.** The "Vendor bank account change proposal workflow" (v10.0.32+, enabled via feature management) is the most complete control I found, and Microsoft states its purpose plainly:

> "The vendor bank approval workflow ensures that bank data that suppliers submit is secure, financially compliant, and protected against fraud. This feature helps reduce the risk of fraud by detecting and preventing unapproved changes."

([Microsoft Learn — Vendor bank account workflow](https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/vendor-bank-account-workflow))

Its design is worth copying closely:

**Configuration** (Accounts payable parameters → General → Vendor bank account approval FastTab):

- **Bank account approval (create)** — *Yes* requires approval for all new bank account records, "regardless of whether the web client is used or records are imported through the data entity."
- **Bank account approval (update)** — *Yes* requires approval on update, but "**only for fields where the IsEnabled checkbox is selected**" — i.e. **field-level** protection, not record-level. You nominate exactly which fields are protected.
- **Data entity behavior (update)** — governs the **API/import** path separately from the UI, with three options:
  - *Allow changes without approval*
  - *Reject changes* — "The data entity will never update values for protected fields. The import will fail if it includes updates for protected fields."
  - *Create change proposals* — non-protected fields update; protected fields land as proposed changes awaiting submission.

**The change-proposal mechanism.** Editing a protected field does **not** mutate the record. The new value is held as a *proposed change* while the record keeps its old value. Fields requiring approval are visually marked **"(requires approval)"** in the UI. The submitter can review via a **Proposed changes** dialog and discard individually or in bulk. Approvers see **current and proposed value side by side** before approving. Only after approval does the system write the proposed values.

**Review status** is a first-class field on every vendor bank account record:

| Review status | Meaning |
|---|---|
| *Draft* | New record, not yet submitted |
| *Approved* | All new/updated settings approved |
| *Approved, changes not submitted* | Protected fields edited, not yet submitted |
| *Approved, pending changes* | Protected fields edited and submitted, awaiting approval |

**Critically: "The new bank account record won't be available for use until an approver has approved it."** Unapproved accounts cannot be paid to.

Approvers can approve, reject (record returns to its pre-submission status for edit/resubmit), delegate to another approver, or cancel. Full workflow history is retained via **Workflow > View history**.

**Business Central** takes the lighter, detective approach: field monitoring notifies a nominated person the moment a monitored sensitive field (Bank Account No., IBAN, SWIFT, Bank Branch No.) changes ([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-set-up-vendors-bank-accounts); [Kristen Hosman](https://www.kristenhosman.com/2024/05/scenario-client-wants-field-monitoring.html)). BC also supports approval workflows generally ([Microsoft Learn — Using approval workflows](https://learn.microsoft.com/en-us/dynamics365/business-central/across-use-workflows)).

**That BC's native story is weaker is evidenced by a third-party market:** multiple ISVs sell vendor-bank-approval apps for BC — e.g. AMJS Consulting's "Vendor Bank Account Approval Workflow" ([Microsoft Marketplace](https://marketplace.microsoft.com/en-us/product/dynamics-365-business-central/PUBID.amjsconsulting1621353404525|AID.vendor_bank_account_approval_workflow|PAPPID.00d28d75-cf08-43fa-8287-dd21876722d1?tab=Overview)) and ASQ IT's "Vendor Bank Approvals" ([asqit.co.uk](https://www.asqit.co.uk/products/vendorbankapprovals), [Advantage Business Systems](https://www.advantage.co.uk/microsoft-dynamics/addons-and-integrations/vendor-bank-approvals-for-business-central)). When customers pay for an add-on to get a control, the control is table stakes.

**Odoo** implements a minimal version: `allow_out_payment` must be true or payment orders are blocked, and **setting it requires membership of a dedicated "Validate bank accounts" group** — a separation of the person who *enters* an account from the person who *authorizes it for payment*. Confirming a payment order containing a bank account with `allow_out_payment = False` produces a blocking error ([OCA bank-payment-alternative](https://github.com/OCA/bank-payment-alternative); [odoo#249885](https://github.com/odoo/odoo/issues/249885)). There is also an OCA module `partner_bank_mail_thread` that puts a chatter/audit trail on bank accounts ([PyPI](https://pypi.org/project/odoo10-addon-partner-bank-mail-thread)).

### 5.4 Control checklist

Mapping what the evidence supports:

| Control | Evidence | Verdict for Carbon |
|---|---|---|
| **Approval workflow on bank detail changes** | D365 Finance change proposals; BC ISV add-ons | **Core.** The single highest-value control. |
| **Field-level (not record-level) protection** | D365 `IsEnabled` per field | **Core.** Editing a phone number shouldn't need CFO sign-off; editing an IBAN should. |
| **New account unusable until approved** | D365: "won't be available for use until an approver has approved it" | **Core.** Prevents the create-and-immediately-pay path. |
| **Old value retained during pending change** | D365 change proposals; BC historical IBAN | **Core.** Also gives the approver a diff. |
| **Separate API/import policy from UI policy** | D365 "Data entity behavior (update)" | **Important.** An unguarded import endpoint defeats a UI-only approval gate. Carbon has APIs — this is a real hole. |
| **Segregation of duties / dual authorization** | Odoo "Validate bank accounts" group; D365 approver ≠ submitter | **Core.** Submitter must not be able to self-approve. |
| **Change notification to a nominated person** | BC field monitoring | **High value, low cost.** Cheap detective control even before full workflow exists. |
| **Out-of-band verification (callback to a number on file)** | IC3 PSA 230609; U.S. Bank | **Process, not code** — but Carbon can *support* it: a required "verification method / verified by / verified on" attestation captured at approval time. |
| **2FA / secondary channel on change requests** | IC3: "Use secondary channels or two-factor authentication to verify requests for changes in account information" | Consider step-up auth on the approve action. |
| **Cooling-off period before first payment to a new account** | **[UNVERIFIED]** | I found **no** ERP vendor documenting a built-in cooling-off/quarantine period. It's discussed as a banking/AP practice but I could not cite a primary ERP source. Treat as an idea, not an industry norm. |
| **Audit log with before/after values** | BC field monitoring; D365 workflow history | **Core.** See §4.7 — and encrypt the log. |

---

## Summary of what should change Carbon's design

1. **Cardinality: many accounts per supplier/customer, never one.** Distinguish by currency first, then company/country. Archive, never hard-delete — historical payments must resolve their account.
2. **Field shape: one generic `account_number` + inferred type beats a column per country.** Odoo proves this at scale. Add `(clearing_code_type, clearing_code)` for local rails and a separate bank-institution record for SWIFT/BIC and address.
3. **PCI-DSS does not apply** — confirmed from PCI SSC. The governing regimes are Nacha's "render unreadable when stored electronically" (threshold-gated, likely non-binding for us today but the standard of care), GDPR Art. 32 (risk-proportionate encryption), and — if Carbon serves defense manufacturing — NIST 800-171, where routing/account numbers are cited CUI.
4. **Application-layer encryption + plaintext `last4`.** Disk/TDE is the floor, not the answer; the real threats are app-credential compromise and DB dumps. `last4` gives masked UI for free and makes each decrypt an auditable event.
5. **Three distinct permissions**, not one: read supplier / view full bank details / edit bank details. Xero deliberately shipped a separate non-default "bank account admin" permission and withheld API writes until its permission model caught up — a direct precedent.
6. **Approval workflow with change proposals is the core anti-fraud control**, modelled on D365: field-level protection, old value retained while the new one is pending, side-by-side diff for the approver, new accounts unusable until approved, submitter ≠ approver.
7. **Gate the API/import path separately from the UI.** D365 has an explicit parameter for this. A UI-only approval gate with an open import endpoint is not a control.
8. **Audit log with before/after values is mandatory** — and must itself be encrypted and access-controlled, or it becomes an unprotected plaintext copy of the data you just protected.
9. **Masking must cover exports and printed reports, not just screens.**
10. **Checksums catch typos, not fraud.** Don't let a green validation tick imply legitimacy.

## Open / unverified items

- NetSuite's international (IBAN/BIC) field labels — not found in a single authoritative page.
- Full SAP Business One OCRB column list — no public field dictionary found.
- Whether Xero's bank-account-admin permission gates *viewing* as well as editing.
- Whether Nacha explicitly rejects TDE/disk encryption as satisfying "render unreadable."
- UK modulus checking (sort code + account number combined checksum) — plausible lead, not verified here.
- Cooling-off / quarantine periods before first payment to a newly added account — no ERP vendor documentation found.
- Retention-period guidance for bank details under GDPR vs. tax/audit retention obligations.
