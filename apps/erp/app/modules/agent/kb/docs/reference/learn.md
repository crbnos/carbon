# Learn

> Role-based learning tracks built on these docs, with scenario quizzes, hands-on challenges verified against your own records, XP, and certificates your manager can check.

**Learn** is Carbon teaching Carbon. A track is a short curriculum built on this documentation: you read a page, answer a few scenario questions about it, and then prove the skill by doing the real thing in your own company. Finish a track's units and its hands-on challenges, pass the certification exam, and Carbon issues a certificate with a public verification link. It lives at **Learn** in your account menu and is governed by the `resources` permission on the admin side.

A quick example: a new buyer opens the Purchasing track, reads the purchase-order reference, answers five questions about what a line's counters mean, then is asked to actually raise a two-line purchase order and release it. Carbon looks at the orders they created since starting the challenge and tells them exactly what is missing — "PO000028 is still Draft" — until it passes.

Nine tracks ship with the product: Fundamentals plus one for each role.

## Tracks, modules, and units

The curriculum ships with the product rather than being authored per company (for your own SOP content, use `docs/reference/training` instead). Each **track** targets a role, contains **modules**, and each module contains **units**.

A unit is one sitting: an objective, links to the documentation pages that answer it, and exactly one assessment — either a quiz or a hands-on challenge. Nothing is read-only credit.

  - **Fundamentals**: What Carbon is, items and methods, the company you work in, and who can do what. Start here.
  - **Purchasing**: Suppliers and quotes, purchase orders, receiving and billing, with a capstone that runs the whole loop.
  - **Accounting**: The chart of accounts and dimensions, supplier bills, payments, job costing, and closing a period.
  - **Sales**: Quoting and pricing, orders whose status is computed, shipping, and the invoice at the end.
  - **Inventory**: Where stock lives, adjustments and transfers, counting it, and proving where it came from.
  - **Production**: Jobs and their frozen methods, routings, finite scheduling, kanban, and the floor reporting back.
  - **Planning**: How demand accumulates, forecast, the four reorder policies and their modifiers, and what MRP does.
  - **Quality**: Non-conformances, inspections and sampling, calibration, quality documents, and the risk register.
  - **Administration**: Company settings and sequences, people, permissions, custom fields, and bulk data.

A role track is around nine units across three modules, and its exam draws from a bank of roughly ninety questions — so two people sitting the same exam rarely see the same form, and a retake is never the paper you just failed.

## Quizzes

A unit quiz draws four or five questions from a larger bank, so two people rarely see the same form and a retake is a fresh draw. Questions are scenario-shaped ("a receipt posted for 40 of 50 units — what does the order show?") rather than definitions, and every answer, right or wrong, comes back with an explanation and a link to the exact documentation section that settles it.

Every question has to be right to pass a unit. That is deliberate: the quiz is the lesson, not the exam, and a near miss you never revisit is a gap you keep.

Grading happens on the server. The answer key is never sent to the browser, and your per-question results are stored where only Carbon can read them — a manager cannot see which questions you missed.

## Hands-on challenges

A challenge asks you to do the real thing and then checks that you did. Press **Start challenge**, do the work anywhere in Carbon, and press **Check my work**.

Carbon then looks for records **you** created in **this company** since the moment you started, and reports the first requirement that is not met yet. Retries are unlimited and never penalised — the fix-and-recheck loop is the point.

  - **Requirements**: Checked in order. The first unmet one is the one you are told about, by name.
  - **Evidence**: Recorded on a pass — the actual record ids, so the certificate can name what it was earned on.
  - **Scope**: Your user, this company, after your start time. Someone else's work never counts, and neither does a record that predates the challenge.

Checks look at real records, so practising creates real documents. If you would rather not add practice data to a live company, ask an administrator to provision a demo company from **Settings → Demo Data** and switch to it first. Carbon shows you which company a check will run in, every time.

Challenges are read-only: a checker never creates, edits, or deletes anything. Whatever you make while practising is yours to keep or clean up.

## The certification exam

A track's exam unlocks once its units and its required hands-on challenges are done. It is drawn fresh from the track's question bank, balanced across topics, and sat one question at a time with no going back.

  - **Pass mark**: The same bar the rest of Carbon's training uses.
  - **Time limit**: Shown as a countdown; answers submitted before it expires still count.
  - **Honor statement**: Accepted before the first question.
  - **Retakes**: 24 hours after a first failure, then 7 days — with a different form each time.

Results show your score per topic so you know what to revisit. They never reveal which specific questions you got wrong — that would leak the bank.

## Certificates

Passing issues a certificate immediately. It records the exam score, the hands-on challenges that were verified, and the content version it was earned against.

  - **Active**: Issued and inside its validity period.
  - **Expiring**: In its last 30 days — the renewal quiz is available.
  - **Expired**: Past its validity date. A renewal quiz still brings it back.
  - **Revoked**: Withdrawn by an administrator, with a recorded reason.

  - **Validity**: From the date of issue.
  - **Renewal**: A short, open-book quiz on what has changed. Passing extends validity by another 12 months.
  - **PDF**: A printable certificate with a QR code pointing at its verification page.
  - **Verification link**: A public page anyone can open — no Carbon login — showing the holder, the track, the dates, the status, and the criteria met.

That verification link is what makes the certificate worth something to a manager or a future employer: it is checkable by whoever holds it, and it goes stale on its own rather than claiming a skill from three product versions ago.

## Assigning tracks

Administrators with the `resources` permission manage Learn under **Resources → Learn**.

Assign a track to one or more employee **groups**, optionally with a due date. Everyone in those groups sees it on their hub and gets a notification. The dashboard then shows, per employee and track: not started, in progress with a percentage, certified with an expiry, expired, revoked, or overdue.

The dashboard shows assignment status and certificates. It deliberately does **not** show XP, streaks, activity, or which questions anyone answered wrongly — those stay with the learner. Progress toward a credential is the company's business; how someone studies is not.

An administrator can also revoke a certificate, with a reason. Revocation is immediate and shows on the public verification page.

## XP, levels, badges, and streaks

The motivation layer is private to you and visible nowhere else in Carbon.

  - **XP**: A unit quiz, by the attempt on which you pass it. Guessing gets cheaper.
  - **XP**: A hands-on challenge — five times a quiz, and never reduced for retries.
  - **XP**: A module badge, and a track certification.
  - **Levels**: Earned from total XP; permanent, and never lost when a certificate expires.
  - **Weekly streak**: Weeks — not days — in which you met your XP goal. A weekend or a holiday cannot break it.

There are no leaderboards. Learning at work is not a competition with your colleagues, and the evidence that ranking people helps them learn is poor.

## Related

  - Training Your own SOP courses and recurring compliance training, authored per company.
  - Permissions and access The `resources` grants that gate assigning tracks and revoking certificates.

## Troubleshooting

### "No purchase order created by you since you started this challenge"
The checker looks only at records created by the signed-in user, in the current company, after the challenge's start time. A record made before pressing **Start challenge**, or by someone else, will not count. Press Start, then do the work.

### A challenge check says a record is still Draft
Challenges assert on the state the requirement names, not merely on existence. Release or post the document, then check again — retries are unlimited and cost nothing.

### The exam is locked
Every required hands-on challenge for the track must be passed first. The track page lists which ones are outstanding by name.

### "Cooling down"
The exam was failed. The first retake opens 24 hours later, subsequent ones 7 days later, and each draws a different form.

### An attempt was voided
The curriculum was updated mid-attempt. A voided attempt has no score and triggers no cooldown — start again on the new content.

### A learner's XP or streak is not on the admin dashboard
By design. The dashboard is limited to assignment status and certificates; XP, streaks, activity, and per-question results are visible only to the learner.
