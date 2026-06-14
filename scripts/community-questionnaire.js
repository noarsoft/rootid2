const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config();

const pool = require("../src/db/pool");
const BusinessService = require("../src/services/business.service");
const SchemaService = require("../src/services/schema.service");
const { businessQuestionnaire } = require("../src/questionnaires");
const { communityQuestionnaire } = require("../src/schemas");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function findLatestByName(service, name) {
  const rows = await service.listLatest({
    includeDeleted: false,
    limit: 20,
    offset: 0,
    columnFilters: { name },
  });

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function seedDatabase() {
  const businessService = new BusinessService(pool);
  const schemaService = new SchemaService(pool);

  const businessName = businessQuestionnaire.name;
  const schemaName = communityQuestionnaire.name;

  let business = await findLatestByName(businessService, businessName);

  if (!business) {
    business = await businessService.createBusiness({
      name: businessName,
      icon: "🏘️",
    });
  }

  let schema = null;

  if (business?.id) {
    const existing = await schemaService.repo.listLatest({
      includeDeleted: false,
      limit: 20,
      offset: 0,
      columnFilters: {
        business_id: business.id,
        name: schemaName,
      },
    });

    schema = Array.isArray(existing) ? existing[0] || null : null;

    if (!schema) {
      const schemaPayload = communityQuestionnaire.toSchemaPayload
        ? communityQuestionnaire.toSchemaPayload(communityQuestionnaire)
        : communityQuestionnaire;

      schema = await schemaService.createSchema({
        name: schemaName,
        business_id: business.id,
        payload: schemaPayload.payload || {},
      });
    }
  }

  return { business, schema };
}

function buildExportFiles() {
  const outputDir = path.resolve(__dirname, "..", "update", "tmp");
  const businessOutputFile = path.join(
    outputDir,
    "business-questionnaire.json"
  );
  const outputFile = path.join(outputDir, "community-questionnaire.schema.json");

  const businessPayload = businessQuestionnaire.toQuestionnairePayload
    ? businessQuestionnaire.toQuestionnairePayload(businessQuestionnaire)
    : businessQuestionnaire;

  const schemaPayload = communityQuestionnaire.toSchemaPayload
    ? communityQuestionnaire.toSchemaPayload(communityQuestionnaire)
    : communityQuestionnaire;

  ensureDir(outputDir);
  fs.writeFileSync(businessOutputFile, JSON.stringify(businessPayload, null, 2), "utf8");
  fs.writeFileSync(outputFile, JSON.stringify(schemaPayload, null, 2), "utf8");

  return {
    outputDir,
    businessOutputFile,
    outputFile,
    businessPayload,
    schemaPayload,
  };
}

async function run() {
  try {
    const seeded = await seedDatabase();

    const exports = buildExportFiles();

    console.log(`Wrote ${exports.businessOutputFile}`);
    console.log(`Wrote ${exports.outputFile}`);
    console.log(`Business sections: ${exports.businessPayload.sections?.length || 0}`);
    console.log(`Fields: ${Object.keys(exports.schemaPayload.payload || {}).length}`);
    console.table([
      {
        type: "business",
        id: seeded.business?.id || null,
        rootid: seeded.business?._rootid || null,
        name: seeded.business?.name || businessQuestionnaire.name,
      },
      {
        type: "data_schema",
        id: seeded.schema?.id || null,
        rootid: seeded.schema?._rootid || null,
        name: seeded.schema?.name || communityQuestionnaire.name,
      },
    ]);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
