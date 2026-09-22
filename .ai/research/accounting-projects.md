# Accounting Projects Research: Best Practices Survey

## Summary

SAP S/4HANA, NetSuite, and Ramp converge on a stable master-data record that is selected on financial transaction lines, retains historical identity after it becomes unavailable for new coding, and syncs by immutable external identifiers rather than display names. Carbon should implement Projects as a flat, company-scoped accounting master with a required unique name, optional description, active state, and immutable generated id. Project-management concerns such as tasks, schedules, customer ownership, budgets, and WBS hierarchies are outside this accounting-dimension feature.

## Competitors Surveyed

- **SAP S/4HANA** — enterprise accounting reference with project/WBS account assignment and analytical Project dimensions.
- **NetSuite** — mid-market ERP reference with first-class Project records and transaction-line project assignment.
- **Ramp** — the target spend-management integration and source of the external custom-field contract.

## Key Consensus Patterns

### 1. A project is stable master data, separate from its transaction assignments

- **SAP**: project master data has internal and external identifiers plus separate display text; journal items carry WBS/project account assignments.
- **NetSuite**: Project is a first-class record, exposed as `job` in APIs, and can be selected on transaction lines.
- **Ramp**: an ERP-owned Project list is represented by one `SINGLE_CHOICE` accounting field with one option per external project.
- **Rationale**: the project must be independently managed and synchronized while transaction lines store references to it.

### 2. Flat Projects are sufficient for accounting classification

- **SAP**: hierarchical WBS structures exist, but SAP also supports simpler project forms; hierarchy is a project-control capability rather than a prerequisite for classification.
- **NetSuite**: Project records are flat; hierarchy belongs to project tasks or an optional SuiteProjects Pro hierarchy.
- **Ramp**: a custom single-choice field is a flat option list.
- **Rationale**: Carbon can satisfy transaction coding without importing project-management or WBS complexity.

### 3. Inactive values remain historical but disappear from new selectors

- **SAP**: used projects move through completion, closure, deletion flags, and archiving; physical deletion is restricted when postings or assignments exist.
- **NetSuite**: inactive records remain available for historical reference while disappearing from normal transaction selectors.
- **Ramp**: `visibility: "HIDDEN"` removes an option from new selections while preserving historical sync; Ramp recommends hiding over deleting for this case.
- **Rationale**: deactivation preserves reporting and integration identity while preventing new coding.

### 4. Sync uses immutable ids, never mutable names

- **SAP**: project APIs and events expose internal ids alongside business-facing external ids.
- **NetSuite**: internal ids and caller-provided external ids support synchronization and upsert.
- **Ramp**: Carbon's immutable project id belongs in the option `id`; Ramp returns a separate `ramp_id` used for provider mutations.
- **Rationale**: renames must update display labels without creating duplicate projects or breaking historical references.

### 5. Project assignment belongs at line level

- **SAP**: journal-entry items carry WBS/project account assignment.
- **NetSuite**: one transaction can contain lines assigned to different projects.
- **Ramp**: accounting field selections are returned on split line items; a custom field can be marked `is_splittable`.
- **Rationale**: a header-only project would prevent split expenses and would not match Carbon's existing journal-line dimension architecture.

## Answers to Research Questions

1. **What is the minimal entity and lifecycle?** — A flat master record with immutable internal id, tenant scope, required name, optional description, and active/inactive lifecycle. Rich delivery statuses are project-management scope, not accounting-classification scope.
2. **Is a hierarchy required?** — No. SAP can add WBS hierarchy and NetSuite can add task or optional project hierarchy, but both permit a project master independent of that structure; Ramp consumes a flat option list.
3. **Where is a project assigned?** — At the financial line level. Carbon should ultimately write a Project `journalLineDimension` assignment and retain a source-document project reference where the posting flow needs to carry it into the journal.
4. **How should identity and renames work across Ramp?** — Use a constant external id for the Project field and each immutable Carbon `project.id` as the option external id. Persist/reconcile Ramp UUIDs separately. Rename with PATCH; never match by display name.
5. **How should deletion work?** — Deactivate in Carbon and hide in Ramp. Hard deletion is safe only before any dependent reference exists, but a uniform soft-delete action avoids changing user behavior after the dimension slice ships.
6. **Should Carbon depend on Ramp's semantic `PROJECT` type?** — No. Ramp's custom-field create contract does not accept a semantic type, and custom selections may be reported as `OTHER`; identify Carbon's field by `category_info.external_id`.

## Competitor-Specific Details

### SAP S/4HANA

SAP separates the project header from WBS elements. The header carries master data and identifiers; WBS elements are the operational account-assignment objects. SAP exposes Project as an analytical dimension and assigns project-related costs on journal items. Its richer Created/Released/Completed/Closed lifecycle should not be copied into Carbon until Carbon is building project control rather than a coding dimension.

### NetSuite

NetSuite calls the record Project in the UI and `job` in APIs. Project ID, name, and status are central, while customer, subsidiary, dates, type, and comments are optional. Its standard inactive-record behavior is a strong precedent for retaining old project references without offering them for new transactions.

### Ramp

The correct surface is an ERP-bound accounting custom field, not Ramp-only fields. Create one `SINGLE_CHOICE`, splittable field, then converge options by external id: create missing options, PATCH renamed options, hide inactive/removed options, and re-show restored options. Field-option creation is create-only and batched, so the sync must diff before posting. Incoming selections must be matched by the field external id.

## Recommended Approach for Carbon

1. Add a flat, company-scoped `project` table with `id('prj')`, `name`, optional `description`, `active`, audit columns, composite primary key, and unique `(companyId, name)`.
2. Put Projects under the existing Accounting permission family and expose flat searchable table CRUD. “Delete” sets `active = false`; active lists exclude inactive rows.
3. Do not add owner, customer, dates, tasks, budgets, status workflows, hierarchy, or a user-managed project code in the first slice. The immutable internal id is sufficient for safe Ramp identity, and those fields represent project-management scope.
4. In the next slice, add `Project` to the dimension entity types, provision the group-level Project dimension, resolve active company projects in the dimension selector, and persist line-level assignments through the existing `journalLineDimension` mechanism.
5. In the Ramp slice, add a dedicated constant external field id, converge project options independently from cost centers, identify incoming selections by `category_info.external_id`, and map inactive Projects to Ramp `HIDDEN` options.

## Sources

- https://help.sap.com/docs/s4hana-cloud-best-practices/project-control-finance-1nt-it/create-project
- https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/04f8d809ad314e3ea009ad2dc88b3d7f/8531b84e9d444e819b4476d5881fa85c.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/988903b47d7040f6ac4ec02e44bb58e4/df37016265c44283bbbb19716845764f.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/f369b2eff700401494ba6e7c9a573288/d442899643f342e3af889580cbc2ad32.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/1e3c2c0366834d1fb76461f439248880/0af7f3a8aa7c486ca43cecb56ad9d117.html
- https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/e2f8ce9e5ba14e07ac25b52924c35d8e.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3645529.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1179164.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N490731.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1192913.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1179020.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_28183355389.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3432681.html
- https://docs.ramp.com/developer-api/v1/accounting
- https://docs.ramp.com/developer-api/v1/api/accounting
- https://docs.ramp.com/developer-api/v1/api/transactions
- https://docs.ramp.com/openapi/developer-api.json
- https://docs.ramp.com/developer-api/v1/api/accounting-ramp-only-fields
