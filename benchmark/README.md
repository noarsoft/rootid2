# RootID Wiki Benchmark

Benchmark นี้ใช้สำหรับวัดและเปรียบเทียบประสิทธิภาพของ 4 storage/versioning models โดยใช้ข้อมูล Wikipedia revision data

```txt
1. PG Relational
2. PG JSONB
3. MongoDB
4. RootID


benchmark/data/json/**/*.json
        ↓
normalize-wiki-data.js
        ↓
benchmark/data/wiki-normalized.json
        ↓
benchmark 4 model
        ↓
PG Relational / PG JSONB / MongoDB / RootID


npm run drop
npm run migrate

bench:wiki:normalize
npm run bench:wiki:inspect

npm run bench:wiki:pg-relational
npm run bench:wiki:pg-jsonb
npm run bench:wiki:mongo
npm run bench:wiki:rootid
npm run bench:wiki:report






# Performance Evaluation Guide

เอกสารนี้อธิบายวิธีรัน Performance Evaluation สำหรับระบบ RootID โดยใช้ชุดข้อมูล Wikipedia revision data และเปรียบเทียบกับ baseline storage models อื่น ๆ

---

## 1. Evaluation Models

การทดลองนี้เปรียบเทียบทั้งหมด 4 models:

```txt
1. PostgreSQL Relational Baseline
2. PostgreSQL JSONB Baseline
3. MongoDB Document Baseline
4. RootID Versioned Data Model
```

แต่ละ model ใช้ dataset ชุดเดียวกันจาก Wikipedia revision data เพื่อให้ผลเปรียบเทียบอยู่บน input เดียวกัน

---

## 2. Evaluation Objectives

Performance evaluation ใช้วัดประสิทธิภาพของระบบในมิติต่อไปนี้:

```txt
1. Data import / write performance
2. Latest-version query performance
3. Version history query performance
4. Schema evolution comparison performance
5. Schema migration performance
6. Storage overhead
```

สำหรับ RootID จะวัดเพิ่มเติมในส่วน schema evolution เพราะ RootID ผูกข้อมูลกับ schema version และสามารถ compare/migrate ไปยัง latest schema ได้

---

## 3. Prepare Database

ก่อนรัน benchmark ควร reset database schema ก่อน โดยเฉพาะเมื่อมีการแก้ไข schema หรือ benchmark table

```bash
npm run reset-db
```

คำสั่งนี้จะทำงานตามลำดับ:

```txt
npm run drop
npm run migrate
```

ผลลัพธ์ที่ได้คือ database จะถูกสร้างใหม่ พร้อมตารางหลักของ RootID และตาราง baseline benchmark

---

## 4. Prepare Wikipedia Dataset

### 4.1 Normalize full dataset

ใช้คำสั่งนี้เพื่อ normalize ข้อมูล Wikipedia จาก folder JSON ดิบ:

```bash
npm run bench:wiki:normalize
```

input/output หลัก:

```txt
Input:  benchmark/data/json
Output: benchmark/data/wiki-normalized.json
```

---

### 4.2 Normalize small dataset

ใช้สำหรับทดสอบแบบเร็ว ก่อนรันชุดเต็ม:

```bash
npm run bench:wiki:normalize:small
```

input/output หลัก:

```txt
Input:  benchmark/data/json
Output: benchmark/data/wiki-normalized-small.json
```

โดย small dataset จำกัดจำนวน page และ revision เพื่อลดเวลาในการรัน

---

### 4.3 Inspect dataset

ตรวจสอบ summary ของ dataset เต็ม:

```bash
npm run bench:wiki:inspect
```

ตรวจสอบ summary ของ small dataset:

```bash
npm run bench:wiki:inspect:small
```

---

## 5. Run RootID Benchmark Only

ใช้คำสั่งนี้เพื่อรันเฉพาะ RootID model:

```bash
npm run bench:wiki:rootid
```

หรือใช้ alias:

```bash
npm run bench:wiki
```

RootID benchmark จะวัดขั้นตอนหลักดังนี้:

```txt
1. load_wiki_rows
2. create_business
3. create_schema_v1
4. import_wiki_pages_as_rootid
5. sample_latest_reads
6. sample_history_reads
7. update_schema_to_v2
8. sample_compare_with_latest_schema
9. sample_migrate_to_latest_schema
10. getRootIdDbStats
```

---

## 6. Run Baseline Benchmarks

รัน PostgreSQL Relational baseline:

```bash
npm run bench:wiki:pg-relational
```

รัน PostgreSQL JSONB baseline:

```bash
npm run bench:wiki:pg-jsonb
```

รัน MongoDB Document baseline:

```bash
npm run bench:wiki:mongo
```

รัน RootID model:

```bash
npm run bench:wiki:rootid
```

---

## 7. Run All Benchmarks

รันครบทั้ง 4 models:

```bash
npm run bench:wiki:all
```

คำสั่งนี้จะรันตามลำดับ:

```txt
1. PostgreSQL Relational
2. PostgreSQL JSONB
3. MongoDB
4. RootID
```

หลังจากนั้นให้สร้าง comparison report:

```bash
npm run bench:wiki:report
```

หรือรันแบบต่อกัน:

```bash
npm run bench:wiki:all
npm run bench:wiki:report
```

---

## 8. Recommended Small Test Run

แนะนำให้รัน small dataset ก่อน เพื่อเช็คว่า pipeline ใช้งานได้ครบ

### PowerShell

```powershell
npm run reset-db
npm run bench:wiki:normalize:small

$env:WIKI_NORMALIZED_PATH="benchmark/data/wiki-normalized-small.json"
$env:BENCH_SAMPLE_READS=50
$env:BENCH_HISTORY_LIMIT=100
$env:BENCH_COMPARE_SAMPLE=30
$env:BENCH_MIGRATE_SAMPLE=30

npm run bench:wiki:rootid
```

ถ้าผ่านแล้วสามารถรัน baseline ตัวอื่นต่อได้:

```powershell
npm run bench:wiki:pg-relational
npm run bench:wiki:pg-jsonb
npm run bench:wiki:mongo
npm run bench:wiki:rootid
npm run bench:wiki:report
```

---

## 9. Recommended Full Paper Run

สำหรับเก็บผลการทดลองเพื่อใช้ใน paper หรือ report แนะนำใช้ run id ชัดเจน

### PowerShell

```powershell
npm run reset-db
npm run bench:wiki:normalize

$env:BENCH_RUN_ID="paper-run-001"
$env:BENCH_SAMPLE_READS=200
$env:BENCH_HISTORY_LIMIT=1000
$env:BENCH_COMPARE_SAMPLE=100
$env:BENCH_MIGRATE_SAMPLE=100
$env:BENCH_INCLUDE_TEXT="false"

npm run bench:wiki:pg-relational
npm run bench:wiki:pg-jsonb
npm run bench:wiki:mongo
npm run bench:wiki:rootid
npm run bench:wiki:report
```

---

## 10. Environment Variables

Benchmark scripts รองรับ environment variables หลักดังนี้:

```txt
BENCH_RUN_ID
WIKI_NORMALIZED_PATH
WIKI_JSON_PATH
BENCH_MAX_PAGES
BENCH_MAX_REVISIONS_PER_PAGE
BENCH_SAMPLE_READS
BENCH_HISTORY_LIMIT
BENCH_COMPARE_SAMPLE
BENCH_MIGRATE_SAMPLE
BENCH_PROGRESS_EVERY
BENCH_INCLUDE_TEXT
BENCH_CLEAR_RUN_BEFORE
BENCH_CLEAR_RUN_AFTER
```

ตัวอย่างการจำกัดจำนวนข้อมูล:

```powershell
$env:BENCH_MAX_PAGES=100
$env:BENCH_MAX_REVISIONS_PER_PAGE=5
```

ตัวอย่างการกำหนด dataset path:

```powershell
$env:WIKI_NORMALIZED_PATH="benchmark/data/wiki-normalized-small.json"
```

ตัวอย่างการกำหนด run id:

```powershell
$env:BENCH_RUN_ID="paper-run-001"
```

---

## 11. Output Files

ผลลัพธ์ benchmark จะถูกบันทึกไว้ใน folder:

```txt
benchmark/results/
```

ไฟล์ที่ได้โดยทั่วไป:

```txt
*-result-<runId>.json
*-summary-<runId>.csv
*-metrics-<runId>.csv
*-imported-<runId>.csv
```

ตัวอย่าง:

```txt
wiki-rootid-result-paper-run-001.json
wiki-rootid-summary-paper-run-001.csv
wiki-rootid-metrics-paper-run-001.csv
wiki-rootid-imported-paper-run-001.csv
```

---

## 12. Important Metrics

Metrics หลักที่ควรใช้ในรายงานผล:

```txt
Import time
Revisions per second
Pages per second
Latest read average time
History read average time
Compare with latest schema average time
Migration average time
Physical rows
Current rows
History rows
Deleted rows
Database size
Table size
```

---

## 13. RootID Metrics

สำหรับ RootID model ควรดู metrics เหล่านี้เป็นพิเศษ:

```txt
import_wiki_pages_as_rootid
sample_latest_reads
sample_history_reads
update_schema_to_v2
sample_compare_with_latest_schema
sample_migrate_to_latest_schema
rootid_db_stats
```

คำอธิบาย:

| Metric                              | Description                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| `import_wiki_pages_as_rootid`       | เวลาในการนำเข้า Wikipedia revision เป็น RootID version chain |
| `sample_latest_reads`               | เวลาเฉลี่ยในการอ่าน current/latest version                   |
| `sample_history_reads`              | เวลาเฉลี่ยในการอ่าน version history                          |
| `update_schema_to_v2`               | เวลาในการสร้าง schema version ใหม่                           |
| `sample_compare_with_latest_schema` | เวลาในการเปรียบเทียบ data row กับ latest schema              |
| `sample_migrate_to_latest_schema`   | เวลาในการ migrate data row ไปยัง latest schema               |
| `rootid_db_stats`                   | จำนวน rows และ storage overhead ของ RootID                   |

---

## 14. Baseline Metrics

สำหรับ baseline models ควรดู metrics เหล่านี้:

```txt
load_wiki_rows
import_wiki_pages
sample_latest_reads
sample_history_reads
database_stats
```

คำอธิบาย:

| Metric                 | Description                               |
| ---------------------- | ----------------------------------------- |
| `import_wiki_pages`    | เวลาในการนำเข้า Wikipedia pages/revisions |
| `sample_latest_reads`  | เวลาเฉลี่ยในการอ่าน revision ล่าสุด       |
| `sample_history_reads` | เวลาเฉลี่ยในการอ่าน revision history      |
| `database_stats`       | ขนาดตารางและสถิติของ database             |

---

## 15. Suggested Evaluation Table

ตารางสำหรับสรุป performance comparison:

| Model         | Import Time (ms) | Revisions/sec | Latest Read Avg (ms) | History Read Avg (ms) | DB Size |
| ------------- | ---------------: | ------------: | -------------------: | --------------------: | ------: |
| PG Relational |                  |               |                      |                       |         |
| PG JSONB      |                  |               |                      |                       |         |
| MongoDB       |                  |               |                      |                       |         |
| RootID        |                  |               |                      |                       |         |

---

## 16. Suggested RootID-Specific Table

ตารางสำหรับสรุปความสามารถเฉพาะของ RootID:

| Metric                    | Value |
| ------------------------- | ----: |
| Schema compare avg time   |       |
| Schema migration avg time |       |
| Current rows              |       |
| History rows              |       |
| Deleted rows              |       |
| Physical rows             |       |
| Logical rootids           |       |

---

## 17. Interpretation Guide

แนวทางการอ่านผล:

```txt
1. ถ้า RootID import ช้ากว่า baseline เป็นเรื่องปกติ
   เพราะ RootID เก็บ version chain และ metadata เพิ่ม

2. ถ้า latest read ใกล้เคียง baseline ถือว่าดี
   เพราะ current row ใช้ _flag = '' และ index ช่วยค้นหา

3. ถ้า history read ทำงานได้ดี แสดงว่า _rootid + _prev_id model ใช้งานได้จริง

4. ถ้า storage ใช้มากกว่า baseline เป็น expected overhead
   เพราะ RootID ไม่ overwrite แต่ append version ใหม่

5. ค่า schema compare/migrate เป็น feature cost
   ซึ่ง baseline ปกติไม่มีโดยตรง
```

---

## 18. Paper Writing Summary

ข้อความตัวอย่างสำหรับเขียนใน paper:

```txt
The performance evaluation compares the proposed RootID model with three baseline storage models: PostgreSQL relational tables, PostgreSQL JSONB, and MongoDB document storage. The benchmark uses Wikipedia revision data as a versioned dataset, where each page represents a logical object and each revision represents a historical version.

The evaluation measures import time, latest-version retrieval time, history retrieval time, schema comparison time, schema migration time, and storage overhead. For the RootID model, additional metrics are collected to evaluate the cost of maintaining version lineage through _rootid and _prev_id, as well as the cost of schema evolution support.
```

---

## 19. Full Command Summary

```bash
npm run reset-db
npm run bench:wiki:normalize
npm run bench:wiki:inspect
npm run bench:wiki:all
npm run bench:wiki:report
```

สำหรับทดสอบเร็ว:

```bash
npm run reset-db
npm run bench:wiki:normalize:small
```

PowerShell:

```powershell
$env:WIKI_NORMALIZED_PATH="benchmark/data/wiki-normalized-small.json"
npm run bench:wiki:rootid
```
