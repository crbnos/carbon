import { VStack } from "@carbon/react";
import { memo } from "react";
import type { NettingMatrixRow } from "../../accounting.service";
import NettingMatrixTable from "./NettingMatrixTable";
import NettingStatementsTable from "./NettingStatementsTable";

type NettingStatement = {
  id: string;
  statementId: string;
  currencyCode: string;
  nettedAmount: number;
  residualAmount: number;
  status: string;
  createdAt: string;
  companyA: { name: string } | null;
  companyB: { name: string } | null;
};

type NettingTabProps = {
  matrix: NettingMatrixRow[];
  statements: NettingStatement[];
  statementsCount: number;
};

const NettingTab = memo(
  ({ matrix, statements, statementsCount }: NettingTabProps) => {
    return (
      <VStack spacing={4} className="p-4">
        <NettingMatrixTable data={matrix} />
        <NettingStatementsTable data={statements} count={statementsCount} />
      </VStack>
    );
  }
);

NettingTab.displayName = "NettingTab";
export default NettingTab;
