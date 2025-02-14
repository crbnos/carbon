DO $$
DECLARE
    company_record RECORD;
    substance_record RECORD;
    new_substance_id TEXT;
BEGIN
    -- Iterate through each company
    FOR company_record IN SELECT id FROM company
    LOOP
        -- For each global substance (where companyId is null)
        FOR substance_record IN SELECT * FROM "materialSubstance" WHERE "companyId" IS NULL
        LOOP
            -- Insert a new copy of the substance for this company
            INSERT INTO "materialSubstance" (
                "name",
                "tags", 
                "customFields",
                "companyId",
                "createdAt",
                "createdBy",
                "updatedAt",
                "updatedBy"
            )
            VALUES (
                substance_record.name,
                substance_record.tags,
                substance_record."customFields",
                company_record.id,
                substance_record."createdAt",
                substance_record."createdBy",
                substance_record."updatedAt",
                substance_record."updatedBy"
            )
            RETURNING id INTO new_substance_id;

            -- Update material references to point to the new company-specific substance
            UPDATE material 
            SET "materialSubstanceId" = new_substance_id
            WHERE "companyId" = company_record.id 
            AND "materialSubstanceId" = substance_record.id;
        END LOOP;
    END LOOP;
END $$;

-- After migrating the data, we can remove the global substances
DELETE FROM "materialSubstance" WHERE "companyId" IS NULL;

DO $$
DECLARE
    company_record RECORD;
    form_record RECORD;
    new_form_id TEXT;
BEGIN
    -- Iterate through each company
    FOR company_record IN SELECT id FROM company
    LOOP
        -- For each global form (where companyId is null)
        FOR form_record IN SELECT * FROM "materialForm" WHERE "companyId" IS NULL
        LOOP
            -- Insert a new copy of the form for this company
            INSERT INTO "materialForm" (
                "name",
                "tags", 
                "customFields",
                "companyId",
                "createdAt",
                "createdBy",
                "updatedAt",
                "updatedBy"
            )
            VALUES (
                form_record.name,
                form_record.tags,
                form_record."customFields",
                company_record.id,
                form_record."createdAt",
                form_record."createdBy",
                form_record."updatedAt",
                form_record."updatedBy"
            )
            RETURNING id INTO new_form_id;

            -- Update material references to point to the new company-specific form
            UPDATE material 
            SET "materialFormId" = new_form_id
            WHERE "companyId" = company_record.id 
            AND "materialFormId" = form_record.id;
        END LOOP;
    END LOOP;
END $$;

-- After migrating the data, we can remove the global forms
DELETE FROM "materialForm" WHERE "companyId" IS NULL;
