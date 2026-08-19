# GMT Website Migration / Hosting Status

Checked 10 August 2026. Read-only evidence collection; no DNS, hosting,
WordPress, mail, or production configuration changes were made.

## Current live providers

| Surface | Current state | Evidence |
| --- | --- | --- |
| Public domain | `https://gmt-services.co.uk/` returns HTTP 200 | Cloudflare response headers; `server: cloudflare` |
| `www` hostname | HTTP 301 to the apex URL | `x-redirect-by: WordPress`; Cloudflare response headers |
| Public website origin/platform | WordPress on WP Engine behind Cloudflare | `x-powered-by: WP Engine`; WordPress REST and sitemap endpoints |
| Staff portal reference | GitHub Pages at `https://jakkuazzo.github.io/AutoTimeSheet-GHP/` | GitHub response headers; HTTP 200 |
| Domain DNS | Cloudflare nameservers are authoritative | Current DNS evidence is tracked in the mail/DNS migration reports; no website records changed in this check |

## Website checks

Confirmed by read-only requests:

- HTTPS works on the apex and `www` hostnames.
- `www` canonicalises to `https://gmt-services.co.uk/`.
- `robots.txt` returns HTTP 200 and points to `https://gmt-services.co.uk/wp-sitemap.xml`.
- `sitemap.xml` returns HTTP 200 with WordPress post/page/taxonomy sitemap links.
- The homepage exposes a canonical URL, page description, telephone link,
  email link, workshop address, service content, map link and Staff Portal
  link.
- The homepage exposes a live Forminator contact form with required name and
  email fields and a 180-character message limit. No form was submitted.
- The GitHub Pages homepage returns HTTP 200 with public navigation and the
  Staff Portal link.

## Migration decision

The current WordPress/WP Engine site remains live. Export-versus-rebuild is
undecided because the following evidence is not present:

- bOnline staging URL;
- complete website export or backup package;
- media/database/configuration inventory;
- documented theme/plugin/page-builder changes;
- form delivery test evidence;
- DNS/SSL cutover plan and rollback owner;
- post-launch maintenance and access handover.

bOnline correspondence records a website export price of £300 + VAT and a
30-day cancellation notice. Neither fact authorises cancellation or a live
replacement.

## Required acceptance evidence before replacement or cancellation

1. Company owner approves export or rebuild and names the rollback owner.
2. Export or replacement is stored in restricted GMT-controlled storage and
   opens/restores successfully.
3. Staging review passes desktop and iPhone/Safari mobile checks, including
   no horizontal overflow, readable typography, tappable contact actions,
   correct logo/images, map/address, keyboard focus and meaningful alt text.
4. Public pages have working canonical metadata, robots/sitemap, redirects,
   SSL, contact form delivery and privacy/cookie requirements.
5. Staff Portal remains a limited private link and exposes no internal records.
6. DNS/SSL change plan includes exact records, TTL/propagation checks,
   maintenance window, monitoring and rollback instructions. Mail records are
   outside this website replacement gate and must not be changed as part of a
   website cutover.
7. bOnline supplies maintenance access, provider ownership, backup/restore
   method and cancellation timing in writing.

## Current blockers and next owner

- **bOnline / website provider — blocked:** provide staging/export,
  maintenance access, backup and rollback evidence.
- **GMT business owner — approval needed:** choose £300 + VAT export or a
  separately funded rebuild; approve cancellation timing only after acceptance.
- **GMT developer — ready:** review any staging/export package, run the
  acceptance matrix, and keep the current site live until sign-off.
