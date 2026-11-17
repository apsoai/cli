-- A small hand-built schema with the shapes `apso import` has to carry over
-- (apsoai/cli#242). Synthetic: no customer names or data.
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  mrn text,
  living_will boolean,
  correlation_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patients_created_at_idx ON patients (created_at);
CREATE UNIQUE INDEX patients_mrn_uq ON patients (organization_id, lower(btrim(mrn))) WHERE mrn IS NOT NULL;
CREATE TABLE tenants (
  id varchar(100) PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE tenant_notes (
  code text PRIMARY KEY,
  tenant_id varchar(100) NOT NULL REFERENCES tenants(id),
  body text
);
CREATE TABLE tenant_settings (
  tenant_id varchar(100) PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  theme text
);
CREATE TABLE facilities (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  facility_id integer REFERENCES facilities(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  minutes integer NOT NULL DEFAULT 0,
  performance_year integer NOT NULL,
  start_date date NOT NULL,
  end_date date,
  expires_at timestamptz,
  g_codes text[],
  source_note_ids uuid[],
  minutes_doubled integer GENERATED ALWAYS AS (minutes * 2) STORED,
  tags jsonb NOT NULL DEFAULT '[]',
  retention_until timestamptz NOT NULL DEFAULT now() + interval '6 years',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_patient_year_uq UNIQUE (patient_id, performance_year),
  CONSTRAINT enrollments_minutes_positive CHECK (minutes >= 0),
  CONSTRAINT enrollments_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX enrollments_one_live_per_patient_uq ON enrollments (organization_id, patient_id) WHERE status <> 'revoked';
CREATE INDEX enrollments_expires_at_idx ON enrollments (expires_at);
-- Not every table carries a time zone: this one must stay plain timestamp,
-- and facilities has one column of each type.
CREATE TABLE legacy_events (
  id serial PRIMARY KEY,
  label text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
