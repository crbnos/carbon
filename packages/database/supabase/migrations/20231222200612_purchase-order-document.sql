CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    pol.*,
    po."supplierId" ,
    -- p.name AS "partName",
    -- p.description AS "partDescription",
    ps."supplierPartId",
    s.name AS "serviceName",
    s.description AS "serviceDescription",
    ss."supplierServiceId"
  FROM "purchaseOrderLine" pol
    INNER JOIN "purchaseOrder" po 
      ON po.id = pol."purchaseOrderId"
    LEFT OUTER JOIN "part" p
      ON p.id = pol."partId"
    LEFT OUTER JOIN "partSupplier" ps 
      ON p.id = ps."partId" AND po."supplierId" = ps."supplierId"
    LEFT OUTER JOIN "service" s
      ON s.id = pol."serviceId"
    LEFT OUTER JOIN "serviceSupplier" ss 
      ON s.id = ss."serviceId" AND po."supplierId" = ss."supplierId";

CREATE OR REPLACE VIEW "purchaseOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    po.id,
    s.name AS "supplierName",
    sa."addressLine1" AS "supplierAddressLine1",
    sa."addressLine2" AS "supplierAddressLine2",
    sa."city" AS "supplierCity",
    sa."state" AS "supplierState",
    sa."postalCode" AS "supplierPostalCode",
    sa."countryCode" AS "supplierCountryCode",
    dl.name AS "deliveryName",
    dl."addressLine1" AS "deliveryAddressLine1",
    dl."addressLine2" AS "deliveryAddressLine2",
    dl."city" AS "deliveryCity",
    dl."state" AS "deliveryState",
    dl."postalCode" AS "deliveryPostalCode",
    dl."countryCode" AS "deliveryCountryCode",
    pod."dropShipment",
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."state" AS "customerState",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode"
  FROM "purchaseOrder" po 
  LEFT OUTER JOIN "supplier" s 
    ON s.id = po."supplierId"
  LEFT OUTER JOIN "supplierLocation" sl
    ON sl.id = po."supplierLocationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = sl."addressId"
  INNER JOIN "purchaseOrderDelivery" pod 
    ON pod.id = po.id 
  LEFT OUTER JOIN "location" dl
    ON dl.id = pod."locationId"
  LEFT OUTER JOIN "customer" c
    ON c.id = pod."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = pod."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId";
  
  
