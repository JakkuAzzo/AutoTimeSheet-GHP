# Admin magic-link access and encrypted GitHub storage

## Important security boundary

The public GitHub Pages frontend cannot securely do these tasks on its own:

1. verify an admin identity using one-time email links
2. hold a GitHub write token without exposing it to the browser
3. write employee submissions into the repository safely
4. protect encrypted records so only verified admins can decrypt them

A serverless backend or small Node service is required.

## Required admin addresses

The deployment configuration should allow only the real GMT admin addresses supplied by the business. Keep those in server-side environment variables where possible. The public `config.js` may show a non-secret allow-list, but the backend must enforce the allow-list.

## Recommended architecture

### Public employee flow

1. Employee opens GitHub Pages app.
2. Employee fills in name, week start, daily site/location, description, images, start, finish, lunch yes/no, absent yes/no.
3. App calculates Basic / OT x1.5 / OT x2.0 locally.
4. App submits to FormSubmit for email delivery.
5. App also sends the same payload to a secure API endpoint.

### Secure storage flow

1. API receives the submission.
2. API validates required fields and file sizes.
3. API encrypts the submission with an admin-held key or a KMS-managed key.
4. API commits only encrypted JSON blobs to a private or controlled GitHub path, for example:
   - `encrypted-records/YYYY/MM/<submission-id>.json.enc`
5. No raw employee timesheet data is committed unencrypted.

### Admin access flow

1. Admin enters their email address.
2. API checks the email against the server-side allow-list.
3. API creates a short-lived signed token.
4. API emails a one-time access link.
5. Admin opens the link.
6. Frontend exchanges the token for a short session.
7. Frontend requests encrypted records.
8. API either:
   - decrypts server-side after session verification, or
   - returns encrypted records plus a wrapped key only for verified admin sessions.

## API contract

### POST `/api/submissions`

Receives a timesheet submission.

Expected multipart fields:

- `employee_name`
- `employee_phone`
- `week_start`
- `timesheet_payload`
- `calculated_summary`
- optional image files

The API should store an encrypted record and return a submission id.

### POST `/api/admin/request-link`

Receives:

```json
{
  "email": "admin@example.com"
}
```

The API should return a generic success response whether the email is allowed or not, to avoid leaking the allow-list.

### POST `/api/admin/session`

Receives a one-time token from the access link and returns a short-lived admin session.

### GET `/api/admin/records`

Returns a list of encrypted or decrypted records only for verified admin sessions.

## Encryption recommendation

Use modern authenticated encryption such as AES-256-GCM or XChaCha20-Poly1305. Do not invent a custom crypto scheme.

Each record should include:

```json
{
  "version": 1,
  "createdAt": "2026-06-24T00:00:00.000Z",
  "submissionId": "uuid",
  "algorithm": "AES-256-GCM",
  "ciphertext": "base64",
  "iv": "base64",
  "authTag": "base64"
}
```

## Why not browser-only encryption to GitHub?

A browser-only app would need a GitHub token to commit records. Putting that token into client-side JavaScript would expose it to every visitor. That would allow anyone to write to the repository. Therefore, GitHub writes must go through a backend.
