// benchmark/scripts/seed-wiki-business-schema.js
// -----------------------------------------------------------------------------
// Seed Wiki demo business + data_schema only
//
// ใช้สร้าง mock business/schema สำหรับเปิดดูในหน้า Schema Builder
// Payload ต้องเป็น object keyed by field name:
// {
//   page_id: { type, label, required, _order, ... },
//   page_title: { type, label, required, _order, ... }
// }
//
// เพราะ src/forms/schema/edit.jsx ใช้ SchemaBuilder กับ schemaPayload ตรง ๆ
// -----------------------------------------------------------------------------

require("dotenv").config();

const pool = require("../../src/db/pool");

const BUSINESS_NAME = "Wiki Benchmark Demo";
const SCHEMA_NAME = "Wiki Revision Schema v1";

function nowModifyDatetime() {
  const d = new Date();

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return Number(`${yyyy}${mm}${dd}${hh}${mi}${ss}`);
}

function field(type, label, order, options = {}) {
  const required = Boolean(options.required);

  return {
    type,
    label,
    required,
    _order: order,

    // เผื่อ SchemaBuilder / control config อ่านเพิ่ม
    control: options.control || defaultControlByType(type),
    placeholder: options.placeholder || `กรอก ${label}`,

    // อธิบายไว้เฉย ๆ ไม่กระทบ builder ถ้าไม่ใช้
    description: options.description || "",

    // config เก็บ label ซ้ำไว้ กันบาง component อ่านจาก config.label
    config: {
      label,
      required,
      placeholder: options.placeholder || `กรอก ${label}`,
      ...(options.config || {}),
    },
  };
}

function defaultControlByType(type) {
  if (type === "number") return "textbox";
  if (type === "boolean") return "checkbox";
  return "textbox";
}

function makeWikiSchemaPayload() {
  return {
    category_id: field("string", "Category ID", 1, {
      description: "ชื่อ folder/category ที่ไฟล์ wiki อยู่ เช่น anthropology_and_archaeology",
    }),

    category_title: field("string", "Category Title", 2),

    page_id: field("number", "Page ID", 3, {
      required: true,
      description: "Wikipedia pageid ใช้เป็น logical object id และ map เป็น _rootid ใน RootID benchmark",
    }),

    page_title: field("string", "Page Title", 4, {
      required: true,
    }),

    revision_id: field("number", "Revision ID", 5, {
      required: true,
      description: "Wikipedia revision id",
    }),

    parent_id: field("number", "Parent Revision ID", 6, {
      description: "Revision ก่อนหน้า ใช้ตรวจ lineage",
    }),

    revision_timestamp: field("string", "Revision Timestamp", 7, {
      description: "เวลาของ revision จาก MediaWiki API",
    }),

    revision_user: field("string", "Revision User", 8, {
      description: "ผู้แก้ไข revision",
    }),

    revision_comment: field("string", "Revision Comment", 9, {
      control: "textarea",
      description: "comment หรือ edit summary ของ revision",
    }),

    revision_size: field("number", "Revision Size", 10, {
      description: "size จาก Wiki API ถ้ามี",
    }),

    revision_sha1: field("string", "Revision SHA1", 11),

    content_format: field("string", "Content Format", 12),

    content_model: field("string", "Content Model", 13),

    text_hash: field("string", "Text Hash", 14, {
      description: "SHA1 hash ที่คำนวณจาก text content",
    }),

    text_size: field("number", "Text Size", 15, {
      description: "ขนาด text content ที่คำนวณเอง",
    }),

    source_file: field("string", "Source File", 16, {
      description: "path ของ raw JSON file",
    }),

    source_index: field("number", "Source Index", 17, {
      description: "ลำดับ revision ในไฟล์ต้นทาง",
    }),
  };
}

async function insertVersionedRow(client, table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map((_, index) => `$${index + 1}`);
  const values = keys.map((key) => data[key]);

  const inserted = await client.query(
    `
      INSERT INTO ${table} (${keys.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `,
    values
  );

  const row = inserted.rows[0];

  // create row แรกให้ _rootid = id ตัวเอง
  await client.query(
    `
      UPDATE ${table}
      SET _rootid = $1
      WHERE id = $1
    `,
    [row.id]
  );

  const updated = await client.query(
    `
      SELECT *
      FROM ${table}
      WHERE id = $1
    `,
    [row.id]
  );

  return updated.rows[0];
}

async function getCurrentBusiness(client) {
  const result = await client.query(
    `
      SELECT *
      FROM business
      WHERE name = $1
        AND _flag = ''
      ORDER BY id DESC
      LIMIT 1
    `,
    [BUSINESS_NAME]
  );

  return result.rows[0] || null;
}

async function getCurrentSchema(client, businessId) {
  const result = await client.query(
    `
      SELECT *
      FROM data_schema
      WHERE business_id = $1
        AND name = $2
        AND _flag = ''
      ORDER BY id DESC
      LIMIT 1
    `,
    [businessId, SCHEMA_NAME]
  );

  return result.rows[0] || null;
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const modifyDatetime = nowModifyDatetime();

    let business = await getCurrentBusiness(client);

    if (!business) {
      business = await insertVersionedRow(client, "business", {
        _rootid: 0,
        _prev_id: null,
        _flag: "",
        name: BUSINESS_NAME,
        icon: "📚",
        _modify_datetime: modifyDatetime,
      });
    }

    let schema = await getCurrentSchema(client, business.id);

    if (!schema) {
      schema = await insertVersionedRow(client, "data_schema", {
        _rootid: 0,
        _prev_id: null,
        _flag: "",
        business_id: business.id,
        name: SCHEMA_NAME,
        payload: JSON.stringify(makeWikiSchemaPayload()),
        _modify_datetime: modifyDatetime,
      });
    }

    await client.query("COMMIT");

    console.log("[seed-wiki-business-schema] done");
    console.table([
      {
        type: "business",
        id: business.id,
        rootid: business._rootid,
        name: business.name,
      },
      {
        type: "data_schema",
        id: schema.id,
        rootid: schema._rootid,
        name: schema.name,
      },
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .catch((err) => {
    console.error("[seed-wiki-business-schema] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });