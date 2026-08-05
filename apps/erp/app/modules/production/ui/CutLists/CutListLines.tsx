import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  MenuIcon,
  MenuItem,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { New } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { CutListLine } from "../../types";

type CutListLinesProps = {
  cutListId: string;
  lines: CutListLine[];
  unitOfDimension: string;
  isEditable: boolean;
};

const CutListLines = ({
  cutListId,
  lines,
  unitOfDimension,
  isEditable
}: CutListLinesProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t`Pieces`}</CardTitle>
        {isEditable && permissions.can("update", "production") && (
          <CardAction>
            <New
              label={t`Piece`}
              to={path.to.newCutListLine(cutListId)}
              variant="secondary"
            />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">
            {t`No pieces yet. Add one, or build this list from open job demand.`}
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>{t`Material`}</Th>
                <Th>{t`Job`}</Th>
                <Th className="text-right">{t`Length`}</Th>
                <Th className="text-right">{t`Pieces`}</Th>
                <Th className="text-right">{t`Cut`}</Th>
                {isEditable && <Th className="w-10" />}
              </Tr>
            </Thead>
            <Tbody>
              {lines.map((line) => {
                const item = line.item as {
                  readableIdWithRevision?: string | null;
                  name?: string | null;
                } | null;
                const job = line.job as { jobId?: string | null } | null;
                return (
                  <Tr key={line.id}>
                    <Td>
                      <div className="flex flex-col gap-0">
                        <span className="font-medium">
                          {item?.readableIdWithRevision ?? ""}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item?.name ?? ""}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      {line.jobId && job?.jobId ? (
                        <Link
                          to={path.to.job(line.jobId)}
                          className="text-primary hover:underline"
                        >
                          {job.jobId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {line.pieceLength}
                      {line.pieceWidth ? ` × ${line.pieceWidth}` : ""}{" "}
                      <span className="text-muted-foreground text-xs">
                        {unitOfDimension}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{line.quantity}</Td>
                    <Td className="text-right tabular-nums">
                      {line.quantityCut}
                    </Td>
                    {isEditable && (
                      <Td>
                        <div className="flex items-center gap-1 justify-end">
                          <MenuItem
                            onClick={() =>
                              navigate(path.to.cutListLine(cutListId, line.id!))
                            }
                          >
                            <MenuIcon icon={<LuPencil />} />
                          </MenuItem>
                          <MenuItem
                            destructive
                            disabled={!permissions.can("delete", "production")}
                            onClick={() =>
                              navigate(
                                path.to.deleteCutListLine(cutListId, line.id!)
                              )
                            }
                          >
                            <MenuIcon icon={<LuTrash />} />
                          </MenuItem>
                        </div>
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default CutListLines;
