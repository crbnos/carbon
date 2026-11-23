-- A rental charge goes on the agreement's regular invoice with the rent
-- unless it is marked to be invoiced separately — then it is drafted on its
-- own invoice and held for review (damage, disputes). A Purchase Option is
-- always invoiced separately, whatever this says.

ALTER TABLE "rentalAgreementCharge"
  ADD COLUMN IF NOT EXISTS "invoiceSeparately" BOOLEAN NOT NULL DEFAULT false;
