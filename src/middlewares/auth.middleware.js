const config = require("../config/config");

function buildCurrentUrl(req) {
  const protocol = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = req.get("host");
  const path = req.originalUrl || req.url || "/";

  return `${protocol}://${host}${path}`;
}

function buildLoginUrl(req) {
  const url = new URL(config.auth.loginUrl);

  if (config.auth.redirectParam) {
    url.searchParams.set(config.auth.redirectParam, buildCurrentUrl(req));
  }

  return url.toString();
}

function wantsRedirect(req) {
  const acceptHeader = String(req.headers.accept || "").toLowerCase();
  const fetchMode = String(req.headers["sec-fetch-mode"] || "").toLowerCase();

  return acceptHeader.includes("text/html") || fetchMode === "navigate";
}

async function isAuthenticated(req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.auth.requestTimeoutMs);

  try {
    const response = await fetch(config.auth.meUrl, {
      headers: {
        cookie: req.headers.cookie || "",
      },
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    return Boolean(response.ok && data && data.success);
  } finally {
    clearTimeout(timeout);
  }
}

async function requireAuth(req, res, next) {
  try {
    const authenticated = await isAuthenticated(req);

    if (authenticated) {
      return next();
    }

    const loginUrl = buildLoginUrl(req);

    if (wantsRedirect(req)) {
      return res.redirect(302, loginUrl);
    }

    return res.status(401).json({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Login required",
        loginUrl,
      },
    });
  } catch (error) {
    const loginUrl = buildLoginUrl(req);

    return res.status(503).json({
      ok: false,
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Auth service unavailable",
        loginUrl,
      },
    });
  }
}

module.exports = {
  requireAuth,
  buildLoginUrl,
};