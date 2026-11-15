const DEFAULT_FIREBASE_API_KEY = "AIzaSyAQqkrE6BweLfFEI179irLpkc6OVmIHArc";
const DEFAULT_FIREBASE_DB = "https://temo-75-default-rtdb.europe-west1.firebasedatabase.app";
const DEFAULT_ALLOWED_ORIGIN = "https://temo1.gr";
const ADMIN_USER = "TEMO";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
let cachedServiceToken = "";
let cachedServiceTokenUntil = 0;
let cachedServiceIdentity = "";

function cors(origin, allowedOrigin = DEFAULT_ALLOWED_ORIGIN) {
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  return origin === allowedOrigin ? headers : { ...headers, "Access-Control-Allow-Origin": "null" };
}
function reply(data, status, origin, allowedOrigin = DEFAULT_ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin, allowedOrigin) });
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
async function credentialFingerprint(env, password) {
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(env.SESSION_SECRET), encoder.encode("credential\u0000" + String(password ?? "")));
  return base64url(signature);
}
async function issueSession(env, user, password) {
  const payload = base64url(encoder.encode(JSON.stringify({
    sub: user.id, name: user.name, admin: user.admin,
    credential: await credentialFingerprint(env, password),
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
        typeof claims.credential !== "string" || claims.credential.length > 128 ||
        claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
async function validateCurrentUser(env, claims) {
  const records = normalizedUsers(await firebaseRequest(env, "users", "GET"));
  const record = records.find(item => safeUser(item).id === claims.sub);
  if (!record) return null;
  const user = safeUser(record);
  if (!user.authorized || user.blocked || user.name !== claims.name || user.admin !== claims.admin) return null;
  const fingerprint = await credentialFingerprint(env, record.password);
  if (!constantTimeEqual(fingerprint, claims.credential)) return null;
  return user;
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
  const identityMaterial = JSON.stringify([env.FIREBASE_EMAIL, env.FIREBASE_PASSWORD, env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY, env.FIREBASE_AUTH_URL || "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword", env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB, env.FIREBASE_DB_NAMESPACE || ""]);
  const identityDigest = await crypto.subtle.digest("SHA-256", encoder.encode(identityMaterial));
  const identity = base64url(identityDigest);
  if (cachedServiceToken && cachedServiceTokenUntil > now + 60_000 && cachedServiceIdentity === identity) return cachedServiceToken;
  const authUrl = new URL(env.FIREBASE_AUTH_URL || "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword");
  authUrl.searchParams.set("key", env.FIREBASE_API_KEY || DEFAULT_FIREBASE_API_KEY);
  const response = await fetch(authUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.FIREBASE_EMAIL, password: env.FIREBASE_PASSWORD, returnSecureToken: true }),
    signal: AbortSignal.timeout(10_000)
  });
  const auth = await response.json().catch(() => null);
  if (!response.ok || !auth?.idToken) throw new Error("backend_auth_unavailable");
  cachedServiceToken = auth.idToken;
  cachedServiceIdentity = identity;
  cachedServiceTokenUntil = now + Math.max(60, Number(auth.expiresIn) || 3600) * 1000;
  return cachedServiceToken;
}
async function firebaseRequest(env, path, method, data) {
  const idToken = await firebaseIdToken(env);
  const dbBase = String(env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB).replace(/\/+$/, "");
  const dbPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(dbBase + "/" + dbPath + ".json");
  url.searchParams.set("auth", idToken);
  if (env.FIREBASE_DB_NAMESPACE) url.searchParams.set("ns", String(env.FIREBASE_DB_NAMESPACE));
  const response = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    ...(["PUT", "PATCH"].includes(method) ? { body: JSON.stringify(data) } : {}),
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
    const reply = String(item.reply || "").trim().slice(0, 4000);
    const replyReadByUser = reply === String(old.reply || "")
      ? old.replyReadByUser === true
      : false;
    return [{
      ...old, id,
      reply,
      replyAt: Number.isFinite(Number(item.replyAt)) ? Number(item.replyAt) : 0,
      readByAdmin: item.readByAdmin === true,
      // A changed response is unread; only the user can mark it read.
      replyReadByUser
    }];
  });
}
function firebaseUserKey(id) { return encodeURIComponent(String(id)).replace(/%/g, "_"); }
function parseBridgePath(path) {
  if (typeof path !== "string" || path.length > 256) return null;
  if (/^notes\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "notes", id: path.slice("notes/".length) };
  if (/^daily\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "daily", id: path.slice("daily/".length) };
  if (/^expenses\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "expenses", id: path.slice("expenses/".length) };
  if (/^jobs\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "jobs", id: path.slice("jobs/".length) };
  if (/^jobDeletes\/[A-Za-z0-9_-]{1,128}$/.test(path)) return { kind: "jobDeletes", id: path.slice("jobDeletes/".length) };
  if (path === "siteBroadcast") return { kind: "siteBroadcast", id: "" };
  const match = path.match(/^adminMessages(?:\/([A-Za-z0-9_-]{1,128}))?$/);
  return match ? { kind: "adminMessages", id: match[1] || "" } : null;
}
export default {
  async scheduled(controller, env, ctx) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      const threads = await firebaseRequest(env, "messenger/directMessages", "GET") || {};
      for (const [threadId, stored] of Object.entries(threads)) {
        if (!/^[A-Za-z0-9_-]{1,260}$/.test(threadId) || !stored || typeof stored !== "object") continue;
        const entries = Array.isArray(stored) ? stored.map((message, index) => [String(index), message]) : Object.entries(stored);
        for (const [messageId, message] of entries) {
          if (!message || typeof message !== "object") continue;
          const createdAt = Number(message.createdAt || 0);
          if (createdAt > 0 && createdAt < cutoff) {
            await firebaseRequest(env, "messenger/directMessages/" + threadId + "/" + messageId, "DELETE");
          }
        }
      }
    } catch (error) {
      console.error("Messenger 7-day cleanup failed", error);
      throw error;
    }
  },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const respond = (data, status) => reply(data, status, origin, allowedOrigin);
    if (origin !== allowedOrigin) return respond({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, allowedOrigin) });
    if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 1_048_576) return respond({ error: "Request too large" }, 413);
    let input;
    try { const body = await request.text(); if (encoder.encode(body).byteLength > 1_048_576) return respond({ error: "Request too large" }, 413); input = JSON.parse(body); } catch { return respond({ error: "Invalid request" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return respond({ error: "Invalid request" }, 400);
    if (!sessionSecretUsable(env)) return respond({ error: "Authentication unavailable" }, 503);

    if (input.action === "login") {
      const username = String(input.username || "").trim();
      const password = typeof input.password === "string" ? input.password : "";
      if (!username || username.length > 128 || !password || password.length > 1024) return respond({ error: "Invalid credentials" }, 401);
      try {
        const users = normalizedUsers(await firebaseRequest(env, "users", "GET"));
        const matched = users.find(u => String(u.name || "").trim().toLowerCase() === username.toLowerCase() &&
          constantTimeEqual(u.password ?? "", password) && String(u.name || "").trim().toUpperCase() !== "TEMOADMIN");
        if (!matched) return respond({ error: "Invalid credentials" }, 401);
        const user = safeUser(matched);
        if (!user.authorized || user.blocked) return respond({ error: "Invalid credentials" }, 401);
        const sessionToken = await issueSession(env, user, matched.password);
        return respond({ user, sessionToken }, 200);
      } catch { return respond({ error: "Authentication service unavailable" }, 503); }
    }

    if (input.action === "register") {
      const username = String(input.username || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const password = typeof input.password === "string" ? input.password : "";
      if (!/^[A-Za-z]{1,40}$/.test(username) || !/^[^\s@]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/.test(email) ||
          email.length > 120 || password.length < 6 || password.length > 80) {
        return respond({ error: "Invalid registration data" }, 400);
      }
      const reservedName = username.toUpperCase();
      if (reservedName === ADMIN_USER || reservedName === "TEMOADMIN") {
        return respond({ error: "Account name unavailable" }, 409);
      }
      try {
        const records = normalizedUsers(await firebaseRequest(env, "users", "GET"));
        if (records.some(record =>
          String(record.name || "").trim().toLowerCase() === username.toLowerCase() ||
          (record.email && String(record.email).trim().toLowerCase() === email)
        )) return respond({ error: "Account already exists" }, 409);

        const userId = crypto.randomUUID();
        const record = { id: userId, name: username, email, password, admin: false, authorized: true, blocked: false };
        // Write only this new child so existing users and the TEMO admin record remain untouched.
        await firebaseRequest(env, "users/" + userId, "PUT", record);
        const user = safeUser(record);
        const sessionToken = await issueSession(env, user, password);
        return respond({ user, sessionToken }, 201);
      } catch {
        return respond({ error: "Registration service unavailable" }, 502);
      }
    }

    if (input.action === "passwordReset") {
      const username = String(input.username || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
      if (!username || username.length > 128 || !/^[^\s@]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/.test(email) ||
          email.length > 120 || newPassword.length < 6 || newPassword.length > 80) {
        return respond({ error: "Invalid password reset data" }, 400);
      }

      try {
        const stored = await firebaseRequest(env, "users", "GET");
        const entries = Array.isArray(stored)
          ? stored.map((record, index) => [String(index), record])
          : stored && typeof stored === "object" ? Object.entries(stored) : [];
        const matches = entries.filter(([, record]) => {
          if (!record || typeof record !== "object") return false;
          const name = String(record.name || "").trim();
          return name.toUpperCase() !== ADMIN_USER && name.toUpperCase() !== "TEMOADMIN" &&
            name.toLowerCase() === username.toLowerCase() &&
            String(record.email || "").trim().toLowerCase() === email;
        });
        if (matches.length !== 1) {
          return respond({ error: "Account details do not match" }, 400);
        }

        const [userKey] = matches[0];
        await firebaseRequest(env, "users/" + userKey, "PATCH", { password: newPassword });
        return respond({ ok: true }, 200);
      } catch {
        return respond({ error: "Password reset service unavailable" }, 502);
      }
    }

    const claims = await verifySession(env, input.sessionToken);
    if (!claims) return respond({ error: "Authentication required" }, 401);
    let activeUser;
    try { activeUser = await validateCurrentUser(env, claims); }
    catch { return respond({ error: "Authentication service unavailable" }, 503); }
    if (!activeUser) return respond({ error: "Authentication required" }, 401);
    if (input.action === "session") return respond({ user: activeUser }, 200);
    if (input.action === "listUsers") {
      if (!claims.admin) return respond({ error: "Forbidden" }, 403);
      try {
        return respond(normalizedUsers(await firebaseRequest(env, "users", "GET")), 200);
      } catch {
        return respond({ error: "Firebase user list failed" }, 502);
      }
    }
    if (input.action === "userBlock") {
      if (!claims.admin) return respond({ error: "Forbidden" }, 403);
      const userId = String(input.userId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) || typeof input.blocked !== "boolean") return respond({ error: "Invalid user block request" }, 400);
      try {
        const storedUsers = await firebaseRequest(env, "users", "GET");
        let matches = [];
        if (Array.isArray(storedUsers)) {
          matches = storedUsers.map((record, index) => ({ record, path: "users/" + index }))
            .filter(item => item.record && safeUser(item.record).id === userId);
        } else if (storedUsers && typeof storedUsers === "object") {
          matches = Object.entries(storedUsers).map(([key, record]) => ({ record, path: "users/" + key }))
            .filter(item => item.record && safeUser(item.record).id === userId);
        }
        if (matches.length !== 1) return respond({ error: matches.length ? "Ambiguous user" : "User not found" }, matches.length ? 409 : 404);
        if (safeUser(matches[0].record).admin) return respond({ error: "Forbidden" }, 403);
        await firebaseRequest(env, matches[0].path, "PATCH", { blocked: input.blocked, authorized: !input.blocked });
        return respond({ userId, blocked: input.blocked, authorized: !input.blocked }, 200);
      } catch {
        return respond({ error: "Firebase user update failed" }, 502);
      }
    }
    if (input.action === "userDelete") {
      if (!claims.admin) return respond({ error: "Forbidden" }, 403);
      const userId = String(input.userId || "").trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return respond({ error: "Invalid user delete request" }, 400);
      try {
        const storedUsers = await firebaseRequest(env, "users", "GET");
        let matches = [];
        if (Array.isArray(storedUsers)) {
          matches = storedUsers.map((record, index) => ({ record, path: "users/" + index }))
            .filter(item => item.record && safeUser(item.record).id === userId);
        } else if (storedUsers && typeof storedUsers === "object") {
          matches = Object.entries(storedUsers).map(([key, record]) => ({ record, path: "users/" + key }))
            .filter(item => item.record && safeUser(item.record).id === userId);
        }
        if (matches.length !== 1) {
          return respond({ error: matches.length ? "Ambiguous user" : "User not found" }, matches.length ? 409 : 404);
        }
        if (safeUser(matches[0].record).admin) return respond({ error: "Forbidden" }, 403);
        await firebaseRequest(env, matches[0].path, "DELETE");
        return respond({ ok: true, userId }, 200);
      } catch {
        return respond({ error: "Firebase user delete failed" }, 502);
      }
    }

    if (input.action === "messenger") {
      const op = String(input.op || "");
      const groupId = String(input.groupId || "");
      const targetId = String(input.targetId || "");
      const validId = value => /^[A-Za-z0-9_-]{1,128}$/.test(value);
      const blockedBy = async (a,b) => {
        const value = await firebaseRequest(env, "messenger/blocks/" + firebaseUserKey(a) + "/" + firebaseUserKey(b), "GET");
        return value === true;
      };
      try {
        if (op === "users") {
          const users=normalizedUsers(await firebaseRequest(env,"users","GET"));
          const blocked=await firebaseRequest(env,"messenger/blocks/"+firebaseUserKey(claims.sub),"GET")||{};
          return respond(users.map(safeUser).filter(u=>u.id!==claims.sub&&u.authorized&&!u.blocked&&!u.admin&&blocked[firebaseUserKey(u.id)]!==true).map(u=>({id:u.id,name:u.name})),200);
        }
        if (op === "contacts") {
          const data=await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(claims.sub),"GET")||{};
          const users=normalizedUsers(await firebaseRequest(env,"users","GET"));
          return respond(Object.keys(data).filter(id=>data[id]===true).map(id=>{const u=users.find(x=>safeUser(x).id===id);return u?{id,name:safeUser(u).name}:null}).filter(Boolean),200);
        }
        if (op === "requests") {
          const data=await firebaseRequest(env,"messenger/requests/"+firebaseUserKey(claims.sub),"GET")||{};
          const users=normalizedUsers(await firebaseRequest(env,"users","GET"));
          return respond(Object.entries(data).filter(([,r])=>r&&r.status==="pending").map(([id,r])=>{const u=users.find(x=>safeUser(x).id===r.from);return{id,from:r.from,name:u?safeUser(u).name:"მომხმარებელი",createdAt:r.createdAt}}),200);
        }
        if (op === "requestFriend") {
          if(!validId(targetId)||targetId===claims.sub)return respond({error:"Invalid user"},400);
          const users=normalizedUsers(await firebaseRequest(env,"users","GET"));
          const target=users.find(x=>safeUser(x).id===targetId);
          if(!target||!safeUser(target).authorized||safeUser(target).blocked||safeUser(target).admin)return respond({error:"User not found"},404);
          if(await blockedBy(claims.sub,targetId)||await blockedBy(targetId,claims.sub))return respond({error:"მომხმარებელი დაბლოკილია"},403);
          const mine=await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId),"GET");
          if(mine===true)return respond({status:"friends"},200);
          const pending=await firebaseRequest(env,"messenger/requests/"+firebaseUserKey(targetId)+"/"+firebaseUserKey(claims.sub),"GET");
          if(pending?.status==="pending")return respond({status:"sent"},200);
          await firebaseRequest(env,"messenger/requests/"+firebaseUserKey(targetId)+"/"+firebaseUserKey(claims.sub),"PUT",{from:claims.sub,status:"pending",createdAt:Date.now()});
          return respond({status:"sent"},200);
        }
        if (op === "respondFriend") {
          if(!validId(targetId)||!["accept","reject"].includes(String(input.decision)))return respond({error:"Invalid request"},400);
          const path="messenger/requests/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId);
          const request=await firebaseRequest(env,path,"GET");
          if(!request||request.from!==targetId||request.status!=="pending")return respond({error:"Request not found"},404);
          if(input.decision==="accept"){
            await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId),"PUT",true);
            await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(targetId)+"/"+firebaseUserKey(claims.sub),"PUT",true);
          }
          await firebaseRequest(env,path,"DELETE");
          return respond({ok:true,accepted:input.decision==="accept"},200);
        }
        if (op === "removeFriend") {
          if(!validId(targetId)||targetId===claims.sub)return respond({error:"Invalid user"},400);
          await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId),"DELETE");
          await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(targetId)+"/"+firebaseUserKey(claims.sub),"DELETE");
          return respond({ok:true},200);
        }
        if (["directMessages","sendDirect","editDirect","deleteDirect"].includes(op)) {
          if(!validId(targetId)||targetId===claims.sub)return respond({error:"Invalid user"},400);
          const friend=await firebaseRequest(env,"messenger/friends/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId),"GET");
          if(friend!==true)return respond({error:"კონტაქტი ჯერ არ არის მიღებული"},403);
          const thread=[claims.sub,targetId].sort().map(firebaseUserKey).join("_");
          const path="messenger/directMessages/"+thread;
          if(op==="editDirect"||op==="deleteDirect"){
            const messageId=String(input.messageId||"");
            if(!/^[A-Za-z0-9_-]{1,128}$/.test(messageId))return respond({error:"Invalid message"},400);
            const old=await firebaseRequest(env,path+"/"+messageId,"GET");
            if(!old||old.userId!==claims.sub)return respond({error:"შეგიძლია მხოლოდ შენი წერილის შეცვლა ან წაშლა"},403);
            if(op==="deleteDirect"){await firebaseRequest(env,path+"/"+messageId,"DELETE");return respond({ok:true},200)}
            const edited=String(input.text||"").trim().slice(0,2000);
            if(!edited)return respond({error:"ტექსტი ცარიელია"},400);
            await firebaseRequest(env,path+"/"+messageId,"PATCH",{text:edited,editedAt:Date.now()});
            return respond({ok:true},200);
          }
          if(op==="directMessages"){
            const stored=await firebaseRequest(env,path,"GET")||{};
            const list=Array.isArray(stored)?stored:Object.entries(stored).map(([id,item])=>({...item,id:item?.id||id}));
            list.sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
            return respond(list.slice(-200),200);
          }
          const body=String(input.text||"").trim().slice(0,2000);
          if(!body)return respond({error:"შეტყობინება ცარიელია"},400);
          const id=crypto.randomUUID().replace(/-/g,"");
          const message={id,userId:claims.sub,userName:claims.name,text:body,createdAt:Date.now()};
          await firebaseRequest(env,path+"/"+id,"PUT",message);
          return respond({ok:true,message},200);
        }
      if (op === "groups") {
          const all = await firebaseRequest(env, "messenger/groups", "GET") || {};
          const joined = Object.values(all).filter(g => g && Array.isArray(g.members) && g.members.includes(claims.sub));
          return respond(joined, 200);
        }
        if (op === "create") {
          const title = String(input.title || "").trim().slice(0, 50);
          if (!title) return respond({error:"Group name required"},400);
          const id = crypto.randomUUID().replace(/-/g,"");
          const inviteCode = crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
          const group = {id,title,ownerId:claims.sub,ownerName:claims.name,members:[claims.sub],inviteCode,createdAt:Date.now()};
          await firebaseRequest(env,"messenger/groups/"+id,"PUT",group);
          return respond(group,201);
        }
        if (op === "join") {
          const code = String(input.inviteCode || "").trim().toUpperCase();
          if (!code) return respond({error:"Invite code required"},400);
          const all = await firebaseRequest(env,"messenger/groups","GET") || {};
          const group = Object.values(all).find(g=>g&&g.inviteCode===code);
          if (!group) return respond({error:"Group not found"},404);
          if (group.members.includes(claims.sub)) return respond(group,200);
          group.members=[...group.members,claims.sub];
          await firebaseRequest(env,"messenger/groups/"+group.id,"PUT",group);
          return respond(group,200);
        }
        if (!validId(groupId)) return respond({error:"Invalid group"},400);
        const group = await firebaseRequest(env,"messenger/groups/"+groupId,"GET");
        if (!group || !Array.isArray(group.members) || !group.members.includes(claims.sub)) return respond({error:"Group access denied"},403);
        if (op === "members") {
          const users = normalizedUsers(await firebaseRequest(env, "users", "GET"));
          const members = group.members.map(id => {
            const record = users.find(item => safeUser(item).id === id);
            return record ? {id, name: safeUser(record).name} : {id, name:"მომხმარებელი"};
          });
          const blocked = await firebaseRequest(env, "messenger/blocks/" + firebaseUserKey(claims.sub), "GET") || {};
          return respond({members, blockedIds:Object.keys(blocked).filter(id=>blocked[id]===true)},200);
        }
        if (op === "messages") {
          const stored = await firebaseRequest(env, "messenger/messages/" + groupId, "GET") || {};
          const messages = Array.isArray(stored) ? stored : Object.entries(stored).map(([id, item]) => ({...item, id:item?.id || id}));
          messages.sort((a,b) => Number(a.createdAt||0)-Number(b.createdAt||0));
          return respond(messages.slice(-200), 200);
        }
        if (op === "send") {
          const body = String(input.text || "").trim().slice(0,2000);
          if (!body) return respond({error:"Message is empty"},400);
          const messageId = crypto.randomUUID().replace(/-/g,"");
          const message = {id:messageId,userId:claims.sub,userName:claims.name,text:body,createdAt:Date.now()};
          await firebaseRequest(env, "messenger/messages/" + groupId + "/" + messageId, "PUT", message);
          return respond({ok:true,message},200);
        }
        if (op === "block" || op === "unblock") {
          if (!validId(targetId) || targetId===claims.sub) return respond({error:"Invalid user"},400);
          const users = normalizedUsers(await firebaseRequest(env,"users","GET"));
          const target = users.find(u=>safeUser(u).id===targetId);
          if (!target || safeUser(target).admin) return respond({error:"User not found"},404);
          await firebaseRequest(env,"messenger/blocks/"+firebaseUserKey(claims.sub)+"/"+firebaseUserKey(targetId),"PUT",op==="block");
          return respond({ok:true,blocked:op==="block"},200);
        }
        if (op === "blocked") {
          const data = await firebaseRequest(env,"messenger/blocks/"+firebaseUserKey(claims.sub),"GET") || {};
          return respond(Object.keys(data).filter(k=>data[k]===true),200);
        }
        return respond({error:"Unknown messenger operation"},400);
      } catch (error) {
        return respond({error:"Messenger database request failed"},502);
      }
    }
    if (input.action !== "db") return respond({ error: "Invalid action" }, 400);

    const route = parseBridgePath(input.path);
    const method = String(input.method || "").toUpperCase();
    if (!route || !["GET", "PUT", "DELETE"].includes(method) ||
        (method === "DELETE" && (route.kind !== "adminMessages" || !route.id))) return respond({ error: "Invalid path or method" }, 400);
    if ((route.kind === "notes" || route.kind === "daily" || route.kind === "expenses" || route.kind === "jobs" || route.kind === "jobDeletes") && route.id !== firebaseUserKey(claims.sub)) return respond({ error: "Forbidden" }, 403);
    if (route.kind === "adminMessages") {
      if (!route.id && (!claims.admin || method !== "GET")) return respond({ error: "Forbidden" }, 403);
      if (route.id && !claims.admin && route.id !== firebaseUserKey(claims.sub)) return respond({ error: "Forbidden" }, 403);
      if (method === "DELETE" && !claims.admin) return respond({ error: "Forbidden" }, 403);
    }
    if (route.kind === "siteBroadcast" && method === "PUT" && !claims.admin) return respond({ error: "Forbidden" }, 403);
    if (route.kind === "siteBroadcast" && method === "DELETE") return respond({ error: "Invalid path or method" }, 400);
    if (method === "PUT" && !Object.prototype.hasOwnProperty.call(input, "data")) return respond({ error: "Missing data" }, 400);
    if (route.kind === "siteBroadcast" && method === "PUT") {
      const text = String(input.data?.text || "").trim();
      if (!text || text.length > 2000) return respond({ error: "Invalid broadcast message" }, 400);
    }

    const dbPath = route.id ? (route.kind + "/" + route.id) : route.kind;
    try {
      if (method === "GET") return respond(await firebaseRequest(env, dbPath, "GET"), 200);
      if (method === "DELETE") return respond(await firebaseRequest(env, dbPath, "DELETE"), 200);
      if (route.kind === "siteBroadcast" && method === "PUT") {
        const data = { text: String(input.data.text).trim(), createdAt: Number.isFinite(Number(input.data.createdAt)) ? Number(input.data.createdAt) : Date.now() };
        return respond(await firebaseRequest(env, "siteBroadcast", "PUT", data), 200);
      }
      if (route.kind === "adminMessages" && !route.id) return respond({ error: "Forbidden" }, 403);
      if (route.kind === "adminMessages") {
        const existing = await firebaseRequest(env, dbPath, "GET");
        const sanitized = claims.admin
          ? sanitizeAdminThread(input.data, existing)
          : sanitizeUserThread(input.data, existing, claims);
        return respond(await firebaseRequest(env, dbPath, "PUT", sanitized), 200);
      }
      return respond(await firebaseRequest(env, dbPath, "PUT", input.data), 200);
    } catch (error) {
      if (error?.message === "invalid_thread") return respond({ error: "Invalid message data" }, 400);
      return respond({ error: "Firebase request failed" }, 502);
    }
  }
};

