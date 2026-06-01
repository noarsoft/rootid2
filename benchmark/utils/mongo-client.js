// benchmark/utils/mongo-client.js
// -----------------------------------------------------------------------------
// MongoDB client helper for benchmark
//
// Required:
//   npm install mongodb
//
// Env:
//   MONGO_URI=mongodb://localhost:27017
//   MONGO_DB=rootidx_benchmark
//   MONGO_POOL_MAX=10
// -----------------------------------------------------------------------------

require("dotenv").config();

const { MongoClient } = require("mongodb");

function getEnv(name, defaultValue) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return value;
}

function getIntEnv(name, defaultValue) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return Math.trunc(n);
}

function maskMongoUri(uri) {
  return String(uri || "").replace(/\/\/.*@/, "//***:***@");
}

function getMongoConfig() {
  return {
    uri: getEnv("MONGO_URI", "mongodb://localhost:27017"),
    dbName: getEnv("MONGO_DB", "rootidx_benchmark"),
    poolMax: getIntEnv("MONGO_POOL_MAX", 10),
  };
}

async function createMongoBenchmarkClient(options = {}) {
  const config = {
    ...getMongoConfig(),
    ...options,
  };

  const client = new MongoClient(config.uri, {
    maxPoolSize: config.poolMax,
  });

  await client.connect();

  const db = client.db(config.dbName);

  return {
    client,
    db,
    config: {
      ...config,
      uri: maskMongoUri(config.uri),
    },
  };
}

module.exports = {
  getEnv,
  getIntEnv,
  getMongoConfig,
  maskMongoUri,
  createMongoBenchmarkClient,
};