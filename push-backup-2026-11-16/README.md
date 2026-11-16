# TEMO Push backup — 2026-11-16

This folder is a safety copy of the working Push notification code for temo1.gr.

Files copied from the live main branch:
- index.html — browser subscription registration and iOS/Android detection
- worker.js — subscription storage and Push broadcast delivery
- temo-notes-sw.js — Push display and notification click handling

Important working changes included:
- Android Web Push subscription is included in broadcasts.
- Push subscription is rechecked after login and on the first user gesture.
- iOS detection does not depend on navigator.vendor.
- Broadcast uses the restored sequential delivery logic.

Source commits:
- Push broadcast / service worker restore: be0e73466ac4d95c2b0cb33bee288f352b44b665 and e5c394f33cb4b0871662faa2938bf380cf48169b
- Login gesture subscription registration: 92f90db308a0d37b62cd2614d375b00d52a53bd3
- iOS browser detection fix: 3484fa3775064f8b858d842c904f59d912197507

Do not edit these backup files when making future changes. Restore from this folder if the live Push code is accidentally changed.
