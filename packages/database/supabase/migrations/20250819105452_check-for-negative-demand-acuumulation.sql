ALTER TABLE "itemPlanning"
ADD CONSTRAINT "itemPlanning_demandAccumulationPeriod_positive" 
CHECK ("demandAccumulationPeriod" > 0);
