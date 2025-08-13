-- Create GIN index on external_id column
CREATE INDEX idx_contact_external_id ON contact USING GIN ("externalId");
CREATE INDEX idx_item_external_id ON item USING GIN ("externalId");
CREATE INDEX idx_part_external_id ON part USING GIN ("externalId");
CREATE INDEX idx_material_external_id ON material USING GIN ("externalId");
CREATE INDEX idx_tool_external_id ON tool USING GIN ("externalId");
CREATE INDEX idx_fixture_external_id ON fixture USING GIN ("externalId");
CREATE INDEX idx_consumable_external_id ON consumable USING GIN ("externalId");
