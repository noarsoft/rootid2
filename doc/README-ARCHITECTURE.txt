# README ARCHITECTURE
Root-ID Figma Prototype Backend

====================================================
1. OVERVIEW
====================================================

Root-ID Figma Prototype Backend คือ backend สำหรับระบบฟอร์มและตารางข้อมูลแบบยืดหยุ่น
ที่รองรับ versioning, history, restore, soft delete และ schema evolution

แนวคิดหลัก:
- ทุก object มี root id กลาง
- ทุกการแก้ไขสร้าง version ใหม่
- ไม่ใช้ _doc_version
- ไม่ใช้ _is_active
- ใช้ _flag เพื่อบอกสถานะ version
- current/latest คือ _flag = ''
- history คือ _flag = 'u'
- deleted marker คือ _flag = 'd'
- data ผูกกับ schema version ที่ใช้สร้างข้อมูลจริง
- form/tableview ผูกได้ทั้ง schema version และ schema family


====================================================
2. TABLES
====================================================

Main tables:
  business
  data_schema
  data
  form
  tableview

ไม่มี PostgreSQL VIEW latest_*
ไม่มี updated_at trigger


====================================================
3. VERSIONING MODEL
====================================================

ทุก table มี field กลาง:

  id
  _rootid
  _prev_id
  _flag
  _modify_datetime
  created_at
  updated_at

_flag:
  ''  = current/latest
  'u' = updated/history version
  'd' = deleted marker

Create:
  - reserve next id
  - insert row
  - id = _rootid
  - _prev_id = null
  - _flag = ''

Update:
  - get current row by _rootid + _flag=''
  - insert new row
  - _rootid เดิม
  - _prev_id = current.id
  - _flag = ''
  - mark current เดิมเป็น _flag='u'

Delete:
  - get current row by _rootid + _flag=''
  - insert delete marker
  - _rootid เดิม
  - _prev_id = current.id
  - _flag = 'd'
  - mark current เดิมเป็น _flag='u'

Restore:
  - get source version by id
  - source ต้องไม่ใช่ _flag='d'
  - insert new current row
  - _rootid เดิมของ source
  - _prev_id = last version id
  - _flag = ''
  - mark current เดิมเป็น _flag='u' ถ้ามี


====================================================
4. LATEST RULE
====================================================

Current/latest:
  row ที่ _flag = ''

Deleted object:
  ถ้าไม่มี row _flag=''
  และ last version ของ _rootid เป็น _flag='d'
  แปลว่า object ถูก delete แล้ว

Get latest normal:
  ใช้ _rootid + _flag=''

Get latest include deleted:
  ใช้ last inserted version ของ _rootid
  อาจได้ _flag='d'


====================================================
5. DATA SCHEMA DESIGN
====================================================

data_schema เก็บ schema/config ของข้อมูล

payload example:
  {
    "fname": {
      "type": "string",
      "label": "First name",
      "required": true
    },
    "age": {
      "type": "integer",
      "label": "Age"
    }
  }

data_schema เองก็เป็น versioned object

Schema family:
  data_schema._rootid เดียวกันคือ schema family เดียวกัน

Latest schema:
  data_schema._rootid = rootid
  data_schema._flag = ''


====================================================
6. DATA DESIGN
====================================================

data เก็บข้อมูลจริง

data_schema_id:
  FK ไป data_schema.id
  หมายถึง data row นี้ถูกสร้างจาก schema version ไหน

payload:
  JSONB เก็บค่าของข้อมูลจริง

สำคัญ:
  data ไม่มี data_schema_rootid
  เพราะ data ต้องรู้ว่าตัวเองเกิดจาก schema version ไหนเสมอ

เวลา schema เปลี่ยน:
  data เก่าไม่จำเป็นต้องถูกแก้ทันที
  data เก่ายังผูกกับ schema version เดิม
  เมื่อแสดงผลหรือ edit ค่อย compare กับ latest schema

Warehouse fields:
  _transfer_version
  _transfer_datetime

ยังไม่ใช้ใน core versioning
เตรียมไว้สำหรับส่งข้อมูลไป warehouse ภายหลัง


====================================================
7. FORM DESIGN
====================================================

form เก็บ layout/config สำหรับ input form

form ผูก schema ได้ 2 แบบ:

1. fixed/edit/replay mode
   data_schema_id = schema version id

   ใช้เมื่อ form นี้ถูกออกแบบจาก schema version เฉพาะ
   เหมาะกับ replay/edit historical context

2. root/latest mode
   data_schema_rootid = schema root id

   ใช้เมื่อ form ควรตาม schema family
   สามารถ resolve latest schema ได้

payload example:
  {
    "controls": [
      {
        "databind": "fname",
        "label": "First name",
        "control": "textbox"
      }
    ]
  }

Latest form by schema root:
  ใช้สำหรับหน้า edit data
  frontend จะเอา latest form มา match กับ data payload


====================================================
8. TABLEVIEW DESIGN
====================================================

tableview เก็บ layout/config สำหรับแสดง table/list/grid

tableview ผูก schema ได้ 2 แบบ:

1. fixed/edit/replay mode
   data_schema_id = schema version id

2. latest-root table view
   data_schema_rootid = schema root id

หลักสำคัญของ tableview:
  เวลาแสดงตารางควรผูกกับ schema root id + _flag=''
  เพราะหัว column ของ tableview ควรอิง schema ล่าสุด

payload example:
  {
    "columns": [
      {
        "databind": "fname",
        "header": "First name",
        "control": "label",
        "width": 160
      }
    ]
  }


====================================================
9. TABLE DISPLAY FLOW
====================================================

Use case:
  แสดง table โดยใช้ schema ล่าสุดเป็นหัว column

Endpoint:
  GET /api/view/:id/render-latest-root

Flow:
  1. backend get tableview by id
  2. resolve schemaRootId จาก:
       view.data_schema_rootid
       หรือ fallback จาก view.data_schema_id -> schema._rootid
  3. get latest schema:
       data_schema._rootid = schemaRootId
       data_schema._flag = ''
  4. get data rows in schema family:
       data.data_schema_id -> data_schema.id
       data_schema._rootid = schemaRootId
  5. resolve columns:
       ถ้า view.payload.columns มี ใช้อันนั้น
       ถ้าไม่มี สร้าง columns จาก latest schema payload
  6. compare data row กับ latest schema
  7. return:
       mode
       view
       latestSchema
       columns
       rows

Row result:
  row
  isLatestSchema
  oldSchema
  latestSchema
  cells
  removed
  compare

Frontend:
  - render columns จาก latest schema/tableview
  - field ที่ match และ type เดียวกัน แสดงค่าปกติ
  - field ที่ missing/type_changed/removed แสดง updated/warning


====================================================
10. EDIT DATA FLOW
====================================================

Use case:
  กด edit data version เดิม

Endpoint:
  GET /api/data/:id/edit-context

Flow:
  1. frontend ส่ง data version id
  2. backend get data by id ไม่สน _flag
  3. data.data_schema_id -> oldSchema
  4. oldSchema._rootid -> latestSchema
  5. oldSchema._rootid -> latestForm
  6. compare data.payload กับ latestSchema.payload
  7. return edit context

Response:
  {
    "mode": "edit_data_version_with_latest_form",
    "data": {},
    "oldSchema": {},
    "latestSchema": {},
    "latestForm": {},
    "isLatestSchema": false,
    "cells": {},
    "removed": {},
    "compare": {}
  }

Frontend:
  - ใช้ latestForm เป็น form layout ล่าสุด
  - เอา data.payload ไป match field ที่ตรงกัน
  - ถ้า field ยังอยู่และ type เดิม ใช้ค่าเดิม
  - ถ้า field ใหม่ ไม่มีค่า ให้ blank/default
  - ถ้า field ถูกลบหรือ type เปลี่ยน ให้แสดง updated/warning
  - บันทึกกลับเป็น data version ใหม่


====================================================
11. SAVE / MIGRATE DATA
====================================================

Update data:
  PATCH /api/data/root/:rootid

ใช้เมื่อ:
  frontend ส่ง payload ที่ต้องการบันทึก
  backend merge payload กับ latest data payload
  validate กับ schema ที่ระบุหรือ schema เดิม
  insert version ใหม่

Save data as latest schema version:
  POST /api/data/root/:rootid/save-latest-schema-version

ใช้เมื่อ:
  ต้องการย้าย data ไปใช้ latest schema version
  backend map payload จาก old schema ไป latest schema
  ถ้ามี type_changed ต้อง force=true

Migrate data to latest schema:
  POST /api/data/root/:rootid/migrate-latest-schema

ใช้เมื่อ:
  ต้องการ migrate latest data row ไป schema ล่าสุด


====================================================
12. FORM / VIEW MIGRATION
====================================================

Form migration:
  POST /api/form/root/:rootid/migrate-latest-schema

View migration:
  POST /api/view/root/:rootid/migrate-latest-schema

แนวคิด:
  - form/view ที่ผูก data_schema_id สามารถ migrate ไป latest schema ได้
  - backend compare old schema กับ latest schema
  - field เดิมที่ยังอยู่และ type เดิม = ok
  - field ถูกลบ = disabled/requiresReview
  - field type เปลี่ยน = requiresReview
  - field ใหม่ = append control/column ใหม่
  - ถ้ามี warning สำคัญต้อง force=true


====================================================
13. SCHEMA FAMILY LISTING
====================================================

Repository method:
  listLatestInSchemaFamily(schemaRootId, options)

ใช้กับ:
  data
  form
  tableview

สำหรับ data:
  data ไม่มี data_schema_rootid
  จึง match ด้วย:
    data.data_schema_id -> data_schema.id
    data_schema._rootid = schemaRootId

สำหรับ form/tableview:
  match ได้ 2 แบบ:
    object.data_schema_id -> data_schema.id
    data_schema._rootid = schemaRootId

    OR

    object.data_schema_rootid = schemaRootId

ทำให้:
  - form ที่ผูก schema version เดิมยังถูก list ใน schema family
  - form ที่ผูก schema root โดยตรงก็ถูก list
  - tableview ก็เช่นกัน


====================================================
14. SERVICE LAYERS
====================================================

core/rootid-engine.js:
  - จัดการ root-id versioning หลัก
  - createRoot
  - createNextVersion
  - softDeleteByRootId
  - restoreVersion
  - getLatestByRootId
  - getHistory

repositories/base-versioned.repository.js:
  - base CRUD สำหรับ versioned table
  - listLatest
  - listLatestBySchemaId
  - listLatestBySchemaRootId
  - listLatestInSchemaFamily
  - guard table/field ซ้ำเพื่อความปลอดภัย

services/schema.service.js:
  - create/update schema
  - validate payload
  - compare schema
  - compare data row with latest schema
  - map payload to latest schema

services/data.service.js:
  - create/update data
  - edit context
  - compare/migrate data
  - save as latest schema version

services/form.service.js:
  - create/update form
  - editor context
  - latest form by schema root
  - migrate form to latest schema

services/view.service.js:
  - create/update tableview
  - editor context
  - render fixed schema view
  - render latest root schema view
  - migrate view to latest schema


====================================================
15. CONTROLLERS
====================================================

Controllers แปลง HTTP request เป็น service call

Controller ใช้:
  getListOptions()
  getHistoryOptions()
  getPaginationOptions()
  normalizeBool()

จาก:
  src/utils/query-options.js

แนวคิด:
  controller normalize options ก่อนส่ง service/repository
  repository/engine guard ซ้ำอีกชั้นเพื่อความปลอดภัย


====================================================
16. ROUTES
====================================================

Route groups:
  /api/business
  /api/schema
  /api/data
  /api/form
  /api/view

Route order:
  routes ที่ specific ต้องมาก่อน /:id

ตัวอย่าง:
  /api/data/:id/edit-context
  ต้องอยู่ก่อน
  /api/data/:id

  /api/form/schema-root/:schemaRootId/latest
  ต้องอยู่ก่อน
  /api/form/schema-root/:schemaRootId


====================================================
17. ERROR HANDLING
====================================================

Central error handler:
  src/middlewares/error-handler.js

Error response:
  {
    "ok": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "Error message"
    }
  }

Common status:
  400 bad request
  403 forbidden
  404 not found
  409 conflict
  422 unprocessable entity
  500 internal error


====================================================
18. DESIGN DECISIONS
====================================================

ไม่ใช้ _doc_version:
  latest version รู้ได้จาก _rootid + _flag = ''

ไม่ใช้ _is_active:
  current/latest ใช้ _flag = ''

ไม่ใช้ latest_* PostgreSQL view:
  latest logic อยู่ใน repository/engine

ไม่ใช้ updated_at trigger:
  updated_at ใช้ default NOW()
  ตอน mark current เป็น updated มี set updated_at = NOW()

data ต้องผูก data_schema_id:
  เพื่อรู้ว่า data row เกิดจาก schema version ไหน

form/tableview ผูกได้ทั้ง id/rootid:
  เพราะบาง use case ต้อง fixed schema
  บาง use case ต้องตาม latest schema family

tableview display ใช้ latest schema:
  เพราะหัว column ต้องเป็น schema ล่าสุด

edit data ใช้ data version เดิม + latest form:
  เพื่อให้ user แก้ข้อมูลเก่าผ่าน form ปัจจุบันได้
  และ frontend แสดง updated/warning เมื่อ field ไม่ตรง


====================================================
19. CURRENT BACKEND STATUS
====================================================

พร้อมแล้ว:
  - Root-ID versioning
  - create/update/delete/restore/history
  - schema validation
  - schema compare
  - data compare with latest schema
  - data edit context
  - latest form by schema root
  - tableview latest-root render
  - schema family listing for data/form/tableview
  - transfer fields in data

ควรทำต่อภายหลัง:
  - เพิ่ม automated tests
  - เพิ่ม pagination meta ใน response
  - เพิ่ม auth/tenant guard
  - เพิ่ม field-level permission
  - เพิ่ม warehouse transfer service
  - เพิ่ม frontend integration
  - เพิ่ม seed/demo data
  - เพิ่ม API examples แบบ curl หรือ Postman collection