# Desktop SQLite migrations

Migrations are forward-only and ordered by the numeric filename prefix. Each applied version records its SHA-256 checksum and timestamp in `schema_migrations`.

The runner creates an online backup before applying pending migrations to an existing database. A failed migration is rolled back and prevents the application from using the new schema.

Current migration version: **1**.
