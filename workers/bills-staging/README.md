# Isolated bills staging backend

This directory is reserved for a new, separate Worker. It must never use the production `DEI_KV` namespace or production OAuth callback.

## Required before enabling live Gmail
- A distinct Cloudflare Worker name (suggested: `temo-bills-staging`).
- A distinct staging KV namespace for temporary OAuth state and test sessions, OR a verified server-only Firestore adapter after project access and rules are confirmed.
- Separate staging Google OAuth redirect URI registered in Google Cloud.
- Worker secrets configured in the dashboard; no secrets in source control.
- A staging account/owner allowlist and a clear consent flow.
- Gmail API scope limited to `gmail.readonly`.
- No access to production billing records and no writes to production Firebase collections.

## Current status
Not deployable as a live Gmail service yet. The current repository does not expose verified Firebase project credentials or Firestore rules, and production KV has not been exported. Keep the existing UI marked DEMO until these prerequisites are completed.
