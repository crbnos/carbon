CREATE TYPE "projectElementLinkType" AS ENUM ('satisfies', 'verifies', 'derives', 'implements', 'blocks', 'precedes', 'relates to', 'feeds');
CREATE TYPE "requirementCategory" AS ENUM ('Functional', 'Performance', 'Interface', 'Environmental', 'Design Constraint');
CREATE TYPE "requirementTargetOperator" AS ENUM ('≤', '≥', '=', 'Range');
CREATE TYPE "requirementVerificationMethod" AS ENUM ('Test', 'Analysis', 'Inspection', 'Demonstration');
CREATE TYPE "testCaseVerdict" AS ENUM ('Not Run', 'Pass', 'Fail', 'Inconclusive');
CREATE TYPE "parameterSource" AS ENUM ('Manual', 'Sum', 'Min', 'Max', 'Formula', 'Item');
CREATE TYPE "projectLayout" AS ENUM ('list', 'board', 'table', 'tree', 'timeline', 'reader');
