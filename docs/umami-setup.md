# GMT Umami monitoring

The site includes a cookieless Umami integration point. It loads only when `enabled`, an HTTPS `scriptUrl`, and a `websiteId` are configured in `config.js`.

The website ID is intentionally blank and monitoring is disabled until GMT creates or confirms the Umami project. No analytics credentials or visitor data are stored in this repository.

Owner action: obtain the approved Umami script URL and website ID, confirm the privacy notice/cookie position, set the three values in `config.js`, deploy, then verify a page view from `https://gmt-services.co.uk/` in Umami. Keep staff portal monitoring separate or excluded if required.
