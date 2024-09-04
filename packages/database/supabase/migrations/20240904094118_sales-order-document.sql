ALTER TABLE "salesOrderLine"
  ADD COLUMN "methodType" "methodType" NOT NULL DEFAULT 'Make';

CREATE OR REPLACE VIEW "salesOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    so.id,
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."state" AS "customerState",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    pc.name AS "paymentCustomerName",
    pa."addressLine1" AS "paymentAddressLine1",
    pa."addressLine2" AS "paymentAddressLine2",
    pa."city" AS "paymentCity",
    pa."state" AS "paymentState",
    pa."postalCode" AS "paymentPostalCode",
    pa."countryCode" AS "paymentCountryCode"
  FROM "salesOrder" so 
  INNER JOIN "customer" c 
    ON c.id = so."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = so."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "salesOrderPayment" sop
    ON sop.id = so.id
  LEFT OUTER JOIN "customer" pc
    ON pc.id = sop."invoiceCustomerId"
  LEFT OUTER JOIN "customerLocation" pl
    ON pl.id = sop."invoiceCustomerLocationId"
  LEFT OUTER JOIN "address" pa
    ON pa.id = pl."addressId";
  
DROP VIEW "salesOrderLines";
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."thumbnailPath", imu."thumbnailPath") as "thumbnailPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);


