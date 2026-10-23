ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'projectChangeRequest';
CREATE TYPE "projectChangeRequestStatus" AS ENUM ('Draft', 'In Review', 'Approved', 'Rejected', 'Applied', 'Cancelled');
CREATE TYPE "projectChangeOperation" AS ENUM ('Add', 'Update', 'Delete');
CREATE TYPE "projectPlanTable" AS ENUM ('projectElement', 'projectElementLink', 'projectElementMaterial', 'projectElementLabor', 'projectElementCost');
CREATE TYPE "projectBaselineSource" AS ENUM ('Manual', 'Milestone', 'Change Request');
