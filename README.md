# rootidx — Backend API

Express 4 + PostgreSQL backend สำหรับระบบ Dynamic Form Builder ใช้สถาปัตยกรรม Root-ID Versioning (append-only)

## Features

- **Root-ID Versioning** — ทุก mutation เป็น INSERT (ไม่มี UPDATE/DELETE บน business data)
- **4 Main Tables** — `data_schema`, `data`, `form`, `tableview`
- **Soft Delete** — `_flag = 'd'` สำหรับลบ, `_flag = 'u'` สำหรับ migrate
- **Schema Migration** — อัพเดตข้อมูลเก่าเมื่อโครงสร้างฟอร์มเปลี่ยน
- **Raw SQL** — ไม่ใช้ ORM, ใช้ CTE-based latest-version queries
- **Business Isolation** — ทุก query กรองด้วย `business_id`

## Tech Stack

| Technology | Version |
|------------|---------|
| Node.js | CommonJS |
| Express | 4 |
| PostgreSQL | pg driver |
| UUID | v4 |
| sanitize-html | input sanitization |

## Quick Start

```bash
# ต้องมี PostgreSQL running + .env configured
npm install
npm run dev          # migrate + start on port 3000
```

### Commands

```bash
npm run dev            # migrate + dev server (nodemon)
npm run dev:no-migrate # dev server only
npm run migrate        # run SQL migration
npm run drop           # drop all tables
npm run reset-db       # drop + migrate
npm start              # migrate + production start
npm test               # run tests
```

### Environment Variables (.env)

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rootidx
DB_USER=postgres
DB_PASSWORD=yourpassword
PORT=3000
 CORS_ORIGIN=http://localhost:3002,https://app.aicamt.com,https://auth.aicamt.com
AUTH_BASE_URL=http://localhost:3001
AUTH_ME_URL=http://localhost:3001/api/auth/me
AUTH_LOGIN_URL=http://localhost:3001/html/login.html
AUTH_REDIRECT_PARAM=redirect
AUTH_REQUEST_TIMEOUT_MS=5000
TRUST_PROXY=1
```

## API Routes

Base URL: `http://localhost:3000/api`

### Health Check

```
GET /api/health
```

### Common CRUD Pattern (all 4 resources)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/{resource}` | List all |
| `POST` | `/api/{resource}` | Create |
| `GET` | `/api/{resource}/root/:rootid/latest` | Get latest version |
| `GET` | `/api/{resource}/root/:rootid/history` | Version history |
| `PATCH` | `/api/{resource}/root/:rootid` | Update (new version) |
| `DELETE` | `/api/{resource}/root/:rootid` | Soft delete |
| `GET` | `/api/{resource}/:id` | Get specific version |
| `POST` | `/api/{resource}/:id/restore` | Restore from version |

Resources: `schema`, `data`, `form`, `view`

### Resource-Specific Routes

```
# Schema
GET  /api/schema?business_id=:bizId
POST /api/schema/:id/validate
GET  /api/schema/:id/compare-latest

# Data
GET  /api/data/schema/:schemaId
GET  /api/data/schema-root/:schemaRootId
POST /api/data/root/:rootid/migrate-latest-schema

# Form & View
GET  /api/form/schema/:schemaId
GET  /api/view/schema/:schemaId
```

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `includeDeleted=true` | Include soft-deleted records |
| `limit=100` | Pagination limit |
| `offset=0` | Pagination offset |
| `business_id=xyz` | Filter by business (schema) |

## Architecture

```
Route → Controller → Service → Repository → PostgreSQL
                                    ↓
                              rootid-engine.js (versioning)
                              sql-builder.js (dynamic queries)
```

### Root-ID Versioning

```
CREATE  → INSERT (_rootid = new UUID, _doc_version = 1)
UPDATE  → INSERT (_rootid = same, _doc_version + 1, _flag = '')
DELETE  → INSERT (_rootid = same, _doc_version + 1, _flag = 'd')
RESTORE → INSERT (copy old payload, _doc_version + 1, _flag = '')
MIGRATE → INSERT (mapped payload, _doc_version + 1, old row _flag = 'u')
```

## Project Structure

```
rootidx/
├── sql/
│   ├── schema.sql              # Table definitions
│   └── drop-all.sql            # Drop all tables
├── src/
│   ├── app.js                  # Express setup
│   ├── server.js               # HTTP entry point
│   ├── config/config.js        # Environment config
│   ├── db/                     # Pool, migrate, drop
│   ├── core/                   # rootid-engine, sql-builder
│   ├── repositories/           # base-versioned.repository
│   ├── services/               # schema, data, form, view
│   ├── controllers/            # Request handlers
│   ├── routes/                 # Route definitions
│   ├── middlewares/            # Error handler, 404
│   └── utils/                  # Helpers
└── doc/                        # Architecture docs
```

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Developer guide (architecture, patterns, constraints)
- **[doc/README-ARCHITECTURE.md](./doc/README-ARCHITECTURE.md)** — Full architecture guide
- **[doc/API-ROUTES.md](./doc/API-ROUTES.md)** — All API endpoints
