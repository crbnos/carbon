-- Merge of main into projects-wbs-research-spec. This branch's
-- 20261021004800_planning-rpcs-segment and 20261021010900 give
-- get_purchasing_planning a "planningSegmentId" column. Main's next migration,
-- 20261013004600_planning-rpcs-include-open-supply, runs CREATE OR REPLACE with
-- main's return type, which Postgres refuses ("cannot change return type") on a
-- new database. Dropping the function first lets main's migration apply;
-- 20261021012800_merge-main-approval-requests-and-tracked-entities creates the
-- merged function again. Nothing depends on the function in pg_depend.
DROP FUNCTION IF EXISTS get_purchasing_planning(TEXT, TEXT, TEXT[]);
