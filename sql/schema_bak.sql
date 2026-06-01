-- sql/schema.sql
-- Root-ID Figma Prototype Backend
--
-- หลักการ:
-- - ทุก table เป็น Root-ID versioned object
-- - ไม่มี _is_active
-- - ไม่มี _doc_version
-- - current/latest = row ที่ _flag = ''
-- - old/history version = _flag = 'u'
-- - deleted = latest delete marker มี _flag = 'd'
-- - restore = copy old version เป็น new current version
--
-- Table หลัก:
-- 1. business
-- 2. data_schema
-- 3. data
-- 4. form
-- 5. tableview
--
-- หมายเหตุ:
-- - _modify_datetime ใช้รูปแบบ YYYYMMDDHHMMSS เป็น BIGINT
--   เช่น 20260514083045
-- - ไม่ใช้ PostgreSQL VIEW latest_*
-- - ไม่ใช้ updated_at trigger
-- - data มี field สำหรับ warehouse transfer:
--   - _transfer_version
--   - _transfer_datetime

CREATE EXTENSION IF NOT EXISTS pgcrypto;



-- =====================================================
-- baseline tables for benchmarking
-- =====================================================

DROP TABLE IF EXISTS bench_wiki_jsonb CASCADE;
DROP TABLE IF EXISTS bench_wiki_revision CASCADE;
DROP TABLE IF EXISTS bench_wiki_page CASCADE;

-- PG Relational baseline
CREATE TABLE IF NOT EXISTS bench_wiki_page (
  id BIGSERIAL PRIMARY KEY,
  page_id BIGINT NOT NULL UNIQUE,
  page_title TEXT,
  category_id TEXT,
  category_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bench_wiki_revision (
  id BIGSERIAL PRIMARY KEY,
  page_id BIGINT NOT NULL,
  revision_id BIGINT NOT NULL,
  revision_timestamp TIMESTAMPTZ NULL,
  revision_user TEXT,
  revision_comment TEXT,
  revision_size BIGINT,
  revision_sha1 TEXT,
  text_hash TEXT,
  text_size BIGINT,
  source_index BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bench_wiki_revision_unique UNIQUE (page_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_page_id
  ON bench_wiki_revision (page_id);

CREATE INDEX IF NOT EXISTS idx_bench_wiki_revision_latest
  ON bench_wiki_revision (page_id, revision_timestamp DESC, revision_id DESC);


-- PG JSONB baseline
CREATE TABLE IF NOT EXISTS bench_wiki_jsonb (
  id BIGSERIAL PRIMARY KEY,
  page_id BIGINT NOT NULL,
  revision_id BIGINT NOT NULL,
  revision_timestamp TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bench_wiki_jsonb_unique UNIQUE (page_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_page_id
  ON bench_wiki_jsonb (page_id);

CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_latest
  ON bench_wiki_jsonb (page_id, revision_timestamp DESC, revision_id DESC);

CREATE INDEX IF NOT EXISTS idx_bench_wiki_jsonb_payload_gin
  ON bench_wiki_jsonb USING GIN (payload);




-- =====================================================
-- business
-- เก็บข้อมูลโครงการ/ธุรกิจ (tenant)
-- =====================================================

CREATE TABLE IF NOT EXISTS business (
  id BIGSERIAL PRIMARY KEY,

  _rootid BIGINT NOT NULL,
  _prev_id BIGINT NULL REFERENCES business(id),
  _flag TEXT NOT NULL DEFAULT '',

  name TEXT NOT NULL,
  icon TEXT NULL,

  _modify_datetime BIGINT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')::BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT business_flag_allowed
    CHECK (_flag IN ('', 'u', 'd'))
);

CREATE INDEX IF NOT EXISTS idx_business_rootid
  ON business (_rootid);

CREATE INDEX IF NOT EXISTS idx_business_current
  ON business (_rootid, id DESC)
  WHERE _flag = '';

CREATE INDEX IF NOT EXISTS idx_business_flag
  ON business (_flag);

CREATE INDEX IF NOT EXISTS idx_business_name
  ON business (name);


-- =====================================================
-- data_schema
-- เก็บ schema/config ของข้อมูล
-- =====================================================

CREATE TABLE IF NOT EXISTS data_schema (
  id BIGSERIAL PRIMARY KEY,

  _rootid BIGINT NOT NULL,
  _prev_id BIGINT NULL REFERENCES data_schema(id),
  _flag TEXT NOT NULL DEFAULT '',

  business_id BIGINT NULL REFERENCES business(id),

  name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  _modify_datetime BIGINT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')::BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT data_schema_flag_allowed
    CHECK (_flag IN ('', 'u', 'd'))
);

CREATE INDEX IF NOT EXISTS idx_data_schema_business_id
  ON data_schema (business_id);

CREATE INDEX IF NOT EXISTS idx_data_schema_rootid
  ON data_schema (_rootid);

CREATE INDEX IF NOT EXISTS idx_data_schema_current
  ON data_schema (_rootid, id DESC)
  WHERE _flag = '';

CREATE INDEX IF NOT EXISTS idx_data_schema_flag
  ON data_schema (_flag);

CREATE INDEX IF NOT EXISTS idx_data_schema_name
  ON data_schema (name);

CREATE INDEX IF NOT EXISTS idx_data_schema_payload_gin
  ON data_schema USING GIN (payload);


-- =====================================================
-- data
-- เก็บข้อมูลจริง
--
-- data_schema_id:
--   FK ไปยัง data_schema.id
--   หมายถึง data row นี้ถูกสร้างจาก schema version ไหน
--
-- _transfer_version:
--   version/batch ของการ transfer ไป warehouse
--   0 = ยังไม่ transfer
--
-- _transfer_datetime:
--   เวลา transfer สำเร็จ รูปแบบ YYYYMMDDHHMMSS
--   NULL = ยังไม่ transfer
-- =====================================================

CREATE TABLE IF NOT EXISTS data (
  id BIGSERIAL PRIMARY KEY,

  _rootid BIGINT NOT NULL,
  _prev_id BIGINT NULL REFERENCES data(id),
  _flag TEXT NOT NULL DEFAULT '',

  user_id BIGINT NULL,
  share_mode TEXT NOT NULL DEFAULT 'self',

  _transfer_version BIGINT NOT NULL DEFAULT 0,
  _transfer_datetime BIGINT NULL,

  data_schema_id BIGINT NOT NULL REFERENCES data_schema(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  _modify_datetime BIGINT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')::BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT data_flag_allowed
    CHECK (_flag IN ('', 'u', 'd')),

  CONSTRAINT data_share_mode_allowed
    CHECK (share_mode IN ('self', 'all', 'users')),

  CONSTRAINT data_transfer_version_non_negative
    CHECK (_transfer_version >= 0)
);

ALTER TABLE IF EXISTS data
  ADD COLUMN IF NOT EXISTS user_id BIGINT NULL;

ALTER TABLE IF EXISTS data
  ADD COLUMN IF NOT EXISTS share_mode TEXT NOT NULL DEFAULT 'self';

ALTER TABLE IF EXISTS data
  DROP CONSTRAINT IF EXISTS data_share_mode_allowed;

ALTER TABLE IF EXISTS data
  ADD CONSTRAINT data_share_mode_allowed
  CHECK (share_mode IN ('self', 'all', 'users'));

CREATE INDEX IF NOT EXISTS idx_data_rootid
  ON data (_rootid);

CREATE INDEX IF NOT EXISTS idx_data_user_id
  ON data (user_id);

CREATE INDEX IF NOT EXISTS idx_data_share_mode
  ON data (share_mode);

CREATE INDEX IF NOT EXISTS idx_data_current
  ON data (_rootid, id DESC)
  WHERE _flag = '';

CREATE INDEX IF NOT EXISTS idx_data_schema_id
  ON data (data_schema_id);

CREATE INDEX IF NOT EXISTS idx_data_flag
  ON data (_flag);

CREATE INDEX IF NOT EXISTS idx_data_transfer_version
  ON data (_transfer_version);

CREATE INDEX IF NOT EXISTS idx_data_transfer_datetime
  ON data (_transfer_datetime);

CREATE INDEX IF NOT EXISTS idx_data_transfer_pending
  ON data (_transfer_version, _transfer_datetime);

CREATE INDEX IF NOT EXISTS idx_data_payload_gin
  ON data USING GIN (payload);


-- =====================================================
-- data_share_user
-- map data_rootid -> user_id สำหรับโหมดแชร์ราย user
-- =====================================================

CREATE TABLE IF NOT EXISTS data_share_user (
  id BIGSERIAL PRIMARY KEY,

  data_rootid BIGINT NOT NULL,
  user_id BIGINT NOT NULL,

  permission TEXT NOT NULL DEFAULT 'read',

  created_by_user_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT data_share_user_permission_allowed
    CHECK (permission IN ('read', 'write')),

  CONSTRAINT data_share_user_unique
    UNIQUE (data_rootid, user_id)
);

CREATE INDEX IF NOT EXISTS idx_data_share_user_data_rootid
  ON data_share_user (data_rootid);

CREATE INDEX IF NOT EXISTS idx_data_share_user_user_id
  ON data_share_user (user_id);

CREATE INDEX IF NOT EXISTS idx_data_share_user_permission
  ON data_share_user (permission);


-- =====================================================
-- upload
-- เก็บ metadata ของไฟล์ที่ upload ผ่าน chunk API
-- =====================================================

CREATE TABLE IF NOT EXISTS upload (
  id BIGSERIAL PRIMARY KEY,

  file_name TEXT NOT NULL,
  file_uuid UUID NOT NULL,
  file_path TEXT NOT NULL,

  user_id BIGINT NOT NULL,
  share_with TEXT NOT NULL DEFAULT 'own',

  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT upload_share_with_allowed
    CHECK (share_with IN ('userids', 'whohavelink', 'own')),

  CONSTRAINT upload_file_uuid_unique
    UNIQUE (file_uuid)
);

CREATE INDEX IF NOT EXISTS idx_upload_user_id
  ON upload (user_id);

CREATE INDEX IF NOT EXISTS idx_upload_file_uuid
  ON upload (file_uuid);

CREATE INDEX IF NOT EXISTS idx_upload_share_with
  ON upload (share_with);


-- =====================================================
-- form
-- เก็บ form config / form layout
--
-- data_schema_id:
--   fixed/edit/replay mode
--   form นี้ออกแบบจาก schema version ไหน
--
-- data_schema_rootid:
--   optional latest-root/migrate mode
--   ใช้ตอนต้องการผูกกับ schema family แล้ว resolve current schema
-- =====================================================

CREATE TABLE IF NOT EXISTS form (
  id BIGSERIAL PRIMARY KEY,

  _rootid BIGINT NOT NULL,
  _prev_id BIGINT NULL REFERENCES form(id),
  _flag TEXT NOT NULL DEFAULT '',

  data_schema_id BIGINT NULL REFERENCES data_schema(id),
  data_schema_rootid BIGINT NULL,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  _modify_datetime BIGINT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')::BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT form_flag_allowed
    CHECK (_flag IN ('', 'u', 'd')),

  CONSTRAINT form_schema_binding_required
    CHECK (
      data_schema_id IS NOT NULL
      OR data_schema_rootid IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_form_rootid
  ON form (_rootid);

CREATE INDEX IF NOT EXISTS idx_form_current
  ON form (_rootid, id DESC)
  WHERE _flag = '';

CREATE INDEX IF NOT EXISTS idx_form_data_schema_id
  ON form (data_schema_id);

CREATE INDEX IF NOT EXISTS idx_form_data_schema_rootid
  ON form (data_schema_rootid);

CREATE INDEX IF NOT EXISTS idx_form_flag
  ON form (_flag);

CREATE INDEX IF NOT EXISTS idx_form_payload_gin
  ON form USING GIN (payload);


-- =====================================================
-- tableview
-- เก็บ table view config / display config
--
-- data_schema_id:
--   fixed/edit/replay mode
--   tableview นี้ออกแบบจาก schema version ไหน
--
-- data_schema_rootid:
--   latest-root table view
--   ใช้แสดง data หลาย schema version โดยยึด schema current/latest
-- =====================================================

CREATE TABLE IF NOT EXISTS tableview (
  id BIGSERIAL PRIMARY KEY,

  _rootid BIGINT NOT NULL,
  _prev_id BIGINT NULL REFERENCES tableview(id),
  _flag TEXT NOT NULL DEFAULT '',

  data_schema_id BIGINT NULL REFERENCES data_schema(id),
  data_schema_rootid BIGINT NULL,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  _modify_datetime BIGINT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYYMMDDHH24MISS')::BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tableview_flag_allowed
    CHECK (_flag IN ('', 'u', 'd')),

  CONSTRAINT tableview_schema_binding_required
    CHECK (
      data_schema_id IS NOT NULL
      OR data_schema_rootid IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_tableview_rootid
  ON tableview (_rootid);

CREATE INDEX IF NOT EXISTS idx_tableview_current
  ON tableview (_rootid, id DESC)
  WHERE _flag = '';

CREATE INDEX IF NOT EXISTS idx_tableview_data_schema_id
  ON tableview (data_schema_id);

CREATE INDEX IF NOT EXISTS idx_tableview_data_schema_rootid
  ON tableview (data_schema_rootid);

CREATE INDEX IF NOT EXISTS idx_tableview_flag
  ON tableview (_flag);

CREATE INDEX IF NOT EXISTS idx_tableview_payload_gin
  ON tableview USING GIN (payload);