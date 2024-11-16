ALTER TABLE "salesRfq" 
ALTER COLUMN "rfqDate" SET DEFAULT CURRENT_DATE;

CREATE OR REPLACE FUNCTION create_rfq_from_model_v1(
  company_id text,
  customer_part_id text,
  email text,
  model_id text,
  sequence_number text,
  unit_of_measure text,
  notes json DEFAULT '{}'::json
)
RETURNS TABLE (
  rfq_id text,
  rfq_readable_id text,
  rfq_line_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rfq_id text;
  v_line_id text;
  v_customer_id text;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (has_role('employee', company_id) OR has_valid_api_key_for_company(company_id)) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  -- Find customer ID from email
  SELECT cc."customerId" INTO v_customer_id
  FROM "contact" c
  JOIN "customerContact" cc ON cc."contactId" = c.id 
  WHERE c."email" = create_rfq_from_model_v1.email
  AND c."companyId" = company_id
  LIMIT 1;
  
  -- Create RFQ
  INSERT INTO "salesRfq" (
    "rfqId",
    "customerId",
    "companyId",
    "createdBy"
  )
  VALUES ( 
    sequence_number,
    v_customer_id,
    company_id,
    'system'
  )
  RETURNING id INTO v_rfq_id;

  -- Create RFQ Line with model
  INSERT INTO "salesRfqLine" (
    "salesRfqId",
    "customerPartId",
    "modelUploadId",
    "unitOfMeasureCode",
    "internalNotes",
    quantity,
    "companyId",
    "createdBy"
  )
  VALUES (
    v_rfq_id,
    customer_part_id,
    model_id,
    unit_of_measure,
    notes,
    ARRAY[1],
    company_id,
    'system'
  )
  RETURNING id INTO v_line_id;

  -- Create Opportunity
  INSERT INTO "opportunity" (
    "salesRfqId",
    "companyId"
  )
  VALUES (
    v_rfq_id,
    company_id
  );

  RETURN QUERY SELECT v_rfq_id, sequence_number, v_line_id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;
