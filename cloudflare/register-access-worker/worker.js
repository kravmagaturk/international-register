const ADMIN_EMAIL = "bulicet@gmail.com";
const ALLOWED_ORIGINS = new Set([
  "https://kravmaga.com.tr",
  "https://www.kravmaga.com.tr",
  "https://kravmagaturk.github.io"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://kravmaga.com.tr",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Vary": "Origin"
  };
}

function json(data, status, origin, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...(extraHeaders || {})
    }
  });
}

function normalizeRegisterNo(value) {
  const registerNo = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9-]{3,32}$/.test(registerNo) ? registerNo : "";
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request, maxBytes) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength && contentLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    throw new Error("INVALID_JSON");
  }
}

async function verifyFirebaseAdmin(idToken, env) {
  if (!idToken || !env.FIREBASE_API_KEY) return false;
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!response.ok) return false;
  const data = await response.json();
  const user = data && Array.isArray(data.users) ? data.users[0] : null;
  return !!(user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
}

async function requireAdmin(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? verifyFirebaseAdmin(match[1], env) : false;
}

async function rateState(env, key, now) {
  const row = await env.RATE_DB.prepare(
    "SELECT failures, window_start, locked_until FROM attempts WHERE key = ?"
  ).bind(key).first();
  if (!row) return { failures: 0, windowStart: now, lockedUntil: 0 };
  return {
    failures: Number(row.failures || 0),
    windowStart: Number(row.window_start || now),
    lockedUntil: Number(row.locked_until || 0)
  };
}

async function recordFailure(env, key, now, maxFailures, windowMs, lockMs) {
  let state = await rateState(env, key, now);
  if (state.windowStart + windowMs <= now) state = { failures: 0, windowStart: now, lockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= maxFailures) {
    state.failures = 0;
    state.windowStart = now;
    state.lockedUntil = now + lockMs;
  }
  await env.RATE_DB.prepare(
    "INSERT INTO attempts (key, failures, window_start, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, window_start=excluded.window_start, " +
      "locked_until=excluded.locked_until, updated_at=excluded.updated_at"
  ).bind(key, state.failures, state.windowStart, state.lockedUntil, now).run();
  return state;
}

async function clearAttempt(env, key) {
  await env.RATE_DB.prepare("DELETE FROM attempts WHERE key = ?").bind(key).run();
}

async function handleAdminSync(request, env, origin) {
  if (!(await requireAdmin(request, env))) return json({ ok: false, error: "Unauthorized." }, 401, origin);
  const body = await readJson(request, 8 * 1024 * 1024);
  const registerNo = normalizeRegisterNo(body.registerNo);
  const pin = String(body.pin || "").trim();
  const record = body.record;
  if (!registerNo || !/^\d{5}$/.test(pin) || !record || typeof record !== "object") {
    return json({ ok: false, error: "Invalid student package." }, 400, origin);
  }
  const safeRecord = { ...record, registerNo };
  delete safeRecord.accessPin;
  delete safeRecord._firebaseKey;
  const salt = randomHex(16);
  const pinHash = await sha256Hex(salt + ":" + pin);
  await env.PACKAGES.put("pkg:" + registerNo, JSON.stringify({ salt, pinHash, record: safeRecord, updatedAt: Date.now() }));
  return json({ ok: true, registerNo }, 200, origin);
}

async function handleAdminDelete(request, env, origin) {
  if (!(await requireAdmin(request, env))) return json({ ok: false, error: "Unauthorized." }, 401, origin);
  const body = await readJson(request, 4096);
  const registerNo = normalizeRegisterNo(body.registerNo);
  if (!registerNo) return json({ ok: false, error: "Invalid register number." }, 400, origin);
  await env.PACKAGES.delete("pkg:" + registerNo);
  return json({ ok: true, registerNo }, 200, origin);
}

async function handleAdminStatus(request, env, origin) {
  if (!(await requireAdmin(request, env))) return json({ ok: false, error: "Unauthorized." }, 401, origin);
  const listed = await env.PACKAGES.list({ prefix: "pkg:", limit: 1000 });
  return json({ ok: true, packageCount: listed.keys.length, complete: listed.list_complete === true }, 200, origin);
}

async function handleUnlock(request, env, origin) {
  const body = await readJson(request, 4096);
  const registerNo = normalizeRegisterNo(body.registerNo);
  const pin = String(body.pin || "").trim();
  if (!registerNo || !/^\d{5}$/.test(pin)) return json({ ok: false, error: "Invalid credentials." }, 400, origin);

  const now = Date.now();
  const ip = String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80);
  const ipKey = "ip:" + ip + ":" + registerNo;
  const registerKey = "reg:" + registerNo;
  const [ipState, registerState] = await Promise.all([
    rateState(env, ipKey, now),
    rateState(env, registerKey, now)
  ]);
  const lockedUntil = Math.max(ipState.lockedUntil, registerState.lockedUntil);
  if (lockedUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
    return json(
      { ok: false, error: "Too many attempts.", retryAfter },
      429,
      origin,
      { "Retry-After": String(retryAfter) }
    );
  }

  const stored = await env.PACKAGES.get("pkg:" + registerNo, "json");
  const candidateHash = stored && stored.salt ? await sha256Hex(stored.salt + ":" + pin) : await sha256Hex("missing:" + pin);
  const valid = !!(stored && stored.pinHash && stored.record && constantTimeEqual(candidateHash, stored.pinHash));
  if (!valid) {
    const [nextIp, nextRegister] = await Promise.all([
      recordFailure(env, ipKey, now, 5, 15 * 60 * 1000, 15 * 60 * 1000),
      recordFailure(env, registerKey, now, 50, 15 * 60 * 1000, 60 * 60 * 1000)
    ]);
    const nextLock = Math.max(nextIp.lockedUntil, nextRegister.lockedUntil);
    if (nextLock > now) {
      const retryAfter = Math.max(1, Math.ceil((nextLock - now) / 1000));
      return json({ ok: false, error: "Too many attempts.", retryAfter }, 429, origin, { "Retry-After": String(retryAfter) });
    }
    return json({ ok: false, error: "Invalid credentials." }, 401, origin);
  }

  await clearAttempt(env, ipKey);
  return json({ ok: true, record: stored.record }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed." }, 403, origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "kmt-register-access", version: "2026-10-02" }, 200, origin);
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed." }, 403, origin);
    try {
      if (url.pathname === "/v1/admin/sync" && request.method === "POST") return await handleAdminSync(request, env, origin);
      if (url.pathname === "/v1/admin/delete" && request.method === "DELETE") return await handleAdminDelete(request, env, origin);
      if (url.pathname === "/v1/admin/status" && request.method === "GET") return await handleAdminStatus(request, env, origin);
      if (url.pathname === "/v1/unlock" && request.method === "POST") return await handleUnlock(request, env, origin);
      return json({ ok: false, error: "Not found." }, 404, origin);
    } catch (error) {
      const code = error && error.message;
      if (code === "PAYLOAD_TOO_LARGE") return json({ ok: false, error: "Payload too large." }, 413, origin);
      if (code === "INVALID_JSON") return json({ ok: false, error: "Invalid JSON." }, 400, origin);
      console.error("register-access", error);
      return json({ ok: false, error: "Internal error." }, 500, origin);
    }
  }
};
