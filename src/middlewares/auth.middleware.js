const config = require("../config/config");

function buildCurrentUrl(req) {
  const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.get("host") || "").trim();
  const path = req.originalUrl || req.url || "/";

  return `${protocol}://${host}${path}`;
}

function buildProviderLoginUrl(req) {
  const url = new URL(config.auth.providerLoginUrl);

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

function parseCookieHeader(rawCookieHeader) {
  const result = {};
  const source = String(rawCookieHeader || "").trim();

  if (!source) {
    return result;
  }

  for (const item of source.split(";")) {
    const [namePart, ...valueParts] = item.split("=");
    const name = String(namePart || "").trim();

    if (!name) {
      continue;
    }

    result[name] = decodeURIComponent(valueParts.join("=").trim());
  }

  return result;
}

function getTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || "").trim();

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const bearer = authHeader.slice(7).trim();

    if (bearer) {
      return bearer;
    }
  }

  const queryToken = String(req.query?.auth_token || "").trim();

  if (queryToken) {
    return queryToken;
  }

  const cookies = req.cookies && typeof req.cookies === "object"
    ? req.cookies
    : parseCookieHeader(req.headers.cookie || "");

  return String(cookies?.[config.auth.tokenCookieName] || "").trim() || null;
}

function createTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: config.auth.tokenCookieSecure,
    sameSite: config.auth.tokenCookieSameSite,
    path: "/",
    maxAge: config.auth.tokenCookieMaxAgeMs,
  };
}

function buildCleanUrlWithoutToken(req) {
  const current = new URL(buildCurrentUrl(req));
  current.searchParams.delete("auth_token");
  return `${current.pathname}${current.search}${current.hash}`;
}

async function verifyProviderToken(token, req) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.auth.requestTimeoutMs);

  try {
    const response = await fetch(config.auth.meUrl, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      return null;
    }

    const user = data.user || data.data?.user || null;
    const roles = Array.isArray(data.roles)
      ? data.roles
      : Array.isArray(data.data?.roles)
        ? data.data.roles
        : [];

    return {
      user,
      roles,
      isAdmin: roles.some((role) => {
        return role && role.role_code === "admin" && ["rootidx", "rootid2"].includes(role.system_code);
      }),
      sourceToken: token,
      requestUrl: buildCurrentUrl(req),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sendUnauthorized(req, res) {
  const loginUrl = buildProviderLoginUrl(req);

  if (wantsRedirect(req)) {
    return res.redirect(302, loginUrl);
  }

  return res.status(401).json({
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Provider token required",
      loginUrl,
    },
  });
}

async function requireAuth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return sendUnauthorized(req, res);
    }

    const authData = await verifyProviderToken(token, req);

    if (!authData) {
      res.clearCookie(config.auth.tokenCookieName, createTokenCookieOptions());
      return sendUnauthorized(req, res);
    }

    const hasQueryToken = String(req.query?.auth_token || "").trim().length > 0;

    res.cookie(config.auth.tokenCookieName, token, createTokenCookieOptions());

    req.auth = {
      user: authData.user,
      roles: authData.roles,
      isAdmin: authData.isAdmin,
      provider: "rootid2",
    };

    req.user = authData.user;

    if (hasQueryToken) {
      return res.redirect(302, buildCleanUrlWithoutToken(req));
    }

    return next();
  } catch (_error) {
    return res.status(503).json({
      ok: false,
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Auth service unavailable",
        loginUrl: buildProviderLoginUrl(req),
      },
    });
  }
}

module.exports = {
  requireAuth,
};