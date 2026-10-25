const FIREBASE_API_KEY = "AIzaSyAQqkrE6BweLfFEI179irLpkc6OVmIHArc";
const FIREBASE_DB = "https://temo-75-default-rtdb.europe-west1.firebasedatabase.app";
const ALLOWED_ORIGIN = "https://temo1.gr";
const ADMIN_USER = "TEMO";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
let cachedServiceToken = "";
let cachedServiceTokenUntil = 0;

function cors(origin) {
  const headers = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  return origin === ALLOWED_ORIGIN ? headers : { ...headers, "Access-Control-Allow-Origin": "null" };
}
function reply(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}
function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), c => c.charCodeAt(0));
}
function sessionKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function sessionSecretUsable(env) {
  return typeof env.SESSION_SECRET === "string" && encoder.encode(env.SESSION_SECRET).byteLength >= 32;
}
async function issueSession(env, user) {
  const payload = base64url(encoder.encode(JSON.stringify({
    sub: user.id, name: user.name, admin: user.admin,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })));
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(env.SESSION_SECRET), encoder.encode(payload));
  return payload + "." + base64url(signature);
}
async function verifySession(env, token) {
  if (!sessionSecretUsable(env) || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await sessionKey(env.SESSION_SECRET), decodeBase64url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[0])));
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.name !== "string" ||
        typeof claims.admin !== "boolean" || !Number.isInteger(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
function legacyUserId(name, password) {
  const value = String(name || "").trim().toLowerCase() + "\u0000" + String(password ?? "");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return "legacy_" + (hash >>> 0).toString(16);
}
function normalizedUsers(data) {
  if (Array.isArray(data)) return data.filter(x => x && typeof x === "object");
  if (data && typeof data === "object") return Object.entries(data).filter(([, x]) => x && typeof x === "object").map(([key, x]) => ({ ...x, _firebaseKey: key }));
  return [];
}
function safeUser(raw) {
  const name = String(raw.name || "").trim();
  const password = String(raw.password ?? "");
  const admin = name.toUpperCase() === ADMIN_USER;
  const blocked = admin ? false : (typeof raw.blocked === "boolean" ? raw.blocked : raw.authorized === false);
  const id = String(raw.id || "").trim() || legacyUserId(name, password);
  return { id, name: admin ? ADMIN_USER : name, email: String(raw.email || "").trim(), admin, blocked, authorized: admin || !blocked };
}
function constantTimeEqual(a, b) {
  const left = encoder.encode(String(a)), right = encoder.encode(String(b));
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
async function firebaseIdToken(env) {
  if (!env.FIREBASE_EMAIL || !env.FIREBASE_PASSWORD) throw new Error("backend_auth_unavailable");
  const now = Date.now();
  if (cachedServiceToken && cachedServiceTokenUntil > now + 60_000) return cachedServiceToken;
  const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.FIREBASE_EMAIL, password: env.FIREBASE_PASSWORD, returnSecureToken: true }),
    signal: AbortSignal.timeout(10_000)
  });
  const auth = await response.json().catch(() => null);
  if (!response.ok || !auth?.idToken) throw new Error("backend_auth_unavailable");
  cachedServiceToken = auth.idToken;
  cachedServiceTokenUntil = now + Math.max(60, Number(auth.expiresIn) || 3600) * 1000;
  return cachedServiceToken;
}
async function firebaseRequest(env, path, method, data) {
  const idToken = await firebaseIdToken(env);
  const url = FIREBASE_DB + "/" + path + ".json?auth=" + encodeURIComponent(idToken);
  const response = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    ...(method === "PUT" ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error("database_request_failed");
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error("database_response_invalid"); }
}
function asThread(value) {
  if (Array.isArray(value)) return value.filter(x => x && typeof x === "object");
  if (value && typeof value === "object") return Object.entries(value).map(([id, item]) => ({ ...item, id: String(item?.id || id) })).filter(x => x && typeof x === "object");
  return [];
}
function sanitizeUserThread(incoming, existing, claims) {
  if (!Array.isArray(incoming)) throw new Error("invalid_thread");
  const oldById = new Map(asThread(existing).map(m => [String(m.id || ""), m]));
  const seen = new Set();
  return incoming.slice(0, 1000).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = String(item.id || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    const old = oldById.get(id);
    const text = String(item.text || "").trim().slice(0, 4000);
    if (!text) return [];
    return [{
      id, userId: claims.sub, userName: claims.name, text,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      reply: old ? String(old.reply || "") : "",
      replyAt: old ? Number(old.replyAt || 0) : 0,
      readByAdmin: old ? old.readByAdmin === true : false,
      replyReadByUser: old?.reply ? item.replyReadByUser === true : true
    }];
  });
}
function sanitizeAdminThread(incoming, existing) {
  if (!Array.isArray(incoming)) throw new Error("invalid_thread");
  const oldById = new Map(asThread(existing).map(m => [String(m.id || ""), m]));
  const seen = new Set();
  return incoming.slice(0, 1000).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = String(item.id || ""), old = oldById.get(id);
    if (!old || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [{
      ...old, id,
      reply: String(item.reply || "").trim().slice(0, 4000),
      replyAt: Number.isFinite(Number(item.replyAt)) ? Number(item.replyAt) : 0,
      readByAdmin: item.readByAdmin === true,
      replyReadByUser: old.replyReadByUser === true
    }];
  });
}
function firebaseUserKey(id) { return encodeURIComponent(String(id)).replace(/%/g, "_"); }
function parseBridgePath(path) {
  if (typeof path !== "string" || path.length > 256) return null;
  if (/^notes\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "notes", id: path.slice("notes/".length) };
  const match = path.match(/^adminMessages(?:\/([A-Za-z0-9_-]{1,128}))?$/);
  return match ? { kind: "adminMessages", id: match[1] || "" } : null;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) return reply({ error: "Origin not allowed" }, 403, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405, origin);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 1_048_576) return reply({ error: "Request too large" }, 413, origin);
    let input;
    try { const body = await request.text(); if (encoder.encode(body).byteLength > 1_048_576) return reply({ error: "Request too large" }, 413, origin); input = JSON.parse(body); } catch { return reply({ error: "Invalid request" }, 400, origin); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply({ error: "Invalid request" }, 400, origin);
    if (!sessionSecretUsable(env)) return reply({ error: "Authentication unavailable" }, 503, origin);

    if (input.action === "login") {
      const username = String(input.username || "").trim();
      const password = typeof input.password === "string" ? input.password : "";
      if (!username || username.length > 128 || !password || password.length > 1024) return reply({ error: "Invalid credentials" }, 401, origin);
      try {
        const users = normalizedUsers(await firebaseRequest(env, "users", "GET"));
        const matched = users.find(u => String(u.name || "").trim().toLowerCase() === username.toLowerCase() &&
          constantTimeEqual(u.password ?? "", password) && String(u.name || "").trim().toUpperCase() !== "TEMOADMIN");
        if (!matched) return reply({ error: "Invalid credentials" }, 401, origin);
        const user = safeUser(matched);
        if (!user.authorized || user.blocked) return reply({ error: "Invalid credentials" }, 401, origin);
        const sessionToken = await issueSession(env, user);
        return reply({ user, sessionToken }, 200, origin);
      } catch { return reply({ error: "Authentication service unavailable" }, 503, origin); }
    }

    const claims = await verifySession(env, input.sessionToken);
    if (!claims) return reply({ error: "Authentication required" }, 401, origin);
    if (input.action === "session") return reply({ user: { id: claims.sub, name: claims.name, admin: claims.admin, authorized: true, blocked: false } }, 200, origin);
    if (input.action !== "db") return reply({ error: "Invalid action" }, 400, origin);

    const route = parseBridgePath(input.path);
    const method = String(input.method || "").toUpperCase();
    if (!route || !["GET", "PUT"].includes(method)) return reply({ error: "Invalid path or method" }, 400, origin);
    if (route.kind === "notes" && route.id !== firebaseUserKey(claims.sub)) return reply({ error: "Forbidden" }, 403, origin);
    if (route.kind === "adminMessages") {
      if (!route.id && (!claims.admin || method !== "GET")) return reply({ error: "Forbidden" }, 403, origin);
      if (route.id && !claims.admin && route.id !== firebaseUserKey(claims.sub)) return reply({ error: "Forbidden" }, 403, origin);
    }
    if (method === "PUT" && !Object.prototype.hasOwnProperty.call(input, "data")) return reply({ error: "Missing data" }, 400, origin);

    const dbPath = route.id ? (route.kind + "/" + route.id) : route.kind;
    try {
      if (method === "GET") return reply(await firebaseRequest(env, dbPath, "GET"), 200, origin);
      if (route.kind === "adminMessages" && !route.id) return reply({ error: "Forbidden" }, 403, origin);
      if (route.kind === "adminMessages") {
        const existing = await firebaseRequest(env, dbPath, "GET");
        const sanitized = claims.admin
          ? sanitizeAdminThread(input.data, existing)
          : sanitizeUserThread(input.data, existing, claims);
        return reply(await firebaseRequest(env, dbPath, "PUT", sanitized), 200, origin);
      }
      return reply(await firebaseRequest(env, dbPath, "PUT", input.data), 200, origin);
    } catch (error) {
      if (error?.message === "invalid_thread") return reply({ error: "Invalid message data" }, 400, origin);
      return reply({ error: "Firebase request failed" }, 502, origin);
    }
  }
};
