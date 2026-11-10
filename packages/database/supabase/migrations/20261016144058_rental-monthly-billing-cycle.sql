-- A rental agreement billed monthly from its start date: a start on the 7th
-- bills the 7th to the 6th, invoiced on the same day every month for the
-- month rate. Calendar Month aligns every agreement to the 1st; 28 Days bills
-- thirteen periods a year. See .ai/plans/2026-10-16-rental-monthly-anniversary-billing.md.
ALTER TYPE "rentalBillingCycle" ADD VALUE IF NOT EXISTS 'Monthly';
