-- Forked from 20260430000001_tax-status.sql. Adds the drop-ship location's
-- address for the sales order PDF's Ship To. An order that does not drop-ship
-- has none: the Customer block already prints the order's location.
CREATE OR REPLACE VIEW "salesOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT
    so.id,
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    cc."name" AS "customerCountryName",
    ctx."taxId" AS "customerTaxId",
    ctx."vatNumber" AS "customerVatNumber",
    ctx."eori" AS "customerEori",
    pc.name AS "paymentCustomerName",
    pa."addressLine1" AS "paymentAddressLine1",
    pa."addressLine2" AS "paymentAddressLine2",
    pa."city" AS "paymentCity",
    pa."stateProvince" AS "paymentStateProvince",
    pa."postalCode" AS "paymentPostalCode",
    pa."countryCode" AS "paymentCountryCode",
    pn."name" AS "paymentCountryName",
    stc.name AS "shipToCustomerName",
    sta."addressLine1" AS "shipToAddressLine1",
    sta."addressLine2" AS "shipToAddressLine2",
    sta."city" AS "shipToCity",
    sta."stateProvince" AS "shipToStateProvince",
    sta."postalCode" AS "shipToPostalCode",
    sta."countryCode" AS "shipToCountryCode",
    stn."name" AS "shipToCountryName"
  FROM "salesOrder" so
  INNER JOIN "customer" c
    ON c.id = so."customerId"
  LEFT OUTER JOIN "customerTax" ctx
    ON ctx."customerId" = c.id
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = so."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "country" cc
    ON cc.alpha2 = ca."countryCode"
  LEFT OUTER JOIN "salesOrderPayment" sop
    ON sop.id = so.id
  LEFT OUTER JOIN "customer" pc
    ON pc.id = sop."invoiceCustomerId"
  LEFT OUTER JOIN "customerLocation" pl
    ON pl.id = sop."invoiceCustomerLocationId"
  LEFT OUTER JOIN "address" pa
    ON pa.id = pl."addressId"
  LEFT OUTER JOIN "country" pn
    ON pn.alpha2 = pa."countryCode"
  LEFT OUTER JOIN "salesOrderShipment" sos
    ON sos.id = so.id
  LEFT OUTER JOIN "customerLocation" stl
    ON stl.id = CASE WHEN sos."dropShipment" THEN sos."customerLocationId" END
  LEFT OUTER JOIN "address" sta
    ON sta.id = stl."addressId"
  LEFT OUTER JOIN "country" stn
    ON stn.alpha2 = sta."countryCode"
  LEFT OUTER JOIN "customer" stc
    ON stc.id = stl."customerId";
