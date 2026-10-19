# Issue Tracker Sync Research: Best Practices Survey

## Summary

We surveyed how PLM, ALM, QMS, project-management and sync tools link their own work
items to Jira and Linear issues. The survey covers four questions:
how much a link covers (one item or a whole scope), who wins a conflict, how a tool
stops echo loops, and what happens to a locked or approved record. Most tools mirror a whole scope (a project, a
tracker, a set). Tools that link one item at a time do so from the item (Duro, Matrix,
Greenlight Guru, the Jira widget in Asana). Most tools set the direction per field, not
per link. Few document a conflict rule. Jama uses last-writer-wins per field; codebeamer
lets Jira win. The QMS tools that sync approved records protect them. Ketryx invalidates
the approval. Qualio and Matrix flag the item. Jama blocks a locked item and retries. No tool lets an inbound edit silently change an approved record. Duro is the only
manufacturing tool that we found with a Linear integration, and it is one-way.

## Competitors Surveyed

- **Jama Connect (Interchange)** — requirements and test cases synced with Jira; the closest match to project elements.
- **Siemens Polarion** — ALM with a Jira connector; per-field direction.
- **PTC codebeamer** — ALM that mirrors a whole tracker with Jira; a documented conflict rule.
- **Arena PLM, Duro, Teamcenter, OpenBOM, Propel** — PLM change orders, the closest match to change notices.
- **Ketryx, Qualio, Greenlight Guru, Matrix Requirements, SAP Cloud ALM** — QMS and ALM records under approval.
- **MasterControl, ETQ, TrackWise, Veeva** — QMS CAPA; no documented Jira link.
- **Linear Jira Sync, Linear GitHub sync, Unito, Exalate** — general sync tools; field ownership and echo handling.
- **Smartsheet, monday.com, Asana, ClickUp, Wrike, Microsoft, SuiteProjects Pro, Odoo, SAP** — project and PSA tools.

## Key Consensus Patterns

### 1. Tools set the direction per field, not per link

- **Jama**: each field mapping is bidirectional or one-way. Jama forces a field one-way when it is read-only in one system.
- **Polarion**: each field mapping has a direction arrow.
- **codebeamer**: each field is Ignore, Import, Export or Synchronize.
- **Unito, Smartsheet, monday.com, Wrike, Asana**: per-field direction.
- **Exalate**: each side's incoming script decides which fields it accepts.
- **Rationale**: one system owns one set of facts (the requirement text). The other system owns another set (the work status). Per-field direction states that ownership.

### 2. Status maps by category, and the tracker can refuse a transition

- **Linear**: state types `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`, `duplicate`. Each team names its own states.
- **Jira**: three status categories, `new`, `indeterminate`, `done`. A status change is a workflow transition, and the workflow can refuse it.
- **Jama, monday.com, SAP Cloud ALM**: a status sync applies only when the target workflow permits the transition.
- **Linear Jira Sync**: a status with no match leaves the Linear status unchanged.
- **Rationale**: both trackers let customers rename states, so only the category is stable.

### 3. Tools match users by email, and a miss leaves the field empty

- **Unito, Wrike, codebeamer, Smartsheet, OCA Odoo**: match by email.
- **Jira**: `emailAddress` can be null because of each user's privacy setting. `accountId` is the stable key.
- **SAP Cloud ALM**: a preloaded map of Jira account id to email; with no match, the task syncs with no assignee.
- **Rationale**: email is the only key that both systems share without extra setup.

### 4. Tools protect an approved or locked record from inbound edits

- **Ketryx**: an update to an approved item invalidates the approval and can move the item out of its controlled state. Listed "uncontrolled" fields can change without that. Baseline locking (2.11) ignores later Jira edits for a released baseline.
- **Jama**: users cannot sync a locked item. The integration marks the link "Error" and retries until someone unlocks the item (verified for the Excel integration only).
- **Qualio**: Qualio flags an approved item that changed in Jira as "CHANGED". It does not block the edit.
- **Matrix Requirements**: a source change sets the item "Out of Sync"; a user re-syncs or merges.
- **SAP Focused Build**: one leading system per object. Jira cannot change a Work Package status.
- **Rationale**: a regulated record must not change without its own approval. Tools either refuse the edit or flag it for review.

### 5. A delete breaks the link; it does not delete the copy

- **Linear Jira Sync**: a delete on either side never deletes the copy.
- **Unito**: a delete breaks the link for good and never re-creates the copy.
- **Exalate**: a delete stops future updates; the panel shows "remote entity removed".
- **codebeamer**: a deleted Jira issue clears the item's Jira key and never retries.
- **monday.com**: monday.com does not sync deletes, on purpose.
- **SAP Cloud ALM and the Cybrosys Odoo app**: the exceptions; a delete deletes or archives the other side.
- **Rationale**: a delete in a tracker is often cleanup. Deleting an ERP record from outside is unsafe.

### 6. Tools stop echo loops by origin, not by timing

- **Linear webhooks**: each payload carries `actor` and `updatedFrom` (the old values).
- **Exalate**: Exalate does not sync the changes that the proxy (integration) user makes.
- **codebeamer**: changes replicated from Jira raise no new notifications.
- **SAP Cloud ALM**: a Jira rule skips issues that already hold a Cloud ALM reference, and runs an update only when Created ≠ Updated.
- **Jama**: the delta sync copies only the fields that changed since the last sync.
- **Rationale**: compare-before-write and origin markers both stop a write from bouncing back.

## Answers to Research Questions

1. **Per-item link or whole-scope mirror?** Mostly scope. Jama mirrors sets, Polarion query pairs and codebeamer a whole tracker. Linear Jira Sync pairs a space with a team. Asana, Wrike and Smartsheet pair two projects. Per-item links exist where the item is the unit of work. Duro and Arena link one change order, Matrix and Greenlight Guru one item, and Exalate one issue. SAP S/4HANA Cloud syncs WBS elements one way to Jira epics.
2. **Conflict and ownership policy?** Per-field direction is the consensus. For a bidirectional field, Jama uses last-writer-wins per field and codebeamer lets Jira win. Most tools do not document a rule.
3. **Field mapping?** Status by category. Priority syncs (Linear 0 None, 1 Urgent, 2 High, 3 Medium, 4 Low; Jira's list is configurable per project). Assignee by email. Due date syncs; few tools sync the start date. Labels sync by name (Linear Jira Sync creates missing labels in Jira only). Hierarchy is the weakest area: epics become projects or flat tasks.
4. **Locked or baselined source records?** See pattern 4. The options are block and retry (Jama), invalidate the approval (Ketryx), or flag for review (Qualio, Matrix). Nothing overwrites silently.
5. **Unlink and delete?** See pattern 5. A delete or a move breaks the link. Moves change Jira keys; old keys redirect.
6. **Which system owns which field?** ALM tools keep the requirement text in the ALM and let Jira own the work status. Jama's recommended start syncs Name and Description both ways and URLs one way. In SAP Focused Build, Jira leads status only. Ketryx is the reverse: Jira owns content, Ketryx owns approval.

## Competitor-Specific Details

### Jama Connect Interchange
Field mapping groups pair Jama sets of one item type with one Jira issue type. Creation rules apply only when Jama first makes a link. Delta syncs run on a schedule. Epic/Parent maps one-way to Jama as an upstream relationship.

### PTC codebeamer
One Jira project and issue type pairs with one tracker, with no filter. On conflict Jira wins; codebeamer discards the local change. Users match by name or email. Codebeamer creates each unmatched user as a disabled user. All exported changes show as one Jira sync user.

### Ketryx
Jira is the record. Ketryx owns approvals and blocks the closing transition in Jira (a hidden Resolved → Closed transition), so only a Ketryx signature can close an item.

### Linear Jira Sync
One Jira space links to one Linear team. A Jira status with no Linear match leaves the Linear status unchanged. Each user must connect a Jira account, or the assignee becomes empty. Epics become Linear projects.

### Duro
The only PLM tool here with Linear. The user puts the ticket id in the change order title. Duro posts a link and writes the change order status (approved, rejected, resolved) into the ticket. One-way.

### Arena PLM
Arena Connect (2026.2) and PROSTEP OpenPDM create or update Jira issues when a change order or quality process reaches a workflow step. Conflict, user and delete behavior is not documented.

### SAP
Cloud ALM syncs project tasks and sub-tasks two-way with no leading system. Focused Build creates Jira epics and stories at "handover to development" and syncs status only. S/4HANA Cloud sends WBS elements one way to Jira epics.

## Recommended Approach for Carbon

1. **Keep the per-item link** (Duro, Matrix, Exalate, the Asana widget). Carbon's existing pattern is one mapping row per task, and the items here (an action task, a project task) are single units of work. A project-to-team mirror can come later.
2. **Set the direction per field in code, per record type** (Jama, Polarion, codebeamer). Progress fields (status, assignee, priority, due date) sync both ways. Plan text on a project element (name, description) follows the plan lock.
3. **Map status by category, never by name** (Linear state type, Jira status category). Project element state groups match Linear state types one to one. Jira has three categories, so Backlog/Unstarted and Completed/Cancelled collapse.
4. **Refuse inbound edits to locked records and record why** (Jama block-and-retry, SAP leading system). A Done or Cancelled change notice and a locked project plan reject inbound edits to protected fields. Do not overwrite silently.
5. **Stop echoes by compare-before-write against the last synced values** (Jama delta sync, Linear `updatedFrom`). Store the last values pushed or pulled on the mapping row, and skip a push when nothing changed since.
6. **A remote delete breaks the link and never deletes the Carbon record** (Linear, Unito, Exalate, codebeamer).
7. **Match users by email, with the Jira privacy caveat** (Unito, Wrike). When Jira hides the email, leave the Carbon assignee unchanged rather than clearing it.

## Sources

- https://linear.app/docs/jira
- https://linear.app/docs/github
- https://linear.app/developers/webhooks
- https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql
- https://guide.unito.io/how-to-map-fields
- https://guide.unito.io/how-to-map-users-and-assignees
- https://guide.unito.io/how-does-moving-work-items-work-with-unito
- https://docs.exalate.com/docs/sync-rules
- https://docs.exalate.com/docs/proxy-user
- https://docs.exalate.com/docs/what-happens-with-the-entity-in-case-synchronization-stops
- https://developer.atlassian.com/cloud/jira/platform/webhooks/
- https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-user-privacy-api-migration-guide/
- https://support.atlassian.com/jira-cloud-administration/docs/configure-priorities-for-projects/
- https://help.jamainterchange.com/en/integrating-jama-connect-with-jira/create-a-simple-jira-integration/configure-field-mappings-for-jira.html
- https://help.jamainterchange.com/en/integrating-jama-connect-with-jira/create-a-simple-jira-integration/configure-creation-rules.html
- https://help.jamainterchange.com/en/appendix/delta-syncs-and-full-syncs.html
- https://help.jamainterchange.com/en/integrating-jama-connect-with-excel-functions/best-practices-for-excel-functions-integrations.html
- https://help.jamasoftware.com/ah/en/create-content/items/using-and-managing-locked-items.html
- https://extensions.polarion.com/extensions/190-polarion-connector-for-atlassian-jira
- https://blogs.sw.siemens.com/polarion/polarion-alm-2410-whats-new-and-noteworthy/
- https://support.ptc.com/help/codebeamer/r2.1/en/codebeamer/user_guide/3163101.html
- https://support.ptc.com/help/codebeamer/r2.1/en/codebeamer/user_guide/ug_resolve_update_conflicts_ext.html
- https://support.ptc.com/help/codebeamer/r3.1/en/codebeamer/user_guide/ug_jira_fields_sync.html
- https://www.arenasolutions.com/solutions/marketplace/prostep-jira/
- https://www.engineering.com/ptc-adds-arena-connect-to-plm-and-qms-release/
- https://durolabs.co/blog/duros-approach-to-integrations/
- https://www.openbom.com/blog/how-to-use-openbom-item-links-in-external-applications
- https://docs.sodiuswillert.com/oslc-connect/latest/understanding-oslc-connect-for-jira-link-storage
- https://support.ketryx.com/hc/en-us/articles/34459704197261
- https://support.ketryx.com/hc/en-us/articles/39987199811469
- https://www.ketryx.com/blog/ketryx-2-11
- https://docs.qualio.com/en/articles/6104846-configure-jira-integration-for-design-controls
- https://docs.matrixreq.com/en/articles/233863-managing-tickets-with-jira-integration
- https://api.sap.com/odata/1.0/catalog.svc/Files('8ed7061492774ce4a20c6787b4344667')/$value
- https://github.com/SAP-archive/solman-fb-jira-addon
- https://help.smartsheet.com/articles/2476121-jira-workflows
- https://help.wrike.com/hc/en-us/articles/209605349-Wrike-and-Jira-Sync-Overview
- https://asana.com/apps/jiracloud
- https://apps.odoo-community.org/modules/connector_jira
- https://learn.microsoft.com/en-us/connectors/jira/
