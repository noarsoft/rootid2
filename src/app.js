// src/app.js
// -----------------------------------------------------------------------------
// Express app setup
// -----------------------------------------------------------------------------

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config/config");
const pool = require("./db/pool");

const createRoutes = require("./routes");
const notFound = require("./middlewares/not-found");
const errorHandler = require("./middlewares/error-handler");

function createApp() {
  const app = express();

  app.disable("x-powered-by");

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(
    cors({
      origin: config.app.corsOrigin === "*" ? true : config.app.corsOrigin,
      credentials: true,
    })
  );

  const mutationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: config.app.env === "production" ? 60 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Too many requests, please try again later" },
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.use((req, res, next) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    next();
  });

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      service: config.app.name,
      message: "Root-ID Figma Prototype Backend",
      timestamp: Date.now(),
    });
  });

  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      return mutationLimiter(req, res, next);
    }
    next();
  }, createRoutes(pool));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;