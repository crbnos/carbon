// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { postingOrThrow } from "@carbon/api/postings.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import { NotificationEvent } from "@carbon/notifications";
import type { InvoiceAutomation } from "@carbon/utils";
import { datetime, ENDED_LEASE_STATUSES } from "@carbon/utils";
import { getJobDatabaseClient } from "../../../db";
import {
  attachPostedInvoicePdf,
  emailPostedInvoice,
  findInvoicesToAutomate,
  postSalesInvoiceUnattended,
  sendPostedInvoiceViaStripe
} from "../../../invoicing/automate-invoice";
import {
  buildRecurringInvoicingDigests,
  type InvoiceRunResult
} from "../../../invoicing/digest";
import {
  expireLeases,
  loadLeaseReminders,
  stampLeaseReminders
} from "../../../invoicing/lease-reminders";
import { inngest } from "../../client";
import { formatDetailDate } from "../notifications/content";

/** A drafted invoice from either source, keyed by its source document. */
type DraftedInvoice = {
  invoiceId: string;
  /** The rental agreement or customer contract it was drafted from. */
  sourceId: string;
  mode: InvoiceAutomation;
  holdReason: string | null;
};

/**
 * The one daily job for every recurring-invoice source — rental agreements
 * and AR contracts (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III): draft what is due,
 * run invoice automation over the drafts, and send each owner one digest.
 * Lessee leases (`.ai/specs/2026-10-11-lessee-leases.md`) draft purchase
 * invoices that stay Draft for the buyer, and the job also reminds lease
 * owners of notice and end dates and expires leases that have run out.
 */
export const recurringBillingFunction = inngest.createFunction(
  { id: "recurring-billing", retries: 2 },
  // Unlike the month-end proposal, no hour can pick the WRONG period here: the
  // job bills everything due on or before the company's local today, so the
  // hour only decides how soon after its due date a period is drafted — within
  // a day in every zone. 05:00 UTC is early morning in Europe and late evening
  // the day before in the Americas; a period missed today is billed tomorrow.
  { cron: "0 5 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    /** Reminds each Active lease's owner (assignee, else creator) and the
     *  company's "Also notify" group of a notice or end date within
     *  `leaseReminderDays`, once per date. Sent before the dates are stamped,
     *  so a failed stamp repeats a reminder rather than losing one. */
    const remindLeaseDates = async (company: { id: string; name: string }) => {
      const due = await step.run(`lease-reminders-${company.id}`, async () =>
        loadLeaseReminders(
          getJobDatabaseClient(),
          company.id,
          datetime
            .today(await getCompanyTimeZone(serviceRole, company.id))
            .toString()
        )
      );
      if (due.reminders.length === 0) return;

      // An owner who is in the group hears it once, through the group.
      const owners = new Map(due.owners);
      const listed = new Set(due.groupIds);
      const events = due.reminders.flatMap((reminder) => {
        const date = formatDetailDate(reminder.date) ?? reminder.date;
        const data = {
          event: NotificationEvent.LeaseCriticalDate,
          companyId: company.id,
          documentId: reminder.leaseId,
          body:
            reminder.kind === "notice"
              ? `notice must be given by ${date}`
              : `ends on ${date}`
        };
        const owner = owners.get(reminder.leaseId);
        return [
          ...(owner && !listed.has(owner)
            ? [{ type: "user" as const, userId: owner }]
            : []),
          ...(due.groupIds.length > 0
            ? [{ type: "group" as const, groupIds: due.groupIds }]
            : [])
        ].map((recipient) => ({
          name: "carbon/notify" as const,
          data: { ...data, recipient }
        }));
      });
      if (events.length > 0) {
        await step.sendEvent(`notify-lease-dates-${company.id}`, events);
      }
      await step.run(`lease-reminded-${company.id}`, () =>
        stampLeaseReminders(getJobDatabaseClient(), company.id, due.reminders)
      );
    };
    const scheduled = await step.run("find-companies", async () => {
      logger.info(
        `Scheduled recurring billing started: ${datetime.timestamp()}`
      );

      // One query for every company with an Active agreement or contract,
      // rather than a step per company that then finds nothing to bill.
      // Kysely is not subject to PostgREST's max_rows, so the list is never
      // truncated.
      const db = getJobDatabaseClient();
      const [rentalCompanies, contractCompanies, leaseCompanies] =
        await Promise.all([
          db
            .selectFrom("rentalAgreement as ra")
            .innerJoin("company as c", "c.id", "ra.companyId")
            .select(["c.id", "c.name"])
            .where("ra.status", "=", "Active")
            .distinct()
            .execute(),
          db
            .selectFrom("customerContract as cc")
            .innerJoin("company as c", "c.id", "cc.companyId")
            .select(["c.id", "c.name"])
            .where("cc.status", "=", "Active")
            .distinct()
            .execute(),
          // An Active lease (to bill, remind or expire), or an ended one with a
          // payment still to bill.
          db
            .selectFrom("lease as l")
            .innerJoin("company as c", "c.id", "l.companyId")
            .select(["c.id", "c.name"])
            .where((eb) =>
              eb.or([
                eb("l.status", "=", "Active"),
                eb.and([
                  eb("l.status", "in", ENDED_LEASE_STATUSES),
                  eb.exists(
                    eb
                      .selectFrom("leasePayment as p")
                      .select("p.id")
                      .whereRef("p.leaseId", "=", "l.id")
                      .whereRef("p.companyId", "=", "l.companyId")
                      .where("p.status", "=", "Pending")
                  )
                ])
              ])
            )
            .distinct()
            .execute()
        ]);

      // The union, noting which sources each company has to bill.
      const byId = new Map<
        string,
        {
          id: string;
          name: string;
          hasRentals: boolean;
          hasContracts: boolean;
          hasLeases: boolean;
        }
      >();
      const note = (
        list: { id: string; name: string }[],
        flag: "hasRentals" | "hasContracts" | "hasLeases"
      ) => {
        for (const c of list) {
          const known = byId.get(c.id) ?? {
            ...c,
            hasRentals: false,
            hasContracts: false,
            hasLeases: false
          };
          known[flag] = true;
          byId.set(c.id, known);
        }
      };
      note(rentalCompanies, "hasRentals");
      note(contractCompanies, "hasContracts");
      note(leaseCompanies, "hasLeases");
      const companies = [...byId.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      );

      if (companies.length === 0) {
        logger.info(
          "No companies with Active rental agreements, contracts or leases"
        );
      }

      return companies;
    });

    // One step per company: each is its own invocation with its own retries
    // and is memoized on replay, so a slow or failing tenant costs only
    // itself. A retry is safe: billed periods and charges are stamped with
    // their invoice line, so a second pass for the same day drafts nothing new.
    const failed: string[] = [];
    for (const company of scheduled) {
      const invoices: DraftedInvoice[] = [];
      let companyFailed = false;
      // The day the rental step billed as of, so contracts bill the same day.
      let billedAsOf: string | undefined;

      if (company.hasRentals) {
        try {
          const rentals = await step.run(
            `rental-billing-${company.id}`,
            async () => {
              // The cron is UTC; "due" is judged on the company's own calendar.
              const tz = await getCompanyTimeZone(serviceRole, company.id);
              const asOf = datetime.today(tz).toString();

              const drafted = await postingOrThrow(
                "create-rental-invoices",
                {
                  db: getJobDatabaseClient(),
                  companyId: company.id,
                  userId: "system"
                },
                { asOf }
              );

              for (const failure of drafted.failures) {
                logger.error(
                  "Failed to bill rental agreement {rentalAgreementId} for {company}",
                  {
                    rentalAgreementId: failure.rentalAgreementId,
                    company: company.name,
                    companyId: company.id,
                    error: failure.error
                  }
                );
              }
              logger.info(
                drafted.invoices.length > 0
                  ? `Drafted ${drafted.invoices.length} rental invoice(s) for ${company.name} as of ${asOf}: ${drafted.invoiceIds.join(", ")}`
                  : `Nothing due for ${company.name} as of ${asOf}`
              );
              // Early-return credits are Draft credit memos a person posts.
              if (drafted.creditMemos.length > 0) {
                logger.info(
                  `Drafted ${drafted.creditMemos.length} rental credit memo(s) for ${company.name} as of ${asOf}`
                );
              }

              return {
                asOf,
                invoices: drafted.invoices,
                failures: drafted.failures
              };
            }
          );
          billedAsOf = rentals.asOf;
          for (const invoice of rentals.invoices) {
            invoices.push({
              invoiceId: invoice.invoiceId,
              sourceId: invoice.rentalAgreementId,
              mode: invoice.mode,
              holdReason: invoice.holdReason
            });
          }
          // Agreements that failed stay unbilled until tomorrow's run; the
          // rest were drafted and are automated below.
          if (rentals.failures.length > 0) companyFailed = true;
        } catch (error) {
          logger.error("Failed to bill rentals for company {company}", {
            company: company.name,
            companyId: company.id,
            error
          });
          companyFailed = true;
        }
      }

      if (company.hasContracts) {
        try {
          const contracts = await step.run(
            `contract-billing-${company.id}`,
            async () => {
              const asOf =
                billedAsOf ??
                datetime
                  .today(await getCompanyTimeZone(serviceRole, company.id))
                  .toString();

              const drafted = await postingOrThrow(
                "create-contract-invoices",
                {
                  db: getJobDatabaseClient(),
                  companyId: company.id,
                  userId: "system"
                },
                { asOf }
              );

              for (const failure of drafted.failures) {
                logger.error(
                  "Failed to bill contract {customerContractId} for {company}",
                  {
                    customerContractId: failure.customerContractId,
                    company: company.name,
                    companyId: company.id,
                    error: failure.error
                  }
                );
              }
              logger.info(
                drafted.invoices.length > 0
                  ? `Drafted ${drafted.invoices.length} contract invoice(s) for ${company.name} as of ${asOf}: ${drafted.invoiceIds.join(", ")}`
                  : `No contract invoices due for ${company.name} as of ${asOf}`
              );

              return {
                invoices: drafted.invoices,
                failures: drafted.failures
              };
            }
          );
          for (const invoice of contracts.invoices) {
            invoices.push({
              invoiceId: invoice.invoiceId,
              sourceId: invoice.customerContractId,
              mode: invoice.mode,
              holdReason: invoice.holdReason
            });
          }
          // Contracts that failed rolled back and stay Planned until
          // tomorrow's run.
          if (contracts.failures.length > 0) companyFailed = true;
        } catch (error) {
          logger.error("Failed to bill contracts for company {company}", {
            company: company.name,
            companyId: company.id,
            error
          });
          companyFailed = true;
        }
      }

      // Lease invoices stay Draft: the buyer adds the supplier's invoice
      // number and posts them, so they skip automation and are reported as
      // drafted.
      const leaseDrafts: InvoiceRunResult[] = [];
      if (company.hasLeases) {
        try {
          const leases = await step.run(
            `lease-billing-${company.id}`,
            async () => {
              const asOf =
                billedAsOf ??
                datetime
                  .today(await getCompanyTimeZone(serviceRole, company.id))
                  .toString();

              const drafted = await postingOrThrow(
                "create-lease-invoices",
                {
                  db: getJobDatabaseClient(),
                  companyId: company.id,
                  userId: "system"
                },
                { asOf }
              );

              for (const failure of drafted.failures) {
                logger.error("Failed to bill lease {leaseId} for {company}", {
                  leaseId: failure.leaseId,
                  company: company.name,
                  companyId: company.id,
                  error: failure.error
                });
              }
              logger.info(
                drafted.invoices.length > 0
                  ? `Drafted ${drafted.invoices.length} lease invoice(s) for ${company.name} as of ${asOf}: ${drafted.invoiceIds.join(", ")}`
                  : `No lease payments due for ${company.name} as of ${asOf}`
              );

              return {
                invoices: drafted.invoices,
                failures: drafted.failures
              };
            }
          );
          for (const invoice of leases.invoices) {
            leaseDrafts.push({
              invoiceId: invoice.invoiceId,
              documentType: "purchaseInvoice",
              sourceId: invoice.leaseId,
              outcome: "drafted"
            });
          }
          // Leases that failed stay Pending until tomorrow's run.
          if (leases.failures.length > 0) companyFailed = true;
        } catch (error) {
          logger.error("Failed to bill leases for company {company}", {
            company: company.name,
            companyId: company.id,
            error
          });
          companyFailed = true;
        }

        try {
          await remindLeaseDates(company);
        } catch (error) {
          logger.error("Failed to send lease reminders for {company}", {
            company: company.name,
            companyId: company.id,
            error
          });
          companyFailed = true;
        }

        try {
          await step.run(`lease-expiry-${company.id}`, async () => {
            const today = datetime
              .today(await getCompanyTimeZone(serviceRole, company.id))
              .toString();
            const expired = await expireLeases(
              getJobDatabaseClient(),
              company.id,
              today
            );
            if (expired > 0) {
              logger.info(`Expired ${expired} lease(s) for ${company.name}`);
            }
            return expired;
          });
        } catch (error) {
          logger.error("Failed to expire leases for {company}", {
            company: company.name,
            companyId: company.id,
            error
          });
          companyFailed = true;
        }
      }

      if (companyFailed) failed.push(company.id);

      // Posts and emails (or sends via Stripe) per the source's invoice
      // automation (spec 2026-10-02-rental-invoice-automation). Draft Only
      // drafts wait for a person and are not reported; a draft the planner
      // held this run is.
      const results: InvoiceRunResult[] = [...leaseDrafts];
      for (const invoice of invoices) {
        if (invoice.mode === "Draft Only" || !invoice.holdReason) continue;
        results.push({
          invoiceId: invoice.invoiceId,
          documentType: "salesInvoice",
          sourceId: invoice.sourceId,
          outcome: "held"
        });
      }

      // What to automate comes from the database, not from the drafting
      // steps above: a drafting step that is retried drafts nothing new, and
      // one that failed returns nothing, yet the drafts an earlier attempt
      // committed still need posting. This picks up every unheld job-drafted
      // Draft (and reports a Pending one left by a crashed claim as held).
      let toAutomate: Awaited<ReturnType<typeof findInvoicesToAutomate>> = [];
      try {
        toAutomate = await step.run(`automation-candidates-${company.id}`, () =>
          findInvoicesToAutomate(getJobDatabaseClient(), company.id)
        );
      } catch (error) {
        logger.error("Failed to find invoices to automate for {company}", {
          company: company.name,
          companyId: company.id,
          error
        });
        if (!companyFailed) failed.push(company.id);
      }

      for (const invoice of toAutomate) {
        const result = (outcome: InvoiceRunResult["outcome"]) =>
          results.push({
            invoiceId: invoice.invoiceId,
            documentType: "salesInvoice",
            sourceId: invoice.sourceId,
            outcome
          });

        try {
          const posted = await step.run(`post-${invoice.invoiceId}`, () =>
            postSalesInvoiceUnattended({
              client: serviceRole,
              db: getJobDatabaseClient(),
              companyId: company.id,
              invoiceId: invoice.invoiceId
            })
          );
          if (posted.outcome === "skipped") continue;
          if (posted.outcome === "held") {
            result("held");
            continue;
          }
          // Every posted invoice gets its PDF, as a manual Post files one.
          await step.run(`pdf-${invoice.invoiceId}`, () =>
            attachPostedInvoicePdf({
              client: serviceRole,
              companyId: company.id,
              invoiceId: invoice.invoiceId
            })
          );
          if (
            invoice.mode !== "Post and Email" &&
            invoice.mode !== "Post and Send via Stripe"
          ) {
            result("posted");
            continue;
          }

          // A Stripe send counts as sent in the digest, like an email.
          const emailed =
            invoice.mode === "Post and Send via Stripe"
              ? await step.run(`stripe-${invoice.invoiceId}`, () =>
                  sendPostedInvoiceViaStripe({
                    client: serviceRole,
                    db: getJobDatabaseClient(),
                    companyId: company.id,
                    invoiceId: invoice.invoiceId
                  })
                )
              : await step.run(`email-${invoice.invoiceId}`, () =>
                  emailPostedInvoice({
                    client: serviceRole,
                    companyId: company.id,
                    invoiceId: invoice.invoiceId
                  })
                );
          result(
            emailed.emailed
              ? "emailed"
              : emailed.sendError
                ? "unsent"
                : "posted"
          );
        } catch (error) {
          // Its state is uncertain, so a person should look at it.
          logger.error("Failed to automate invoice {invoiceId}", {
            invoiceId: invoice.invoiceId,
            companyId: company.id,
            error
          });
          result("held");
        }
      }

      if (results.length === 0) continue;

      try {
        const recipients = await step.run(
          `digest-recipients-${company.id}`,
          async () => {
            const db = getJobDatabaseClient();
            const sourceIds = [...new Set(results.map((r) => r.sourceId))];
            const [agreements, contracts, leases, settings] = await Promise.all(
              [
                db
                  .selectFrom("rentalAgreement")
                  .select(["id", "salesPersonId", "createdBy"])
                  .where("companyId", "=", company.id)
                  .where("id", "in", sourceIds)
                  .execute(),
                db
                  .selectFrom("customerContract")
                  .select(["id", "salesPersonId", "createdBy"])
                  .where("companyId", "=", company.id)
                  .where("id", "in", sourceIds)
                  .execute(),
                db
                  .selectFrom("lease")
                  .select(["id", "assignee", "createdBy"])
                  .where("companyId", "=", company.id)
                  .where("id", "in", sourceIds)
                  .execute(),
                db
                  .selectFrom("companySettings")
                  .select("invoiceNotificationGroup")
                  .where("id", "=", company.id)
                  .executeTakeFirst()
              ]
            );

            // The owner is the salesperson (a lease's assignee), else the
            // creator — when they can still be notified in this company.
            const ownerOf = [
              ...[...agreements, ...contracts].map((a) => ({
                id: a.id,
                owner: a.salesPersonId ?? a.createdBy
              })),
              ...leases.map((l) => ({
                id: l.id,
                owner: l.assignee ?? l.createdBy
              }))
            ].filter((a) => a.owner && a.owner !== "system");
            const ownerIds = [...new Set(ownerOf.map((a) => a.owner))];
            const members =
              ownerIds.length > 0
                ? await db
                    .selectFrom("userToCompany")
                    .select("userId")
                    .where("companyId", "=", company.id)
                    .where("userId", "in", ownerIds)
                    .execute()
                : [];
            const memberIds = new Set(members.map((m) => m.userId));

            return {
              owners: ownerOf
                .filter((a) => memberIds.has(a.owner))
                .map((a) => [a.id, a.owner] as [string, string]),
              groupIds: settings?.invoiceNotificationGroup ?? []
            };
          }
        );

        const digests = buildRecurringInvoicingDigests(
          results,
          new Map(recipients.owners),
          recipients.groupIds
        );
        for (const digest of digests) {
          const recipientKey =
            digest.recipient.type === "user"
              ? digest.recipient.userId
              : "group";
          // A recipient can get two: the sales invoices and the lease drafts.
          const key =
            digest.documentType === "purchaseInvoice"
              ? `${recipientKey}-lease`
              : recipientKey;
          await step.sendEvent(
            `notify-recurring-invoicing-${company.id}-${key}`,
            {
              name: "carbon/notify",
              data: {
                event: NotificationEvent.RecurringInvoicing,
                companyId: company.id,
                documentIds: digest.documentIds,
                documentType: digest.documentType,
                recipient: digest.recipient,
                body: digest.body
              }
            }
          );
        }
      } catch (error) {
        logger.error(
          "Failed to send the recurring invoicing digest for {company}",
          { company: company.name, companyId: company.id, error }
        );
      }
    }

    return { scheduled: scheduled.length, failed };
  }
);
