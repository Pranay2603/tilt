/**
 * Plain SQL migrations, applied in order and recorded in schema_migrations.
 * They live in code so the bundled server has no files to locate at runtime.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_init",
    sql: /* sql */ `
      CREATE TABLE experiments (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key         text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
        name        text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      -- impressions and conversions are the whole posterior:
      --   alpha = 1 + conversions, beta = 1 + (impressions - conversions)
      -- The CHECK makes an impossible state unrepresentable, even under bugs.
      CREATE TABLE variants (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        experiment_id  uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        key            text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
        name           text NOT NULL,
        position       integer NOT NULL CHECK (position >= 0),
        impressions    bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
        conversions    bigint NOT NULL DEFAULT 0,
        UNIQUE (experiment_id, key),
        UNIQUE (experiment_id, position),
        CHECK (conversions >= 0 AND conversions <= impressions)
      );

      -- One row per visitor per experiment: assignments are sticky.
      CREATE TABLE assignments (
        id             bigserial PRIMARY KEY,
        experiment_id  uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        variant_id     uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        user_key       text NOT NULL CHECK (length(user_key) BETWEEN 1 AND 128),
        created_at     timestamptz NOT NULL DEFAULT now(),
        converted_at   timestamptz,
        UNIQUE (experiment_id, user_key)
      );
      CREATE INDEX assignments_variant_idx ON assignments (variant_id);
    `,
  },
];
