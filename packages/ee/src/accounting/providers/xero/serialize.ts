import { round } from "@carbon/utils";

// Xero's API rounds/validates decimal places per field class. These constants
// are the boundary's external contract (not internal scale choices): monetary
// line/total/payment fields carry two decimals, per-unit amounts allow four,
// and exchange rates allow six. Rounding at serialization keeps payloads valid
// no matter what precision Carbon carries internally — and stops raw float
// artifacts (0.45000000000000007) from reaching the API.
export const XERO_MONEY_DECIMALS = 2;
export const XERO_UNIT_AMOUNT_DECIMALS = 4;
export const XERO_QUANTITY_DECIMALS = 4;
export const XERO_CURRENCY_RATE_DECIMALS = 6;

export const xeroMoney = (value: number) => round(value, XERO_MONEY_DECIMALS);

export const xeroUnitAmount = (value: number) =>
  round(value, XERO_UNIT_AMOUNT_DECIMALS);

/** Xero recomputes LineAmount as Quantity x UnitAmount, so the quantity we send
 *  has to be the same one the extension is derived from — round it once, here,
 *  and build the line off the result. */
export const xeroQuantity = (value: number) =>
  round(value, XERO_QUANTITY_DECIMALS);

export const xeroCurrencyRate = (value: number) =>
  round(value, XERO_CURRENCY_RATE_DECIMALS);
