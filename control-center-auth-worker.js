/**
 * TEMO CONTROL CENTER — isolated authentication Worker
 *
 * Deploy as a NEW Cloudflare Worker. Do not replace worker.js.
 * Required Worker secrets/variables:
 *   FIREBASE_WEB_API_KEY  — Firebase Web API key (not a private server key)
 *   ADMIN_EMAIL           — exact email allowed into the control center
 *
 * Prerequisite: that email must be an email/password account in Firebase Authentication
 * and the email must be verified. The existing temo1.gr localStorage/Realtime Database
 * account list is NOT Firebase Authentication and cannot be trusted for admin access.
 *
 * This Worker intentionally provides authentication only. It does not grant project
 * management actions until each action has its own server-side authorization check.
 */
const ALLOWED_ORIGINS = new Set([
  "https://temo1.gr",
  "https://www.temo1.gr"
]);

function response(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

async function firebaseLookup(idToken, apiKey) {
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!r.ok) return null;
  const data = await r.json();
  return Array.isArray(data.users) ? data.users[0] || null : null;
}

function isAllowedAdmin(user, env) {
  return Boolean(
    user &&
    user.email &&
    user.emailVerified === true &&
    String(user.email).trim().toLowerCase() === String(env.ADMIN_EMAIL || "").trim().toLowerCase()
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return response({}, 204, origin);

    if (!env.FIREBASE_WEB_API_KEY || !env.ADMIN_EMAIL) {
      return response({ ok: false, error: "Admin authentication is not configured" }, 503, origin);
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      let body;
      try { body = await request.json(); } catch { return response({ ok: false, error: "Invalid request" }, 400, origin); }

      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password || email !== String(env.ADMIN_EMAIL).trim().toLowerCase()) {
        return response({ ok: false, error: "Email or password is incorrect" }, 401, origin);
      }

      const r = await fetch(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(env.FIREBASE_WEB_API_KEY),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true })
        }
      );
      const auth = await r.json().catch(() => ({}));
      if (!r.ok || !auth.idToken) return response({ ok: false, error: "Email or password is incorrect" }, 401, origin);

      const user = await firebaseLookup(auth.idToken, env.FIREBASE_WEB_API_KEY);
      if (!isAllowedAdmin(user, env)) {
        return response({ ok: false, error: "Verified administrator account required" }, 403, origin);
      }

      return response({
        ok: true,
        idToken: auth.idToken,
        refreshToken: auth.refreshToken,
        expiresIn: auth.expiresIn,
        email: user.email
      }, 200, origin);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/check") {
      const authHeader = request.headers.get("Authorization") || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) return response({ ok: false, error: "Unauthorized" }, 401, origin);

      const user = await firebaseLookup(match[1], env.FIREBASE_WEB_API_KEY);
      if (!isAllowedAdmin(user, env)) return response({ ok: false, error: "Unauthorized" }, 401, origin);
      return response({ ok: true, email: user.email, role: "admin" }, 200, origin);
    }

    return response({ ok: false, error: "Not found" }, 404, origin);
  }
};
