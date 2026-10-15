(function () {
  'use strict';

  var targetSelector = '[data-scroll-reveal]';
  var observedTargets = new WeakSet();
  var revealObserver = null;
  var observerUnavailable = typeof window.IntersectionObserver !== 'function';
  var navResizeObserver = null;
  var navResizeListenerAdded = false;
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

    if (typeof window.ResizeObserver === 'function') {
      if (!navResizeObserver) {
        navResizeObserver = new window.ResizeObserver(syncNavOffset);
        navResizeObserver.observe(nav);
        var siteHeader = document.querySelector('.site-header');
        if (siteHeader) navResizeObserver.observe(siteHeader);
      }
    } else if (!navResizeListenerAdded) {
      navResizeListenerAdded = true;
      window.addEventListener('resize', syncNavOffset, { passive: true });
    }
  }

  function showAll(root) {
    targetsWithin(root).forEach(reveal);
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

  function init(root) {
    syncNavOffset();

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
        if (observedTargets.has(target)) return;
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
  initPublicSnapActivation();
  window.GMTViewportEffects = { init: init };
  init(document);
})();
