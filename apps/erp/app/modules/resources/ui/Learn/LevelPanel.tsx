import { Badge, BarProgress, HStack, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { levelForXp, xpForLevel } from "../../learn";

type LevelPanelProps = {
  totalXp: number;
  badgeCount: number;
};

const LevelPanel = ({ totalXp, badgeCount }: LevelPanelProps) => {
  const { t } = useLingui();

  const level = levelForXp(totalXp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const into = totalXp - floor;
  const span = ceiling - floor;

  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between items-baseline">
        <HStack spacing={2} className="items-baseline">
          <span className="text-sm text-muted-foreground">{t`Level`}</span>
          <span className="text-2xl font-semibold tabular-nums leading-none">
            {level}
          </span>
        </HStack>
        <Badge variant="secondary">
          {badgeCount === 1 ? t`${badgeCount} badge` : t`${badgeCount} badges`}
        </Badge>
      </HStack>
      <BarProgress
        progress={span === 0 ? 100 : (into / span) * 100}
        value={`${totalXp} XP`}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {t`${ceiling - totalXp} XP to level ${level + 1}`}
      </span>
    </VStack>
  );
};

export default LevelPanel;
