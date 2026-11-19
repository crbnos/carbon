-- The shared Storage keeps its tenant registry here, apart from every
-- worktree database (DATABASE_MULTITENANT_URL in docker-compose.shared.yml).
-- Runs once, on the first boot of an empty carbon-postgres volume.
CREATE DATABASE carbon_storage;
