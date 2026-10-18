# Page-Level Permissions Research: Best Practices Survey

## Summary

This survey compares how six products grant access. It covers six topics:
the unit a permission attaches to, levels against independent flags,
reference data in a dropdown, per-person changes to a role, postings, and API
credentials. Five products attach access to a screen or record type
and group it by module. Four use an ordered ladder of levels. Four give every
internal user read access to reference data, or show it in lookups without
access to its own screen. Only NetSuite and Infisical let a per-person setting
remove access that a role grants. Every product lets a posting write ledger
data that the user cannot write directly.

## Competitors Surveyed

- **SAP S/4HANA and SAP Business One**: the enterprise reference; Business One
  is the closest SAP product to Carbon's market.
- **Oracle NetSuite**: the mid-market cloud ERP leader; its role editor is the
  common reference for level-based permissions.
- **Acumatica**: per-screen access rights, the closest match to the
  per-page grid Carbon wants.
- **Microsoft Dynamics 365 Business Central**: permission sets and the
  "indirect" permission for postings.
- **Odoo**: open-source ERP with groups, model access rights and implied groups.
- **Infisical**: not an ERP. Its folder-based access adds a per-person grant
  on top of a role, which is the override model Carbon chose.

## Key Consensus Patterns

### 1. Access attaches to a screen or record type, grouped by module

- **SAP Business One**: the General Authorizations window lists modules, forms
  and functions in the order of the main menu. A module setting applies to its
  forms [20].
- **NetSuite**: a role's Permissions subtab has the subtabs Transactions,
  Reports, Lists and Setup. Each permission is one record type, task or page
  [N1].
- **Acumatica**: rights attach to workspaces, forms, containers, fields and
  actions. A form inherits from its workspace [A1].
- **Odoo**: a group carries model access rights, record rules and menus. An
  application category groups the groups [O1].
- **Rationale**: an admin thinks in screens, and a screen maps to one kind of
  record. The module is only the grouping.

### 2. Access is an ordered ladder of levels

- **NetSuite**: None, View, Create, Edit, Full. Each level adds one capability:
  Create adds new records, Edit adds changes to existing records, Full adds
  delete [N2].
- **Acumatica**: Revoked, View Only, Edit, Insert, Delete. Its order puts Edit
  before Insert, the reverse of NetSuite [A1].
- **SAP Business One**: No Authorization, Read-Only, Full Authorization [20].
- **SAP S/4HANA Cloud**: Read (with value help) and Write. One Write grant covers
  create, change and delete [5][6].
- **Odoo**: the per-app choice is a ladder (Inventory User, then
  Administrator), built from implied groups [O2].
- **Business Central** is the exception: Read, Insert, Modify, Delete and
  Execute are independent flags [B1].
- **Rationale**: a ladder makes illegal states impossible (create without
  view) and gives the admin one choice per screen.
- **Edge case**: some screens support only part of the ladder. NetSuite gives
  some permissions VIEW only [N2]. In Business One, some items have no
  Read-Only level [22].

### 3. Reference data is readable without its maintenance screen

- **Odoo**: the Internal User group reads units of measure, payment terms,
  stock locations and currencies [O3]. The name of a value already on a record
  is read as superuser [O4].
- **Business Central**: D365 BASIC "grants Read access to almost all
  application tables" [B2].
- **Acumatica**: an Acumatica employee and a forum thread report that lookups
  show records from screens the user cannot open [A2]. No official rule found.
- **SAP S/4HANA (on-premise)**: an F4 value help listed assets of company codes
  the user had no authorization for [7]. S/4HANA Cloud makes value help a
  category that an admin can restrict [5].
- **NetSuite**: no rule found. Unverified.
- **Rationale**: a buyer who picks payment terms on a purchase order has no
  reason to open the Payment Terms setup screen.

### 4. Roles add up; a per-person change is rare and awkward

- **Union**: Odoo [O1], Business Central [B1], Acumatica [A3], SAP [9] and
  Business One [20] all give the user the most permissive grant across roles.
- **NetSuite**: Global Permissions on the employee record take precedence over
  the role "even if global permissions are at a lower level". Oracle calls the
  feature "not preferred" [N3].
- **Business Central**: to remove one permission from one user, an admin makes
  a user-defined set that includes the base set and excludes the permission
  [B3].
- **Acumatica** and **Odoo**: no per-user override. An admin changes the
  user's roles or groups [A3][O1].
- **Infisical**: a per-person folder grant always wins. A fixed deny block
  removes every action on the folder, then the grant's tier adds back what it
  allows [I1].
- **Rationale**: products without overrides make admins create one-off roles.
  Oracle does not say why it calls Global Permissions "not preferred". Carbon's
  reading: the override is a second grant system beside the role.

### 5. Postings write what the user cannot write

- **Business Central**: an "Indirect" permission lets a user write a table only
  through an object that declares it. Sales-Post writes ledger entries this
  way [B4].
- **Odoo**: a salesperson invoices an order without billing rights. The code
  checks write access on the order, then creates the invoice with `sudo()` [O5].
- **SAP S/4HANA**: RAP `IN LOCAL MODE` and `PRIVILEGED` skip authorization
  checks inside the business object [14][15].
- **NetSuite**: a script can run with an "Execute As Role" [N4].
- **Rationale**: the user's right on the source document is the decision. The
  ledger write follows from it.

### 6. API credentials use the same model

- **NetSuite**: a token is valid for one company, user and role [N5].
- **Business Central**: an Entra app gets permission sets the same way a user
  does, but never SUPER [B5].
- **Acumatica** and **Odoo**: an integration acts as a user with that user's
  roles or groups [A4][O6].
- **SAP S/4HANA Cloud**: a communication user gets the authorizations of its
  communication scenario [17].
- **Rationale**: one model means one place to audit access.

## Answers to Research Questions

1. What does a permission attach to? A screen or record type, grouped by
   module (NetSuite, Acumatica, Business One, Odoo). Business Central attaches
   to objects (tables, pages, reports).
2. Ladder or flags? A ladder in NetSuite, Acumatica, Business One, SAP Cloud
   and Odoo. Business Central uses flags. NetSuite and Acumatica disagree on
   whether Create or Edit comes first.
3. Reference data in a dropdown? Odoo and Business Central give every user
   read access. Acumatica lookups show records without screen access
   (unofficial sources). NetSuite is unverified.
4. Per-person changes? NetSuite's Global Permissions add and remove, and win
   over the role. Infisical's folder grant does the same. Business Central uses
   include and exclude sets. Odoo and Acumatica have none.
5. Postings? Every product lets a posting write ledger data the user cannot
   write directly, after a check on the source document.
6. API credentials? The same role model in every product.

## Competitor-Specific Details

### NetSuite
- Restrictions (subsidiary, department, location) filter which records a
  permitted user sees. A user who creates a restricted record cannot view it
  afterwards [N6].
- One user can hold several roles but works in one role at a time [N7].

### Acumatica
- Version 2024 R1 removed "Not Set": a new role starts with Revoked on every
  object [A5].
- Actions such as Release have their own levels on the form [A3].

### Business Central
- The license is a ceiling: its values overrule a set that ranks higher [B1].
- Security filters give record-level access; across sets the least restrictive
  filter wins [B6].

### Odoo
- Global record rules intersect; group record rules unite [O1].
- An API key acts as its user with every group of that user. No scoping found
  [O6].

### Infisical
- Five tiers: List, Read, Edit, Manage, Full Access [I1].
- Grants store the folder's id, not its path, so a rename does not break them.
- A version counter per project, bumped on every write, is part of the cached
  permission fingerprint, so a change invalidates the cache at once [I1].

## Recommended Approach for Carbon

1. Attach access to a page, grouped by module, from a registry in code
   (NetSuite, Acumatica, Business One).
2. Use one ordered level per page: None, View, Create, Edit, Full, in
   NetSuite's order. It matches Carbon's existing view, create, update, delete
   actions. Let a page declare the highest level it supports (NetSuite,
   Business One).
3. Make reference data readable by every employee without its page level
   (Odoo, Business Central). Carbon's RLS already does this for 143 of its 296
   company tables, so the registry takes each page's read rule from RLS.
4. Combine the role with per-person overrides that add or remove, and let the
   override win (NetSuite, Infisical). Compile both into one result, so the
   override is not a second grant system beside the role.
5. Keep postings as they are: the service function checks the user's level on
   the source document, then writes ledgers as the system (Business Central
   "indirect", Odoo `sudo()`).
6. Use the same registry and levels for API key scopes (every product).
7. Put a version in the cached permission key, so a registry or grant change
   invalidates cached access at once (Infisical).

## Sources

- [N1] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326209.html
- [N2] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326341.html
- [N3] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N326630.html
- [N4] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_160130156224.html
- [N5] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1530099787.html
- [N6] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3781107123.html
- [N7] https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N295370.html
- [A1] https://help.myob.com.au/advanced/Docs/Published/UserGuide/User_Roles_Access_Levels.html
- [A2] https://asiablog.acumatica.com/index.php/2017/11/restrict-data-accessibility-using/ and https://community.acumatica.com/distribution-6/drop-down-for-inventory-items-when-entering-a-sales-order-35447
- [A3] https://help.myob.com.au/advanced/Docs/Published/UserGuide/User_Roles_User_Access_Level_Calculation.html
- [A4] https://help.myob.com.au/advanced/Docs/Published/IntegrationDevelopmentGuide/IS__how_Limit_API_Connections.html
- [A5] https://help.myob.com.au/advanced/Docs/Published/ReleaseNotes/RN_2024_R1_Platform_Changes_to_Access_Rights.html
- [B1] https://learn.microsoft.com/en-us/dynamics365/business-central/ui-define-granular-permissions
- [B2] https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/administration-special-permission-sets
- [B3] https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-permissionset-composing
- [B4] https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-permissions-property
- [B5] https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication
- [B6] https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/security/security-filters
- [O1] https://www.odoo.com/documentation/18.0/developer/reference/backend/security.html
- [O2] https://github.com/odoo/odoo/blob/18.0/addons/stock/security/stock_security.xml#L20-L30
- [O3] https://github.com/odoo/odoo/blob/18.0/addons/uom/security/ir.model.access.csv and https://github.com/odoo/odoo/blob/18.0/addons/account/security/ir.model.access.csv
- [O4] https://github.com/odoo/odoo/blob/18.0/odoo/fields.py#L3349-L3356
- [O5] https://github.com/odoo/odoo/blob/18.0/addons/sale/models/sale_order.py#L1514-L1533
- [O6] https://github.com/odoo/odoo/blob/18.0/odoo/addons/base/models/res_users.py#L2394-L2412
- [5] https://learning.sap.com/courses/implementing-sap-s-4hana-cloud-public-edition/creating-and-customizing-business-roles
- [6] https://answers.sap.com/t5/enterprise-resource-planning-q-a/allow-editing-business-partner-data-but-restrict-creation-and-deletion-in/qaq-p/12785159
- [7] https://userapps.support.sap.com/sap/support/knowledge/en/3048722
- [9] https://help.sap.com/doc/abapdocu_752_index_htm/7.52/en-US/abapauthority-check.htm
- [14] https://help.sap.com/doc/abapdocu_757_index_htm/7.57/en-US/abapin_local_mode.htm
- [15] https://help.sap.com/doc/abapdocu_757_index_htm/7.57/en-US/abapeml_privileged.htm
- [17] https://blogs.sap.com/2017/03/20/data-exchange-in-s4hana-cloud-using-communication-scenarios/
- [20] https://learning.sap.com/courses/implementing-sap-business-one/defining-general-authorizations
- [22] https://userapps.support.sap.com/sap/support/knowledge/en/3767657
- [I1] https://infisical.com/blog/folder-based-rbac
