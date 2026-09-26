import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { Empty } from "~/components";
import type { FirstArticleInspectionDetail } from "~/modules/quality/types";
import { getInspectionStatusVariant } from "../Inspections/InspectionStatus";

type FirstArticleCharacteristicsProps = {
  detail: FirstArticleInspectionDetail;
};

/**
 * AS9102 Form 3 — derived live from the lot: one row per feature of its plan,
 * with the first article's reading. Read-only; results are recorded on the
 * inspection.
 */
const FirstArticleCharacteristics = ({
  detail
}: FirstArticleCharacteristicsProps) => {
  const { t } = useLingui();
  const duplicates = detail.duplicateCharacteristicNumbers;

  const statusLabel = (status: string) => {
    switch (status) {
      case "Passed":
        return t`Passed`;
      case "Failed":
        return t`Failed`;
      default:
        return t`Pending`;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Form 3: Characteristic Accountability</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Verification of every design characteristic on the inspection plan
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {duplicates.length > 0 && (
            <Alert variant="warning">
              <LuTriangleAlert className="size-4" />
              <AlertTitle>
                <Trans>Duplicate characteristic numbers</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  Each characteristic needs a unique number on the report. Used
                  more than once: {duplicates.join(", ")}
                </Trans>
              </AlertDescription>
            </Alert>
          )}
          {detail.characteristics.length === 0 ? (
            <Empty className="py-6">
              <Trans>The inspection plan has no characteristics.</Trans>
            </Empty>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>No.</Trans>
                  </Th>
                  <Th>
                    <Trans>Ref. Location</Trans>
                  </Th>
                  <Th>
                    <Trans>Designator</Trans>
                  </Th>
                  <Th>
                    <Trans>Requirement</Trans>
                  </Th>
                  <Th>
                    <Trans>Results</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>NCR</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {detail.characteristics.map((row) => (
                  <Tr key={row.featureId}>
                    <Td className="tabular-nums">{row.characteristicNumber}</Td>
                    <Td>{row.referenceLocation ?? ""}</Td>
                    <Td>{row.designator ?? ""}</Td>
                    <Td>{row.requirement}</Td>
                    <Td>{row.results ?? ""}</Td>
                    <Td>
                      <Badge variant={getInspectionStatusVariant(row.status)}>
                        {statusLabel(row.status)}
                      </Badge>
                    </Td>
                    <Td>{row.nonconformanceNumber ?? ""}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
};

export default FirstArticleCharacteristics;
