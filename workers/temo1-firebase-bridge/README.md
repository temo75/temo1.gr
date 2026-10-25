# Firebase Bridge

This directory contains a separate source entry point for the `temo1-firebase-bridge` Worker. It intentionally does not use the repository root `worker.js` or root `wrangler.toml`, which target `temo-ai`.

The bridge keeps the existing site username/password login flow. It authenticates the submitted credentials against the server-side Firebase `/users` data, returns a short-lived HMAC-signed session, and never returns account passwords. Subsequent `adminMessages` operations require that session. A user can access only their own thread; the canonical `TEMO` account can read the inbox and write replies. User writes cannot forge administrator replies, and administrator writes cannot alter the user's message text.

Required Worker bindings are the existing `FIREBASE_EMAIL`, `FIREBASE_PASSWORD`, and `SESSION_SECRET`. The Worker fails closed if `SESSION_SECRET` is missing or shorter than 32 UTF-8 bytes. The Firebase sign-in API key is retained from the existing Worker source.

Run the mocked checks from this directory with:

```sh
node --test *.test.mjs
```

These tests do not connect to Firebase or production. Before deployment, test against a separate Firebase project or dedicated test records, verify the configured secret strength without displaying its value, and confirm the existing administrator record can authenticate. No deployment is performed by this change.
