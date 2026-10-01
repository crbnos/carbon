// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  IconButton,
  Loading,
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import {
  LuDice5,
  LuSettings2,
  LuTrash2,
  LuTriangleAlert
} from "react-icons/lu";
import { Assignee, Empty } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Confirm } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import type { riskSource } from "~/modules/quality/quality.models";
import type { Risk } from "~/modules/quality/types";
import { path } from "~/utils/path";
import { RiskRating } from "./RiskRating";
import RiskRegisterForm from "./RiskRegisterForm";
import RiskStatus from "./RiskStatus";
import RiskType from "./RiskType";

type RiskRegisterCardProps = {
  sourceId: string;
  source: (typeof riskSource)[number];
  itemId?: string;
};

export default function RiskRegisterCard({
  sourceId,
  source,
  itemId
}: RiskRegisterCardProps) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();

  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(false);
  const formDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [selectedRisk, setSelectedRisk] = useState<Risk | undefined>(undefined);

  const fetchRisks = useCallback(async () => {
    if (!carbon || !company?.id) return;
    setLoading(true);
    const { data, error } = await carbon
      .from("riskRegister")
      .select("*, assignee:assignee(id, firstName, lastName, avatarUrl)")
      .eq("companyId", company.id)
      .eq("source", source)
      .eq("sourceId", sourceId)
      .order("createdAt", { ascending: false });

    if (error) {
      toast.error(t`Failed to fetch risks`);
      return;
    }

    if (data) {
      setRisks(data as unknown as Risk[]);
    }
    setLoading(false);
  }, [carbon, company?.id, sourceId, source, t]);

  useEffect(() => {
    fetchRisks();
  }, [fetchRisks]);

  const handleAdd = () => {
    setSelectedRisk(undefined);
    formDisclosure.onOpen();
  };

  const handleEdit = (risk: Risk) => {
    setSelectedRisk(risk);
    formDisclosure.onOpen();
  };

  const handleDelete = (risk: Risk) => {
    setSelectedRisk(risk);
    deleteDisclosure.onOpen();
  };

  return (
    <Card className="h-full">
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Risks</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          <Button
            aria-label={t`Add Risk`}
            variant="secondary"
            onClick={handleAdd}
          >
            <Trans>Add Risk</Trans>
          </Button>
        </CardAction>
      </HStack>

      <CardContent className="h-full">
        {loading ? (
          <div className="p-4">
            <Loading isLoading={true} />
          </div>
        ) : risks.length === 0 ? (
          <Empty className="py-8" />
        ) : (
          <div className="flex flex-col gap-4">
            {risks.map((risk) => (
              <RiskRegisterCardItem
                key={risk.id}
                risk={risk}
                setRisks={setRisks}
                handleEdit={handleEdit}
                handleDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </CardContent>

      {formDisclosure.isOpen && (
        <RiskRegisterForm
          open={formDisclosure.isOpen}
          onClose={() => {
            formDisclosure.onClose();
            fetchRisks();
          }}
          // @ts-expect-error TS2322 - TODO: fix type
          initialValues={
            selectedRisk
              ? {
                  ...selectedRisk,
                  description: selectedRisk.description ?? undefined,
                  assignee: selectedRisk.assignee ?? undefined,
                  sourceId: selectedRisk.sourceId ?? undefined,
                  itemId: selectedRisk.itemId ?? undefined,
                  severity: selectedRisk.severity
                    ? selectedRisk.severity.toString()
                    : "1",
                  likelihood: selectedRisk.likelihood
                    ? selectedRisk.likelihood.toString()
                    : "1",
                  type: selectedRisk.type ?? "Risk"
                }
              : {
                  title: "",
                  status: "Open",
                  source: source,
                  sourceId: sourceId,
                  itemId: itemId,
                  severity: "1",
                  likelihood: "1",
                  type: "Risk"
                }
          }
        />
      )}

      {selectedRisk && deleteDisclosure.isOpen && (
        <Confirm
          isOpen={deleteDisclosure.isOpen}
          confirmText={t`Delete`}
          onCancel={() => {
            deleteDisclosure.onClose();
            setSelectedRisk(undefined);
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
            setSelectedRisk(undefined);
            fetchRisks();
          }}
          title={t`Delete Risk`}
          text={t`Are you sure you want to delete this risk?`}
          // @ts-expect-error TS2345 - TODO: fix type
          action={path.to.deleteRisk(selectedRisk.id)}
        />
      )}
    </Card>
  );
}

function RiskRegisterCardItem({
  risk,
  setRisks,
  handleEdit,
  handleDelete
}: {
  risk: Risk;
  setRisks: React.Dispatch<React.SetStateAction<Risk[]>>;
  handleEdit: (risk: Risk) => void;
  handleDelete: (risk: Risk) => void;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();

  return (
    <div
      key={risk.id}
      className="flex flex-col hover:bg-muted/50 transition-colors group rounded-md bg-muted/30 border border-border"
    >
      <div className="p-4 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <Heading size="h4" as="h3">
            {risk.title}
          </Heading>
          <div>
            <RiskType type={risk.type} />
          </div>
          {risk.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {risk.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            aria-label={t`Edit`}
            icon={<LuSettings2 className="h-4 w-4" />}
            variant="secondary"
            size="sm"
            onClick={() => handleEdit(risk)}
          />
          {permissions.can("delete", "quality") && (
            <IconButton
              aria-label={t`Delete`}
              icon={<LuTrash2 className="h-4 w-4" />}
              variant="secondary"
              size="sm"
              onClick={() => handleDelete(risk)}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border">
        <div>
          <Assignee
            table="riskRegister"
            // @ts-expect-error TS2322 - TODO: fix type
            id={risk.id}
            size="sm"
            value={risk.assignee ?? undefined}
            onChange={(assignee) => {
              setRisks((prev) =>
                prev.map((r) => (r.id === risk.id ? { ...r, assignee } : r))
              );
            }}
          />
        </div>
        <RiskStatus status={risk.status} />
        <Enumerable value={risk.source} />
        {risk.severity && (
          <Badge variant="gray" className="flex items-center gap-1">
            <LuTriangleAlert />
            <RiskRating rating={risk.severity} size="sm" />
          </Badge>
        )}
        {risk.likelihood && (
          <Badge variant="gray" className="flex items-center gap-1">
            <LuDice5 />
            <RiskRating rating={risk.likelihood} size="sm" />
          </Badge>
        )}
      </div>
    </div>
  );
}
