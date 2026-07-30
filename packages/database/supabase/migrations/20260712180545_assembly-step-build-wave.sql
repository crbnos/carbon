-- Build wave: the step's longest-path level in the planner's precedence DAG.
-- Steps sharing a wave have no ordering constraint between them and can be
-- built in parallel (different people / stations). NULL = no wave (a step on a
-- precedence cycle, or authored/re-planned outside the wave analysis). Purely
-- informational — the linear step sortOrder is unchanged.
ALTER TABLE "assemblyInstructionStep" ADD COLUMN "buildWave" INTEGER;
