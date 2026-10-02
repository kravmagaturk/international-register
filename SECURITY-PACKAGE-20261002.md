# KMT Security Package — 2026-10-02

Reference: BND security branch for the `panel kmt düzenleme` conversation.

Rollback tag: `rollback-before-security-package-20261002`

## Scope

- Move student PIN verification away from direct public Firebase reads.
- Apply server-side limits per IP/register number and per register number.
- Restrict `securityLogs` writes to the authorized administrator.
- Preserve the existing Google popup login and session persistence behavior.
- Remove legacy public download packages only after the new package store is populated and verified.

## Deployment order

1. Create the Cloudflare KV namespace and D1 rate-limit database.
2. Deploy `kmt-register-access` and initialize its D1 schema.
3. Publish the admin/public client integration.
4. Sign in once as administrator to migrate current student packages.
5. Verify migrated package count.
6. Deploy the hardened Firebase rules and remove legacy package data.

Do not deploy the restrictive Firebase rule before step 5.
