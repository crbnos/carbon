-- =============================================================================
-- Cleanup: Remove Dead Search Trigger Functions
--
-- The equipment, equipmentType, and workCellType tables were dropped in
-- migration 20240819115702_work-centers.sql but their trigger functions
-- were never cleaned up. This migration removes the orphaned functions.
-- =============================================================================

-- Equipment search functions (from 20230302030217_equipment.sql)
DROP FUNCTION IF EXISTS public.create_equipment_search_result();
DROP FUNCTION IF EXISTS public.update_equipment_search_result();

-- EquipmentType search functions (from 20240223235518_search_equipment_and_work_cell_types.sql)
DROP FUNCTION IF EXISTS public.create_equipment_type_search_result();
DROP FUNCTION IF EXISTS public.update_equipment_type_search_result();
DROP FUNCTION IF EXISTS public.delete_equipment_type_search_result();

-- WorkCellType search functions (from 20240223235518_search_equipment_and_work_cell_types.sql)
DROP FUNCTION IF EXISTS public.create_work_cell_type_search_result();
DROP FUNCTION IF EXISTS public.update_work_cell_type_search_result();
DROP FUNCTION IF EXISTS public.delete_work_cell_type_search_result();
