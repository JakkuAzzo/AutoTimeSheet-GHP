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

  function initPublicNextSectionControl() {
    if (!document.querySelector('.site-nav-bar')) return;

    var main = document.querySelector('main');
    if (!main) return;

    var sections = Array.prototype.slice.call(main.querySelectorAll('[data-scroll-snap]')).filter(function (section) {
      return !section.parentElement || !section.parentElement.closest('[data-scroll-snap]');
    });
    if (sections.length < 2) return;

    var control = document.createElement('button');
    control.type = 'button';
    control.className = 'public-next-section-control';
    control.dataset.nextSectionControl = '';
    control.hidden = true;

    var text = document.createElement('span');
    var arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↓';
    control.appendChild(text);
    control.appendChild(arrow);
    document.body.appendChild(control);

    function sectionLabel(section) {
      var explicitLabel = section.getAttribute('data-section-navigation-label');
      if (explicitLabel && explicitLabel.trim()) return explicitLabel.trim();

      var labelledBy = section.getAttribute('aria-labelledby');
      if (labelledBy) {
        var labelNode = document.getElementById(labelledBy.trim().split(/\s+/)[0]);
        if (labelNode && labelNode.textContent.trim()) return labelNode.textContent.replace(/\s+/g, ' ').trim();
      }

      var heading = section.querySelector('h1, h2, h3');
      if (heading && heading.textContent.trim()) {
        return heading.textContent.replace(/\s+/g, ' ').trim().replace(/^\d+[.)]\s*/, '');
      }

      return (section.getAttribute('aria-label') || 'Next section').replace(/\s+/g, ' ').trim();
    }

    function currentSectionIndex() {
      var midpoint = window.innerHeight / 2;
      var closestIndex = 0;
      var closestDistance = Infinity;

      for (var index = 0; index < sections.length; index += 1) {
        var rect = sections[index].getBoundingClientRect();
        if (rect.top <= midpoint && rect.bottom >= midpoint) return index;

        var distance = midpoint < rect.top ? rect.top - midpoint : midpoint - rect.bottom;
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      }

      return closestIndex;
    }

    var currentNavigationSection = null;
    var nextSectionIndex = null;
    var navigationTargetIndex = null;
    var navigationInProgress = false;
    var finalNavigationCompleted = false;
    var navigationEndTimer = null;
    var originalScrollSnapType = null;
    function clearNavigationClearance(section) {
      if (!section) return;
      section.classList.remove('public-next-section-current');
      section.style.removeProperty('--public-next-section-original-padding');
      section.style.removeProperty('--public-next-section-clearance');
    }

    function update() {
      var activeSectionIndex = currentSectionIndex();
      var documentHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var finalSectionIndex = sections.length - 1;
      var finalSectionRect = sections[finalSectionIndex].getBoundingClientRect();
      var finalSectionAtDocumentEnd = window.scrollY + window.innerHeight >= documentHeight - 1
        && finalSectionRect.top < window.innerHeight
        && finalSectionRect.bottom > 0;
      if (finalNavigationCompleted && !finalSectionAtDocumentEnd) finalNavigationCompleted = false;
      if (finalNavigationCompleted) activeSectionIndex = finalSectionIndex;
      var activeSection = sections[activeSectionIndex];
      if (currentNavigationSection && currentNavigationSection !== activeSection) clearNavigationClearance(currentNavigationSection);
      currentNavigationSection = activeSection;

      var nextSection = sections[activeSectionIndex + 1];
      if (!nextSection) {
        if (!navigationInProgress) {
          nextSectionIndex = null;
          control.hidden = true;
          control.disabled = false;
          clearNavigationClearance(activeSection);
        } else {
          control.disabled = true;
        }
        return;
      }

      if (!navigationInProgress) {
        nextSectionIndex = activeSectionIndex + 1;
        var label = 'Next Section: ' + sectionLabel(nextSection);
        control.setAttribute('aria-label', label);
        text.textContent = label;
        control.hidden = false;
      }
      control.disabled = navigationInProgress;

      if (!activeSection.classList.contains('public-next-section-current')) {
        activeSection.style.setProperty('--public-next-section-original-padding', window.getComputedStyle(activeSection).paddingBlockEnd);
      }
      activeSection.classList.add('public-next-section-current');
      var controlRect = control.getBoundingClientRect();
      var sectionRect = activeSection.getBoundingClientRect();
      var sectionStyle = window.getComputedStyle(activeSection);
      var sectionUsesInternalScroll = activeSection.scrollHeight > activeSection.clientHeight && /^(auto|scroll)$/.test(sectionStyle.overflowY);
      var internalScrollViewportOverflow = sectionUsesInternalScroll ? Math.max(0, sectionRect.bottom - window.innerHeight) : 0;
      var clearance = Math.ceil(controlRect.height + Math.max(0, window.innerHeight - controlRect.bottom) + 12 + internalScrollViewportOverflow);
      activeSection.style.setProperty('--public-next-section-clearance', clearance + 'px');
    }

    var updateQueued = false;
    function scheduleUpdate() {
      if (updateQueued) return;
      updateQueued = true;
      window.requestAnimationFrame(function () {
        updateQueued = false;
        update();
      });
    }

    function finishNavigation() {
      if (!navigationInProgress) return;
      var completedTargetIndex = navigationTargetIndex;
      navigationInProgress = false;
      if (navigationEndTimer !== null) {
        window.clearTimeout(navigationEndTimer);
        navigationEndTimer = null;
      }
      if (originalScrollSnapType !== null) {
        if (originalScrollSnapType.value) {
          document.documentElement.style.setProperty('scroll-snap-type', originalScrollSnapType.value, originalScrollSnapType.priority);
        } else {
          document.documentElement.style.removeProperty('scroll-snap-type');
        }
        originalScrollSnapType = null;
      }
      var documentHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var finalSectionIndex = sections.length - 1;
      var finalSectionRect = sections[finalSectionIndex].getBoundingClientRect();
      finalNavigationCompleted = completedTargetIndex === finalSectionIndex
        && window.scrollY + window.innerHeight >= documentHeight - 1
        && finalSectionRect.top < window.innerHeight
        && finalSectionRect.bottom > 0;
      navigationTargetIndex = null;
      update();
    }

    function scheduleNavigationFinish() {
      if (!navigationInProgress) return;
      if (navigationEndTimer !== null) window.clearTimeout(navigationEndTimer);
      navigationEndTimer = window.setTimeout(finishNavigation, 180);
    }

    control.addEventListener('click', function () {
      if (navigationInProgress) return;
      if (nextSectionIndex === null) return;
      navigationTargetIndex = nextSectionIndex;
      var nextSection = sections[navigationTargetIndex];
      if (!nextSection) return;
      finalNavigationCompleted = false;
      navigationInProgress = true;
      control.disabled = true;
      if (navigationEndTimer !== null) window.clearTimeout(navigationEndTimer);
      navigationEndTimer = window.setTimeout(finishNavigation, 250);
      document.documentElement.setAttribute('data-public-scroll-snap-ready', 'true');
      originalScrollSnapType = {
        value: document.documentElement.style.getPropertyValue('scroll-snap-type'),
        priority: document.documentElement.style.getPropertyPriority('scroll-snap-type')
      };
      document.documentElement.style.setProperty('scroll-snap-type', 'none');
      if (!nextSection.hasAttribute('tabindex')) nextSection.setAttribute('tabindex', '-1');
      nextSection.focus({ preventScroll: true });
      nextSection.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    window.addEventListener('scroll', function () {
      scheduleUpdate();
      scheduleNavigationFinish();
    }, { passive: true });
    window.addEventListener('scrollend', finishNavigation, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    update();
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
  initPublicNextSectionControl();
  initPortalSnapActivation();
  window.GMTViewportEffects = { init: init };
  init(document);
})();
