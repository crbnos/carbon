CREATE TYPE "planningGroupExcessRule" AS ENUM ('Common Stock', 'Exception Project');
CREATE TYPE "planningGroupPriorityRule" AS ENUM ('Earliest Need', 'Project Priority');
CREATE TYPE "projectPegState" AS ENUM ('Soft', 'Hard', 'Manual');
CREATE TYPE "projectPegSupplyType" AS ENUM ('Purchase Order Line', 'Job', 'Planning Action');
