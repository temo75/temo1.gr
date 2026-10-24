# DEI / NOVA isolated staging area

This folder is reserved for the new experimental bills page.

Safety rules:
- This staging page must not replace or modify the production DEI/NOVA pages.
- It must not write to production KV, Firebase collections, or production billing records.
- No Gmail access tokens, refresh tokens, OAuth grants, or session tokens may be stored in browser code or committed to GitHub.
- The UI may use clearly labelled sample/demo records until a separately configured staging backend is available.
- Real Gmail integration must use a separate staging Worker and explicit OAuth configuration, and must never point to production KV or overwrite existing records.
- Do not merge this branch into main until tests pass and the user explicitly approves cutover.

The existing production Worker uses Cloudflare KV directly for OAuth, session management, DEI bill history, and NOVA bill history. A real end-to-end test page therefore requires an isolated backend, not just a new HTML page.
