
ALTER TABLE "material" DROP CONSTRAINT "material_itemId_fkey";
ALTER TABLE "material" ADD CONSTRAINT "material_itemId_fkey" 
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tool" DROP CONSTRAINT "tool_itemId_fkey";
ALTER TABLE "tool" ADD CONSTRAINT "tool_itemId_fkey" 
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consumable" DROP CONSTRAINT "consumable_itemId_fkey";
ALTER TABLE "consumable" ADD CONSTRAINT "consumable_itemId_fkey" 
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fixture" DROP CONSTRAINT "fixture_itemId_fkey";
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_itemId_fkey" 
  FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
