-- sql/drop-all.sql
-- Drop all Root-ID prototype database objects
--
-- ใช้ตอนต้องการ reset database schema ใหม่ทั้งหมด
-- ระวัง: ข้อมูลทั้งหมดใน table จะหาย

-- =====================================================
-- old views / compatibility views
-- =====================================================

DROP VIEW IF EXISTS latest_tableview CASCADE;
DROP VIEW IF EXISTS latest_form CASCADE;
DROP VIEW IF EXISTS latest_data CASCADE;
DROP VIEW IF EXISTS latest_data_schema CASCADE;


-- =====================================================
-- benchmark baseline tables
-- =====================================================
-- ต้อง drop ก่อน table หลัก เพื่อ reset benchmark schema ให้สะอาด
-- ตอนนี้ benchmark มี 4 model:
-- 1. PG Relational
-- 2. PG JSONB
-- 3. MongoDB
-- 4. RootID
--
-- MongoDB ไม่เกี่ยวกับ PostgreSQL drop-all.sql
-- ส่วน PostgreSQL baseline ใช้ bench_wiki_* tables

DROP TABLE IF EXISTS bench_wiki_jsonb CASCADE;
DROP TABLE IF EXISTS bench_wiki_revision CASCADE;
DROP TABLE IF EXISTS bench_wiki_page CASCADE;


-- =====================================================
-- Root-ID application tables
-- =====================================================

DROP TABLE IF EXISTS tableview CASCADE;
DROP TABLE IF EXISTS form CASCADE;
DROP TABLE IF EXISTS upload CASCADE;

DROP TABLE IF EXISTS data_share_user CASCADE;
DROP TABLE IF EXISTS data CASCADE;
DROP TABLE IF EXISTS data_schema CASCADE;
DROP TABLE IF EXISTS business CASCADE;


-- =====================================================
-- functions / triggers
-- =====================================================

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;