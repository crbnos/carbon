#!/usr/bin/env python3
"""Record-switch sweep: does a page show record B after switching from record A?

For each record page it opens record A, switches to record B inside the app (a
client navigation, as a link or the search does), reads every field, editor and
heading on screen, and compares that with a fresh load of record B. A
difference is state carried over from A: a form with A's id, an editor with A's
text. On 2026-10-06 six of 38 pages failed this on main (supplier tax and
customer payments kept the previous party's id, so a save went to the wrong
record).

Needs the local stack running and a signed-in agent-browser session (see the
auth skill). Do not edit source files while it runs: a rebuild under it makes
pages time out. A page that loads content late can differ once; rerun it alone.

  python3 .ai/scripts/record-switch-sweep.py            # every page below
  python3 .ai/scripts/record-switch-sweep.py part job   # only these names

Exit code 1 when any page differs or could not be read.
"""

import collections
import json
import os
import re
import subprocess
import sys
import time

WAIT = float(os.environ.get("SWEEP_WAIT", "4"))

# name, path (ID = the record), table, extra SQL filter
PAGES = [
    ("part", "/x/part/ID/details", "item", "and type='Part'"),
    ("part-purchasing", "/x/part/ID/purchasing", "item", "and type='Part'"),
    ("part-planning", "/x/part/ID/planning", "item", "and type='Part'"),
    ("part-inventory", "/x/part/ID/inventory", "item", "and type='Part'"),
    ("part-sales", "/x/part/ID/sales", "item", "and type='Part'"),
    ("part-costing", "/x/part/ID/costing", "item", "and type='Part'"),
    ("part-quality", "/x/part/ID/quality", "item", "and type='Part'"),
    ("material", "/x/material/ID/details", "item", "and type='Material'"),
    ("tool", "/x/tool/ID/details", "item", "and type='Tool'"),
    ("consumable", "/x/consumable/ID/details", "item", "and type='Consumable'"),
    ("service", "/x/service/ID/details", "item", "and type='Service'"),
    ("job", "/x/job/ID/details", "job", ""),
    ("job-materials", "/x/job/ID/materials", "job", ""),
    ("job-operations", "/x/job/ID/operations", "job", ""),
    ("purchase-order", "/x/purchase-order/ID/details", "purchaseOrder", ""),
    ("sales-order", "/x/sales-order/ID/details", "salesOrder", ""),
    ("quote", "/x/quote/ID/details", "quote", ""),
    ("sales-invoice", "/x/sales-invoice/ID/details", "salesInvoice", ""),
    ("purchase-invoice", "/x/purchase-invoice/ID/details", "purchaseInvoice", ""),
    ("supplier", "/x/supplier/ID/details", "supplier", ""),
    ("supplier-contacts", "/x/supplier/ID/contacts", "supplier", ""),
    ("supplier-locations", "/x/supplier/ID/locations", "supplier", ""),
    ("supplier-payments", "/x/supplier/ID/payments", "supplier", ""),
    ("supplier-shipping", "/x/supplier/ID/shipping", "supplier", ""),
    ("supplier-tax", "/x/supplier/ID/tax", "supplier", ""),
    ("customer", "/x/customer/ID/details", "customer", ""),
    ("customer-contacts", "/x/customer/ID/contacts", "customer", ""),
    ("customer-locations", "/x/customer/ID/locations", "customer", ""),
    ("customer-payments", "/x/customer/ID/payments", "customer", ""),
    ("customer-shipping", "/x/customer/ID/shipping", "customer", ""),
    ("customer-tax", "/x/customer/ID/tax", "customer", ""),
    ("issue", "/x/issue/ID/details", "nonConformance", ""),
    ("receipt", "/x/receipt/ID/details", "receipt", ""),
    ("shipment", "/x/shipment/ID/details", "shipment", ""),
    ("picking-list", "/x/picking-list/ID/details", "pickingList", ""),
    ("stock-transfer", "/x/stock-transfer/ID", "stockTransfer", ""),
    ("warehouse-transfer", "/x/warehouse-transfer/ID/details", "warehouseTransfer", ""),
    ("inventory-count", "/x/inventory-count/ID", "inventoryCount", ""),
    ("maintenance", "/x/maintenance/ID", "maintenanceDispatch", ""),
    ("supplier-quote", "/x/supplier-quote/ID/details", "supplierQuote", ""),
    ("sales-rfq", "/x/sales-rfq/ID/details", "salesRfq", ""),
    ("purchasing-rfq", "/x/purchasing-rfq/ID/details", "purchasingRfq", ""),
    ("sales-return", "/x/sales-return-order/ID/details", "salesReturnOrder", ""),
    ("purchase-return", "/x/purchase-return-order/ID/details", "purchaseReturnOrder", ""),
    ("procedure", "/x/procedure/ID", "procedure", ""),
    ("payment", "/x/payments/ID", "payment", ""),
    ("fixed-asset", "/x/fixed-asset/ID/details", "fixedAsset", ""),
    ("journal-entry", "/x/journal-entry/ID/details", "journal", ""),
    ("person", "/x/person/ID/details", "employee", ""),
    ("change-notice", "/x/items/change-notice/ID/details", "changeOrder", ""),
    ("gauge-drawer", "/x/quality/gauges/ID", "gauge", ""),
    ("work-center-drawer", "/x/resources/work-centers/ID", "workCenter", ""),
    ("process-drawer", "/x/resources/processes/ID", "process", ""),
    ("payment-term-drawer", "/x/accounting/payment-terms/ID", "paymentTerm", ""),
]

# Everything a user could read off the page that belongs to the record.
FINGERPRINT = r"""(() => { const f=[];
// The page and any drawer or modal over it (those render outside <main>).
const main={ querySelectorAll: (q) => [...document.querySelectorAll("main, [role=dialog]")].flatMap(r=>[...r.querySelectorAll(q)]) };
main.querySelectorAll("input,textarea,select").forEach(e=>{ const n=e.name||e.getAttribute("aria-label")||e.placeholder||e.type; if(/^__|csrf|search/i.test(n)) return; f.push(n+"="+(e.type==="checkbox"||e.type==="radio"?e.checked:e.value)) });
main.querySelectorAll("[contenteditable=true],.ProseMirror").forEach(e=>f.push("editor="+e.textContent.trim().slice(0,160)));
main.querySelectorAll("h1,h2,h3,[role=tab][aria-selected=true]").forEach(e=>f.push("heading="+e.textContent.trim().slice(0,80)));
return JSON.stringify({p:location.pathname,n:f.length,f}) })()"""
VOLATILE = re.compile(r"\b(ago|just now|seconds?|minutes?)\b", re.I)


def env(name):
    for line in open(".env.local"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit(f"{name} is not in .env.local: is the stack set up (crbn up)?")


def browser(*args, timeout=60):
    try:
        result = subprocess.run(
            ["agent-browser", *args], capture_output=True, text=True, timeout=timeout
        )
        return (result.stdout or result.stderr).strip().split("\n")[-1]
    except subprocess.TimeoutExpired:
        return "TIMEOUT"


def fingerprint():
    raw = browser("eval", FINGERPRINT)
    try:
        value = json.loads(raw)
        return json.loads(value) if isinstance(value, str) else value
    except Exception:
        return {"p": "?", "n": -1, "f": ["UNREADABLE " + raw[:120]]}


def sign_in(erp):
    """A new browser session, signed in through the dev bypass."""
    browser("close")
    browser("open", erp + "/login")
    time.sleep(8)
    browser("fill", "input[name=email]", "test@carbon.ms")
    browser("click", "button[type=submit]")
    time.sleep(8)
    return "/x" in browser("get", "url")


def stable(fields):
    return collections.Counter(x for x in fields if not VOLATILE.search(x))


def two_records(db, table, where):
    company = (
        '(select u."companyId" from "userToCompany" u join "user" us on us.id=u."userId" '
        "where us.email='test@carbon.ms' limit 1)"
    )
    sql = f'select id from "{table}" where "companyId"={company} {where} order by id limit 2'
    out = subprocess.run(["psql", db, "-Atc", sql], capture_output=True, text=True)
    return [line for line in out.stdout.split("\n") if line.strip()]


def main():
    erp, db = env("ERP_URL"), env("SUPABASE_DB_URL")
    only = set(sys.argv[1:])
    counts = collections.Counter()
    for name, path, table, where in PAGES:
        if only and name not in only:
            continue
        ids = two_records(db, table, where)
        if len(ids) < 2:
            counts["skipped"] += 1
            print(f"SKIP  {name}: fewer than two records in {table}")
            continue
        a, b = (path.replace("ID", record) for record in ids)
        for attempt in (1, 2):
            browser("open", erp + a)
            time.sleep(WAIT)
            browser("eval", f"(() => {{ window.__reactRouterDataRouter.navigate('{b}'); return 1 }})()")
            time.sleep(WAIT)
            switched = fingerprint()
            browser("open", erp + b)
            time.sleep(WAIT)
            fresh = fingerprint()
            if switched["n"] > 0 and fresh["n"] > 0:
                break
            # The tab crashed or the session was lost: nothing was read.
            if attempt == 1:
                sign_in(erp)
        if switched["n"] <= 0 or fresh["n"] <= 0:
            # Never "same": two unreadable pages are equal to each other.
            counts["unreadable"] += 1
            print(f"ERROR {name}: the page could not be read ({fresh['f'][:1]})")
            continue
        if switched["p"] != fresh["p"]:
            counts["differ"] += 1
            print(f"DIFF  {name}: the switch did not arrive ({switched['p']})")
            continue
        only_switched = stable(switched["f"]) - stable(fresh["f"])
        only_fresh = stable(fresh["f"]) - stable(switched["f"])
        if only_switched or only_fresh:
            counts["differ"] += 1
            print(f"DIFF  {name}: {fresh['n']} fields")
            print("        after the switch:", "; ".join(list(only_switched)[:5]))
            print("        on a fresh load: ", "; ".join(list(only_fresh)[:5]))
        else:
            counts["same"] += 1
            print(f"same  {name}: {fresh['n']} fields")
        sys.stdout.flush()
    print(dict(counts))
    sys.exit(1 if counts["differ"] or counts["unreadable"] else 0)


if __name__ == "__main__":
    main()
