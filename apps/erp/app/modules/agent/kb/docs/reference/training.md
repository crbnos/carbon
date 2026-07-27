# Training

> Training programs, quiz questions, group assignments, per-period completion tracking, and the weekly reminder digest.

**Training** is where you build the courses your team has to complete, assign them to groups of employees, and track who has finished. A training is a named program with rich content and an optional quiz. You assign it to employee groups, and Carbon tracks completion per employee for the current period, chases the stragglers with a weekly email, and lets a manager mark someone complete by hand. It lives in the `docs/reference/work-centers` area and is governed by the `resources` permission.

A quick example: you create a "Lockout/Tagout" training, set its type to **"Mandatory"** and frequency to **"Annual"**, write the material, add a few quiz questions, then assign it to the "Machinists" group. Every machinist now shows as **"Pending"** for the current year until they complete it — and every Sunday night anyone still outstanding gets a reminder.

## The training catalog

Each training is one row in the `training` table (`packages/database/supabase/migrations/20251205021915_training.sql:18`). You create one from the training list with just a **Name** — the create form is deliberately minimal (`apps/erp/app/modules/resources/ui/Training/TrainingForm.tsx:76`). Everything else is edited afterward from the training's **Properties** panel (`apps/erp/app/modules/resources/ui/Training/TrainingProperties.tsx`), which saves each field on change through a bulk-update action.

- **name**: The training's title.
- **type**: Whether completion is required. Drives the badge on the list and, for mandatory trainings, the sense of "you must finish this."
- **frequency**: How often the training must be re-taken. **"Once"** means complete it a single time, forever. **"Quarterly"** and **"Annual"** are *recurring* — completion is tracked per period and resets when a new period begins.
- **status**: Lifecycle of the training itself. See below.
- **content**: The training material, stored as rich JSON (`content`). This is the body an employee reads.
- **estimatedDuration**: A free-text estimate of how long the training takes.
- **tags**: Free-form tags for filtering the catalog.
- **assignee**: The person responsible for the training.

The status enum is a simple linear lifecycle on the training record — not to be confused with an employee's *completion* status further down.

- **Draft**: Being authored. Not yet meant for assignment.
- **Active**: Published and in use. Assignments and reminders operate against active trainings.
- **Archived**: Retired. Kept for history, no longer assigned.

## Quiz questions

A training can carry a quiz. Each question is a row in `trainingQuestion` (`20251205021915_training.sql:229`), owned by one training, ordered by `sortOrder`, and marked `required` or not. Carbon supports five question types (`apps/erp/app/modules/resources/resources.models.ts:343`):

- **MultipleChoice**: Pick exactly one correct answer from a list of options.
- **MultipleAnswers**: Pick one or more correct answers from a list.
- **TrueFalse**: A boolean question with a `correctBoolean` answer.
- **MatchingPairs**: Match left items to right items, stored as JSON pairs.
- **Numerical**: Enter a number; graded against a `correctNumber` within a `tolerance`.

Questions are authored on the training detail page and can be reordered. The stored answer key columns differ by type: `options` and `correctAnswers` for the choice types, `correctBoolean` for true/false, `matchingPairs` for pairs, and `correctNumber` / `tolerance` for numerical (`20251205021915_training.sql:229`).

## Assigning training to groups

You don't assign a training to individuals one at a time — you assign it to **groups**. A `trainingAssignment` (`20251205021915_training.sql:93`) links one `trainingId` to an array of `groupIds`. Every employee who belongs to one of those groups is on the hook for the training.

The assignment stores `groupIds`, not employee ids. Carbon expands the groups to their members when it computes who owes the training, so adding a person to a group automatically enrolls them — you don't re-assign.

Open an existing assignment and switch to the **Status** tab to see the per-employee roster: each member with their current status, a completion date if they've finished, and a **"Mark Complete"** button (`apps/erp/app/modules/resources/ui/Training/TrainingAssignmentForm.tsx`). Assigning also fires a notification to the newly-covered employees (see `docs/reference/notifications`).

## Completion and status

Completion is recorded in `trainingCompletion` (`20251205021915_training.sql:156`) — one row per employee per assignment per period, with a `completedAt` timestamp and `completedBy`. For recurring trainings the row also carries a `period` string, and a unique constraint stops double-recording the same employee for the same period.

The **period** is the heart of the recurring logic (`20251206000000_training_assignments.sql`). Carbon derives the current period from the training's frequency:

- **Once**: No period (`NULL`). Complete it once and you're done for good.
- **Quarterly**: A string like `Q1-2026`. Completion in one quarter doesn't carry into the next.
- **Annual**: A string like `2026`. Resets at the start of each year.

An employee's status is *computed*, not stored — Carbon evaluates it from whether a completion exists for the current period and when the employee started. There are four possible values (`apps/erp/app/modules/resources/resources.models.ts:318`):

- **Pending**: Assigned, in the current period, not yet completed. The default state.
- **Completed**: A completion row exists for this employee and period.
- **Overdue**: A recurring period has already ended and the employee never completed it.
- **Not Required**: The employee started after the period ended, so they were never on the hook for it.

Recurring trainings check the employee's start date against the period. Someone who joined after a past period closed shows **"Not Required"** for that period, not **"Overdue"** — so onboarding a new hire doesn't instantly paint their record red.

A manager marks completion from the assignment's Status tab; the action posts to `markTrainingComplete` with the employee and the current period (`apps/erp/app/modules/resources/ui/Training/TrainingAssignmentForm.tsx`). An employee already **"Completed"** or **"Not Required"** has no button — there's nothing to mark.

## The weekly reminder

Every Sunday at 21:00 UTC, a scheduled job sweeps outstanding training and emails the stragglers (`packages/jobs/src/inngest/functions/scheduled/weekly.ts`, cron `0 21 * * 0`). For each company it pulls the assignment status, keeps only the employees whose status is a reminder-worthy one (**"Pending"** or **"Overdue"**), groups them by person, and sends one digest per employee.

The notification is the `TrainingReminder` event (`training-reminder`) under the `Training` topic. Its email heading is **"Training reminder"** and the call-to-action button reads **"View training"** (`packages/notifications/src/index.ts`). It's the only *recurring* notification event in Carbon — so it needs a guard against nagging forever.

A recurring reminder is capped: once an outstanding training has had five successful reminder emails delivered for the current period, Carbon stops re-sending it. For quarterly and annual trainings the count is keyed to the period, so the cap resets when a new period begins. If a reminder "stopped coming," this cap is usually why.

Two related one-shot events fire when work is handed to people rather than chased: **"Training assigned to you"** (`training-assignment`) and **"New training available"** (`resource-training-assignment`). See `docs/reference/notifications` for how these are delivered and how a person tunes them.

## Abilities are a separate system

Carbon also tracks employee **abilities** — a skill or certification with a learning curve — under the `docs/reference/people` side of the app (`apps/erp/app/modules/people/ui/Person/PersonAbilities.tsx`). An ability defines a starting proficiency, the weeks to reach full proficiency, and a shadowing period; each employee's progress against it is tracked as `NotStarted`, `InProgress`, or `Complete` (`apps/erp/app/modules/resources/types.ts`).

Despite the shared vocabulary, abilities and trainings are **two independent systems today**. There is no active link between a training and an ability, and work centers do not require a specific ability — the fields that would connect them (`requiredAbilityId` on a work center, an `abilityId` on a training) exist only as commented-out placeholders in the code (`apps/erp/app/modules/resources/resources.models.ts:495`). Completing a training does not advance an ability, and vice versa.

Because they're separate, plan around it: use **training** for course-and-quiz compliance with reminders, and **abilities** for skill-curve tracking on a person's profile. Don't expect one to update the other.

## Troubleshooting

Exact strings and preconditions for training assignment, completion, and reminders.

### "Training is required"
The assignment form was submitted without picking a training (`apps/erp/app/modules/resources/resources.models.ts:325`). Select a training in the **Training** field before saving. The field is read-only when editing an existing assignment, so this only bites on create.

### "At least one group is required"
An assignment must target at least one group; the `groupIds` array was empty. Add one or more groups in **"Assign to Groups"** before saving.

### "Training assignment is required" / "Employee is required"
The mark-complete action needs both `trainingAssignmentId` and `employeeId` (`apps/erp/app/modules/resources/resources.models.ts:333`). These come from hidden fields on the Status-tab row; an empty value means the row didn't carry them — reload the assignment and try again from the Status tab.

### "Why didn't a reminder send?"
Not an error string — a common question. Checklist of preconditions for the weekly digest (`packages/jobs/src/inngest/functions/scheduled/weekly.ts`, cron `0 21 * * 0`, Sunday 21:00 UTC):
- The employee's computed status must be **"Pending"** or **"Overdue"**. **"Completed"** and **"Not Required"** are skipped.
- The reminder cap is five successful deliveries per training per period. If five have already gone out this period, sending stops until the next period (recurring) — this is the usual reason a reminder "went quiet."
- The employee must have the `Training` notification topic enabled for the channel; a user who muted training notifications won't be emailed.
- New hires who started after a past recurring period show **"Not Required"** for it and are intentionally never reminded about it.

### "Why can't I mark someone complete / assign a training?"
The action is gated by the `resources` permission — `resources_update` to mark complete and edit, `resources_create` to create a training or assignment (`apps/erp/app/modules/resources/ui/Training/TrainingAssignmentForm.tsx`). Without it the **"Mark Complete"** and **Save** buttons are disabled. (These permissions were `people_*` before migration `20251211012654_training-to-resources.sql`; the code now checks `resources`.)

### "A completed training re-appeared as Pending"
Expected for recurring frequencies. A **"Quarterly"** or **"Annual"** training tracks completion per period; when the new period starts (a new `Q?-YYYY` or `YYYY`), a fresh completion is required and the employee resets to **"Pending"** (`20251206000000_training_assignments.sql`). Only **"Once"** trainings stay completed forever.
