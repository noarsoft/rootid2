-- sql/drop-all.sql
-- Drop all Root-ID prototype database objects
--
-- ใช้ตอนต้องการ reset database schema ใหม่ทั้งหมด
-- ระวัง: ข้อมูลทั้งหมดใน table จะหาย

DROP VIEW IF EXISTS latest_tableview CASCADE;
DROP VIEW IF EXISTS latest_form CASCADE;
DROP VIEW IF EXISTS latest_data CASCADE;
DROP VIEW IF EXISTS latest_data_schema CASCADE;

DROP TABLE IF EXISTS tableview CASCADE;
DROP TABLE IF EXISTS form CASCADE;
DROP TABLE IF EXISTS data CASCADE;
DROP TABLE IF EXISTS data_schema CASCADE;
DROP TABLE IF EXISTS business CASCADE;

DROP FUNCTION IF EXISTS set_updated_at() CASCADE;