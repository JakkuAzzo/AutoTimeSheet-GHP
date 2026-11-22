# Verified Worker runtime reference

This branch preserves a runtime bundle and patch for the deployed timesheet
ownership enforcement. It is an evidence and recovery reference, not the
editable source implementation and not a production release.

- `worker-runtime-v2.mjs` is the captured runtime module whose SHA-256 is
  `2a72766f460e4f61f09646cbc2d22ad7ff42b85fdd3fa10234e6f502c8c49409`.
- `access-candidate-v2.patch` is the diff against the preceding captured
  production module, SHA-256
  `97858bb28c2ee8a9f1ec91b1632a281f1c9d6efee72da764b1ccd67e2f3bc147`.
  That baseline already includes the ownership review foundation.
- The module alone does not capture configuration, provider connections,
  database migrations, or publication permissions. The production dispatcher
  was disabled when the runtime was verified.

Do not point the production deploy workflow at this bundle or merge this branch
as a substitute for source integration. The existing editable Worker and
deployment configuration must first be reconciled with the live runtime,
reviewed migrations, and current bindings, then verified before deploying.
This reference contains no employee records, attachments, credentials, or
workbook data.
