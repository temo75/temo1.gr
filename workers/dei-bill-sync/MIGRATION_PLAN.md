# DEI / NOVA storage migration plan (no-live-change)

## Current production state
- Worker: `dei-bill-sync`
- Current storage binding: `DEI_KV`
- KV namespace: `DEI_BILL_STORE` (existing records must remain untouched)
- Firebase project known from prior project context: `temo-75`
- OAuth callback: `https://dei-bill-sync.temo75elia.workers.dev/oauth/callback`
- Gmail refresh tokens, OAuth/session state, DEI bill history, NOVA bill history and sync timestamps currently share the Worker KV binding.

## Non-negotiable safeguards
1. Do not change `main`, production Worker settings, DNS/routes, Cron, OAuth redirect URI, or secrets during preparation.
2. Do not delete or overwrite any existing KV key.
3. Do not migrate OAuth refresh tokens as ordinary plaintext Firestore documents.
4. Do not switch reads/writes to Firestore until Firestore security rules, server-side authentication, a complete data export, and verification counts are proven.
5. Keep DEI and NOVA data logically separated by owner and prefix, preserving current identifiers and fields.
6. Do not deploy or merge this branch until staging tests and a rollback procedure pass.

## Migration stages
1. Inventory Worker routes and all KV key prefixes; determine which records are persistent business data vs short-lived OAuth/session state.
2. Verify the existing Firebase project `temo-75`, Firestore database location, access model, billing/usage status, and whether Firestore is already used by T1. Do not create a second database or change other apps.
3. Build a server-only Firestore adapter using Cloudflare Worker secrets for credentials. Never put service-account credentials or private keys in client code or this repository.
4. Export all KV business records to a protected local artifact, including DEI bills, latest-bill pointers, NOVA invoices/receipts, payment matching fields, and timestamps. Validate counts and representative records before import.
5. Import to a separate staging collection namespace; use idempotent document IDs and preserve original KV keys as migration metadata.
6. Compare source and destination counts, totals, owner separation, invoice/payment statuses, and sample records. Test Gmail OAuth, token refresh, DEI sync, NOVA sync, session exchange, and scheduled sync in staging.
7. Only after explicit validation, implement a reversible read/write cutover. Keep the old KV data intact throughout the observation period.
8. Roll back by switching the Worker back to the previous code/version; do not delete either store during rollback.

## Current blocker
This repository does not contain a Firebase configuration or Firestore rules file, and the existing Worker uses KV directly throughout its OAuth and sync flows. A safe migration therefore needs verified access to the existing Firebase project and a complete source-data export before changing runtime code. No production behavior is changed by this document.
