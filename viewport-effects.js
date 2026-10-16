(function () {
  'use strict';

  var targetSelector = '[data-scroll-reveal]';
  var observedTargets = new WeakSet();
  var revealObserver = null;
  var observerUnavailable = typeof window.IntersectionObserver !== 'function';
  var navResizeObserver = null;
  var navResizeListenerAdded = false;
  var portalTabsResizeObserver = null;
  var portalHeaderResizeObserver = null;
  var portalResizeListenerAdded = false;
  var readyAttribute = 'data-viewport-effects-ready';

  function setReady() {
    document.documentElement.setAttribute(readyAttribute, 'true');
  }

  function reveal(target) {
    if (target && target.classList) target.classList.add('is-visible');
  }

  function targetsWithin(root) {
    var scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return [];

    var targets = [];
    if (scope.nodeType === 1 && typeof scope.matches === 'function' && scope.matches(targetSelector)) {
      targets.push(scope);
    }
    return targets.concat(Array.prototype.slice.call(scope.querySelectorAll(targetSelector)));
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function syncNavOffset() {
    var nav = document.querySelector('.site-nav-bar');
    if (!nav) return;

    var height = nav.getBoundingClientRect().height || nav.offsetHeight;
    if (height > 0) {
      var header = document.querySelector('.site-header');
      var headerHeight = header ? (header.getBoundingClientRect().height || header.offsetHeight) : 0;
      document.documentElement.style.setProperty('--gmt-scroll-offset', height + 'px');
      document.documentElement.style.setProperty('--gmt-page-top-height', (height + headerHeight) + 'px');
    }

    var firstPanel = document.querySelector('main [data-scroll-snap]');
    if (firstPanel && window.scrollY < 2 && document.documentElement.getAttribute('data-public-scroll-snap-ready') !== 'true') {
      firstPanel.setAttribute('data-public-first-snap', 'true');
      var firstPanelTop = Math.max(0, firstPanel.getBoundingClientRect().top);
      document.documentElement.style.setProperty('--gmt-public-first-section-offset', firstPanelTop + 'px');
    }

    if (!navResizeListenerAdded) {
      navResizeListenerAdded = true;
      window.addEventListener('resize', syncNavOffset, { passive: true });
    }

    if (typeof window.ResizeObserver === 'function') {
      if (!navResizeObserver) {
        navResizeObserver = new window.ResizeObserver(syncNavOffset);
        navResizeObserver.observe(nav);
        var siteHeader = document.querySelector('.site-header');
        if (siteHeader) navResizeObserver.observe(siteHeader);
      }
    }
  }

  function syncPortalTabsOffset() {
    var tabs = document.querySelector('.portal-tabs');
    var header = document.querySelector('.portal-header, .app-header');
    var portalAuthScript = Array.prototype.some.call(document.scripts, function (script) {
      return /(?:^|\/)portal\/auth\.js(?:[?#]|$)/.test(script.getAttribute('src') || '');
    });
    var historyFrame = document.body && document.body.classList.contains('portal-history-frame-body');
    if (!header && !portalAuthScript && !historyFrame) return;
    if (!header && portalAuthScript) header = document.querySelector('header');

    document.documentElement.setAttribute('data-portal-viewport-shell', 'true');

    var headerHeight = header ? (header.getBoundingClientRect().height || header.offsetHeight) : 0;
    if (headerHeight > 0) document.documentElement.style.setProperty('--gmt-portal-header-height', headerHeight + 'px');

    if (tabs) {
      var height = tabs.getBoundingClientRect().height || tabs.offsetHeight;
      if (height > 0) document.documentElement.style.setProperty('--gmt-portal-tabs-height', height + 'px');
    }

    if (typeof window.ResizeObserver === 'function') {
      if (header && !portalHeaderResizeObserver) {
        portalHeaderResizeObserver = new window.ResizeObserver(syncPortalTabsOffset);
        portalHeaderResizeObserver.observe(header);
      }
      if (tabs && !portalTabsResizeObserver) {
        portalTabsResizeObserver = new window.ResizeObserver(syncPortalTabsOffset);
        portalTabsResizeObserver.observe(tabs);
      }
    } else if (!portalResizeListenerAdded) {
      portalResizeListenerAdded = true;
      window.addEventListener('resize', syncPortalTabsOffset, { passive: true });
    }
  }

  function showAll(root) {
    targetsWithin(root).forEach(reveal);
  }

  function isInHiddenTree(target) {
    for (var node = target; node && node !== document.documentElement; node = node.parentElement) {
      if (node.hidden) return true;
    }
    return false;
  }

  function initPublicSnapActivation() {
    if (!document.querySelector('.site-nav-bar')) return;

    var enabled = false;
    function enable() {
      if (enabled) return;
      enabled = true;
      document.documentElement.setAttribute('data-public-scroll-snap-ready', 'true');
    }

    window.addEventListener('wheel', enable, { passive: true, once: true });
    window.addEventListener('touchstart', enable, { passive: true, once: true });
    window.addEventListener('keydown', function (event) {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].indexOf(event.key) !== -1) enable();
    }, true);
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;

      var target = new URL(link.href, window.location.href);
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.hash) enable();
    }, true);
  }

  function initPortalSnapActivation() {
    if (!document.documentElement.classList.contains('portal-dashboard-document')) return;

    var dashboard = document.querySelector('.portal-dashboard-main');
    if (!dashboard) return;
    if (!dashboard.querySelector('[data-scroll-snap]')) return;

    var enabled = false;
    function enable() {
      if (enabled) return;
      enabled = true;
      dashboard.setAttribute('data-portal-scroll-snap-ready', 'true');
      window.removeEventListener('wheel', enable);
      window.removeEventListener('touchstart', enable);
      window.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('click', onLinkClick, true);
    }
    function onKeydown(event) {
      var target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].indexOf(event.key) !== -1) enable();
    }
    function onLinkClick(event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;

      var target = new URL(link.href, window.location.href);
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.hash) enable();
    }

    window.addEventListener('wheel', enable, { passive: true, once: true });
    window.addEventListener('touchstart', enable, { passive: true, once: true });
    window.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', onLinkClick, true);
  }

  function init(root) {
    syncNavOffset();
    syncPortalTabsOffset();

    var targets = targetsWithin(root || document);
    if (!targets.length) {
      setReady();
      return;
    }

    if (prefersReducedMotion() || observerUnavailable) {
      showAll(root || document);
      setReady();
      return;
    }

    try {
      if (!revealObserver) {
        revealObserver = new window.IntersectionObserver(function (entries, observer) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            reveal(entry.target);
            observer.unobserve(entry.target);
          });
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
      }

      targets.forEach(function (target) {
        if (observedTargets.has(target) || isInHiddenTree(target)) return;
        revealObserver.observe(target);
        observedTargets.add(target);
      });
      setReady();
    } catch (_error) {
      observerUnavailable = true;
      if (revealObserver) revealObserver.disconnect();
      revealObserver = null;
      showAll(document);
      setReady();
    }
  }

  syncNavOffset();
  syncPortalTabsOffset();
  initPublicSnapActivation();
  initPortalSnapActivation();
  window.GMTViewportEffects = { init: init };
  init(document);
})();
