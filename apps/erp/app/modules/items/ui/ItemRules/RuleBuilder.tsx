import {
  Button,
  ChoiceSelect,
  type ChoiceSelectOption,
  Heading,
  VStack
} from "@carbon/react";
import {
  type Condition,
  type ConditionAst,
  FIELD_REGISTRY,
  type MatchKind
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuBan, LuCheckCheck, LuListChecks, LuPlus } from "react-icons/lu";
import { Hidden } from "~/components/Form";
import ConditionRow, { CONDITION_GRID_CLASS } from "./ConditionRow";
import { useValueOptions } from "./useValueOptions";

type RuleBuilderProps = {
  name: string;
  initial?: ConditionAst;
  /**
   * Notifies the parent of every condition-list change so siblings (e.g.
   * `MessageWithTokens`) can offer per-condition tokens that resolve to
   * the rule's required values at eval time.
   */
  onConditionsChange?: (conditions: Condition[]) => void;
};

const emptyCondition = (): Condition => ({
  field: FIELD_REGISTRY[0]?.path ?? "",
  op: "eq",
  value: undefined
});

export default function RuleBuilder({
  name,
  initial,
  onConditionsChange
}: RuleBuilderProps) {
  const { t } = useLingui();
  const [kind, setKind] = useState<MatchKind>(initial?.kind ?? "all");

  const matchOptions = useMemo<ChoiceSelectOption<MatchKind>[]>(
    () => [
      {
        value: "all",
        title: t`Match all`,
        description: t`Every condition must match`,
        icon: <LuCheckCheck />
      },
      {
        value: "any",
        title: t`Match any`,
        description: t`At least one condition must match`,
        icon: <LuListChecks />
      },
      {
        value: "none",
        title: t`Match none`,
        description: t`No condition may match`,
        icon: <LuBan />
      }
    ],
    [t]
  );
  const [conditions, setConditions] = useState<Condition[]>(
    initial?.conditions?.length ? initial.conditions : [emptyCondition()]
  );
  const optionsByLoader = useValueOptions();

  // Keep parents in sync with the live condition list. `onConditionsChange`
  // identity isn't tracked — parents wrap in `useCallback` if they need it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callback identity intentionally untracked
  useEffect(() => {
    onConditionsChange?.(conditions);
  }, [conditions]);

  const handleChange = useCallback(
    (index: number, patch: Partial<Condition>) => {
      setConditions((prev) =>
        prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const handleRemove = useCallback((index: number) => {
    setConditions((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );
  }, []);

  const handleAdd = useCallback(() => {
    setConditions((prev) => [...prev, emptyCondition()]);
  }, []);

  const ast: ConditionAst = { kind, conditions };

  return (
    <VStack spacing={2} className="w-full">
      <div className="flex items-center justify-between w-full gap-3 flex-wrap">
        <Heading size="h4">
          <Trans>Conditions</Trans>
        </Heading>
        <ChoiceSelect<MatchKind>
          value={kind}
          onChange={setKind}
          options={matchOptions}
          aria-label={t`Match`}
          align="end"
          className="w-[180px]"
        />
      </div>

      <Hidden name={name} value={JSON.stringify(ast)} />

      <div className="flex flex-col gap-2 w-full">
        <div className="hidden sm:flex w-full items-center gap-2" aria-hidden>
          <div className={`${CONDITION_GRID_CLASS} flex-1 min-w-0 px-3`}>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t`Field`}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t`Operator`}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t`Value`}
            </span>
          </div>
          <div className="w-8 shrink-0" />
        </div>
        {conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c}
            index={i}
            canRemove={conditions.length > 1}
            onChange={handleChange}
            onRemove={handleRemove}
            optionsByLoader={optionsByLoader}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<LuPlus />}
        onClick={handleAdd}
      >
        <Trans>Add condition</Trans>
      </Button>
    </VStack>
  );
}
