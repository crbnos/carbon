import {
  Button,
  EvidencePanel,
  ExceptionCard,
  ObjectHeader,
  RiskIndicator,
  StatusBadge
} from "@carbon/react";

import {
  blockedEquipmentException,
  evidenceRecords,
  highRiskOperation,
  productionOrder
} from "../fixtures";

export default function FidsShowcase() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 p-4 sm:p-6 lg:p-10">
      <header className="border-border border-b pb-6">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.18em]">
          Factory Industrial Design System · P0.5
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">
          Contract-driven semantic showcase
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground text-sm">
          Static design-QA fixtures only. Source adapters produce contracts for
          this page; it does not read or write ERP, MES or Factory OS data.
        </p>
      </header>

      <section aria-labelledby="object-header-title" className="space-y-4">
        <h2 id="object-header-title" className="font-semibold text-xl">
          FactoryObject → ObjectHeader
        </h2>
        <ObjectHeader
          object={{ ...productionOrder, risk: "high" }}
          metadata={[
            { label: "Customer", value: "Sample Industrial" },
            { label: "Quantity", value: "120 EA" },
            { label: "Due", value: "18 Aug 2026" }
          ]}
          actions={<Button variant="secondary">Review sample</Button>}
        />
      </section>

      <section aria-labelledby="states-title" className="space-y-4">
        <h2 id="states-title" className="font-semibold text-xl">
          Canonical status and risk remain separate
        </h2>
        <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-4">
          <StatusBadge state="normal" />
          <StatusBadge state={highRiskOperation.status} />
          <StatusBadge state="warning" label="Waiting" />
          <StatusBadge state="critical" label="Failed" />
          <StatusBadge state="unknown" label="Source state unavailable" />
          <RiskIndicator level="none" />
          <RiskIndicator level="low" />
          <RiskIndicator level="medium" />
          <RiskIndicator level="high" />
          <RiskIndicator level="unknown" />
        </div>
      </section>

      <section aria-labelledby="exceptions-title" className="space-y-4">
        <h2 id="exceptions-title" className="font-semibold text-xl">
          FactoryException → ExceptionCard
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ExceptionCard
            exception={blockedEquipmentException}
            action={<Button variant="secondary">Review exception</Button>}
          />
          <ExceptionCard
            exception={{
              id: "EX-MATERIAL-UNKNOWN",
              type: "material-shortage",
              severity: "unknown",
              subject: { id: productionOrder.id, type: productionOrder.type },
              summary: "Material allocation incomplete",
              facts: [
                {
                  label: "Observed",
                  description:
                    "Approved supplier confirmation has not reached the planning record."
                }
              ],
              evidenceRefs: [],
              lifecycle: "unknown"
            }}
          />
        </div>
      </section>

      <section aria-labelledby="evidence-title" className="space-y-4">
        <h2 id="evidence-title" className="font-semibold text-xl">
          EvidenceRecord[] → EvidencePanel
        </h2>
        <EvidencePanel records={evidenceRecords} />
      </section>
    </main>
  );
}
