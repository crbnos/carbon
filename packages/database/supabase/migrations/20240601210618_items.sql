

-- -- Create the part table
-- CREATE TABLE part (
--   id TEXT NOT NULL,


--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the material table
-- CREATE TABLE material (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   type VARCHAR(255) NOT NULL,
--   dimension VARCHAR(255) NOT NULL,
--   -- Add other columns specific to materials
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the tool table
-- CREATE TABLE tool (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   -- Add other columns specific to tools
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the hardware table
-- CREATE TABLE hardware (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   -- Add other columns specific to hardware
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the service table
-- CREATE TABLE service (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   -- Add other columns specific to services
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the consumable table
-- CREATE TABLE consumable (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   -- Add other columns specific to consumables
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );

-- -- Create the fixture table
-- CREATE TABLE fixture (
--   id TEXT NOT NULL,,
--   item_id INT NOT NULL,
--   -- Add other columns specific to fixtures
--   FOREIGN KEY (item_id) REFERENCES item(id)
-- );