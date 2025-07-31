-- Update foreign key constraint on configurationParameterGroup
ALTER TABLE "configurationParameterGroup" 
DROP CONSTRAINT "configurationParameterGroup_itemId_fkey";

ALTER TABLE "configurationParameterGroup" 
ADD CONSTRAINT "configurationParameterGroup_itemId_fkey" 
FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update foreign key constraint on configurationParameter (already has CASCADE but ensuring consistency)
ALTER TABLE "configurationParameter" 
DROP CONSTRAINT "configurationParameter_itemId_fkey";

ALTER TABLE "configurationParameter" 
ADD CONSTRAINT "configurationParameter_itemId_fkey" 
FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
