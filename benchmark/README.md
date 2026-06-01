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


bench:wiki:normalize
npm run bench:wiki:inspect

npm run bench:wiki:pg-relational
npm run bench:wiki:pg-jsonb
npm run bench:wiki:mongo
npm run bench:wiki:rootid
npm run bench:wiki:report