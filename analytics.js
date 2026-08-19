(() => {
  const analytics = window.GMT_APP_CONFIG?.umami;
  if (!analytics?.enabled || !analytics.websiteId || !analytics.scriptUrl) return;

  let scriptUrl;
  try { scriptUrl = new URL(analytics.scriptUrl, window.location.href); } catch (_) { return; }
  if (scriptUrl.protocol !== 'https:') return;
  if ([...document.scripts].some((script) => script.dataset.websiteId === analytics.websiteId)) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = scriptUrl.href;
  script.dataset.websiteId = analytics.websiteId;
  document.head.appendChild(script);
})();
