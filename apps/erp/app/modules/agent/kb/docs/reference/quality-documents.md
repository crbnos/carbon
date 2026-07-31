# Quality documents

> Controlled SOPs and work instructions, versioned so a new revision supersedes the old one without deleting it.

A **quality document** is a controlled procedure: an SOP or work instruction that your team writes once, publishes, and revises under control. Think "Incoming Inspection Procedure" or "Solder Reflow Work Instruction". Each document carries an ordered list of **steps** (a mix of tasks, measurements, checkboxes, and sign-offs) plus a rich-text body, and it moves through a small lifecycle before anyone treats it as authoritative.

The point of controlling it is auditability: you never overwrite a live procedure in place. Publishing a new revision creates a **new version** and archives the one it replaces, so the old text is still there to point an auditor at.

## The lifecycle

A quality document has exactly three states, and only one version of a given document is ever **Active** at a time.

  - **Draft**: The starting state. You edit the name, the work-instruction body, and the steps freely. Not yet authoritative.
  - **Active**: The published, in-force revision. Publishing it archives any other Active version with the same name automatically.
  - **Archived**: A retired revision. Superseded by a newer Active version, or manually pulled. Still readable; can be reactivated.

You publish from the document header. The button reads **"Publish"** for a Draft, **"Reactivate"** for an Archived version, and **"Submit for approval"** when an `docs/reference/approvals` covers quality documents (more on that below). All three drive the status toward **Active**.

Going Active is exclusive by name. A database trigger archives every *other* Active document that shares this one's name in the same company the moment this one publishes, so "the current procedure" is always a single row. You never end up with two live copies.

Archiving or reverting to Draft is available too, but reverting a version that has a pending approval request is restricted: only the person who requested it or a designated approver can pull it back to Draft.

## Versioning

Versions are the heart of the "controlled" part. A document is identified by its **name**, and each revision is a separate row stamped with a **version** number (starting at 0). The name is unique per version, so `"Incoming Inspection Procedure"` can exist at V0, V1, and V2 side by side.

To revise a published document, open the **Versions** menu in the header and choose **New Version**. Carbon copies the current document's body, steps, and tags into a fresh Draft at the next version number. Nothing about the old version changes. When you publish the new one, the trigger archives the previous Active version. The prior revision is never deleted, so the version history stays intact for audit.

Editing an already-Active document in place is the wrong move for a controlled record. Cut a **New Version** instead. That is what keeps the paper trail honest: an auditor can see exactly what V1 said and when V2 took over.

The header's Versions dropdown lists every revision of the document with its version badge and status, so you can jump between them and read a retired revision without reactivating it.

## Approval

Whether publishing needs a sign-off depends on your company's `docs/reference/approvals`. Quality documents are one of the document types the shared approval engine covers.

- **No approval rule** — the **Publish** button flips the document straight to **Active**.
- **An approval rule applies** — the button reads **Submit for approval** and creating an approval request instead of going Active. A qualified approver then sees **Approve** / **Reject** in the header. On **Approve**, the document transitions to **Active** in one transaction; the approvers are notified when the request is raised.

Only one pending approval request exists per document at a time, and submitting an Archived version for approval moves it back to Draft while the request is open.

## Steps

Each document holds an ordered set of **steps**, the same step model Carbon uses for a procedure on a job. A step has a name, an optional description, a **sort order**, and a **type** that decides what gets recorded when someone runs the document:

  - **Task**: A do-this instruction with no data captured beyond done/not-done.
  - **Value**: A free-form recorded value.
  - **Measurement**: A numeric reading against a **unit of measure** (required for this type), with optional min and max bounds.
  - **Checkbox**: A yes/no confirmation.
  - **Timestamp**: A recorded time.
  - **Person**: A recorded person.
  - **List**: A pick from a fixed set of options you define.
  - **File**: A file upload, optionally constrained to given file types.
  - **Inspection**: An inspection step.

A **Measurement** step must name a unit of measure and can set a min/max range; a **List** step must supply its options. These constraints are enforced when you save the step.

## What a quality document is not

Quality documents are standalone controlled records. They are **not** attached to a specific process, item, or inspection through a link on the document itself, and they are distinct from two neighbors people often conflate:

- A procedure is the versioned work instruction that gets copied onto a job's operation to give it steps and run parameters. It shares the step model with a quality document but lives in the production method, not the quality library.
- An `docs/reference/inspections` is a ballooned drawing used for first-article and in-process dimensional inspection. That is a separate feature with its own tables.

For the wider quality module (issues, dispositions, inbound inspection), see `docs/reference/quality`.

## Troubleshooting

Mostly preconditions: this surface has few literal errors and a status/approval lifecycle instead.

### "Name is required" / "Quality document is required" / "Type is required"
Form-validation from the document and step validators. A document needs a name; a step needs its parent document, a name, and a step type before it saves.

### "Unit of measure is required" / "List options are required"
Step-type constraints. A **Measurement** step must name a unit of measure; a **List** step must supply at least one option. These are enforced on save.

### "Maximum value must be greater than or equal to minimum value"
A measurement step's min/max range is inverted. Swap the values so the maximum isn't below the minimum.

### "Invalid quality document content format" / "Failed to insert quality document" / "Failed to delete quality document"
The rich-text content didn't parse as valid JSON, or the insert/delete transaction failed (often a permission denial). Reload and retry; check that your role has the needed quality permission.

### Activating a document is stuck in Draft
Documents run Draft → Active → Archived, but if approval is required for `qualityDocument`, submitting a Draft (or Archived) for activation creates an approval request and the document stays Draft until an authorized approver signs off. It only reaches Active after approval — check the pending approval request, and confirm the approver has the right role.

### "Approval request not found"
The approval action references a request that isn't the document's latest — usually a stale page after another approval cycle. Reload the document and act on the current request.

### A new version didn't replace the old record
Versioning copies the source document (content, tags, and all steps) into a new record with an incremented version number rather than editing in place — all versions share the same name and are queryable together. The old version still exists by design; that's the version history, not a duplicate to delete.

### Permission-gated: view, create, edit, or delete a document
Reading needs `quality` **view**; creating needs `quality` **create**; editing and publishing need `quality` **update**; deleting needs `quality` **delete**. A blocked action means your role is missing that permission.
