(function () {
  function refreshMapSize() {
    if (!window.gmtMap) return;
    setTimeout(function () {
      window.gmtMap.invalidateSize();
    }, 150);
    setTimeout(function () {
      window.gmtMap.invalidateSize();
    }, 500);
  }

  function initWorkshopMap() {
    var el = document.getElementById('workshopMap');
    if (!el || !window.L) return;

    var location = [51.3859, -0.0893];
    var map = window.L.map(el, {
      center: location,
      zoom: 16,
      attributionControl: true,
      scrollWheelZoom: false,
      dragging: true,
      tap: true
    });
    map.attributionControl.setPrefix(false);
    window.gmtMap = map;

    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    var pinIcon = window.L.divIcon({
      className: '',
      html: '<span class="gmt-map-pin" aria-hidden="true"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    window.L.marker(location, {
      icon: pinIcon,
      keyboard: false
    })
      .addTo(map)
      .bindPopup('GMT Electrical Services<br>93-95 Gloucester Rd, Croydon CR0 2DN');

    refreshMapSize();
  }

  function initServiceCarousel() {
    var root = document.querySelector('[data-service-carousel]');
    if (!root) return;

    var track = root.querySelector('.service-grid');
    var slides = Array.prototype.slice.call(root.querySelectorAll('.service-card'));
    var prev = root.querySelector('[data-service-prev]');
    var next = root.querySelector('[data-service-next]');
    var dotsWrap = root.querySelector('[data-service-dots]');
    if (!track || !slides.length || !prev || !next || !dotsWrap) return;

    var index = 0;
    var startX = null;

    function setIndex(nextIndex) {
      index = (nextIndex + slides.length) % slides.length;
      track.style.setProperty('--service-index', index);

      slides.forEach(function (slide, slideIndex) {
        slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
      });

      Array.prototype.forEach.call(dotsWrap.querySelectorAll('.service-dot'), function (dot, dotIndex) {
        var isActive = dotIndex === index;
        dot.classList.toggle('is-active', isActive);
        dot.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
    }

    slides.forEach(function (_slide, slideIndex) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'service-dot';
      dot.setAttribute('aria-label', 'Show service ' + (slideIndex + 1));
      dot.addEventListener('click', function () {
        setIndex(slideIndex);
      });
      dotsWrap.appendChild(dot);
    });

    prev.addEventListener('click', function () {
      setIndex(index - 1);
    });

    next.addEventListener('click', function () {
      setIndex(index + 1);
    });

    track.addEventListener('touchstart', function (event) {
      if (!event.touches || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
    }, { passive: true });

    track.addEventListener('touchend', function (event) {
      if (startX === null || !event.changedTouches || !event.changedTouches.length) return;
      var deltaX = event.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(deltaX) < 45) return;
      setIndex(deltaX < 0 ? index + 1 : index - 1);
    }, { passive: true });

    window.addEventListener('resize', function () {
      setTimeout(function () {
        setIndex(index);
      }, 150);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        setIndex(index);
      }, 250);
    });
    window.addEventListener('pageshow', function () {
      setIndex(index);
    });

    setIndex(0);
  }

  function initContentCarousel() {
    var root = document.querySelector('[data-content-carousel]');
    if (!root) return;

    var panels = Array.prototype.slice.call(root.querySelectorAll('.content-carousel-panel'));
    var previous = root.querySelector('[data-content-prev]');
    var next = root.querySelector('[data-content-next]');
    var page = root.querySelector('[data-content-page]');
    if (!panels.length || !previous || !next) return;

    var index = 0;

    function setIndex(nextIndex, updateHash) {
      index = (nextIndex + panels.length) % panels.length;
      panels.forEach(function (panel, panelIndex) {
        var active = panelIndex === index;
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
        panel.classList.toggle('is-active', active);
      });
      if (page) page.textContent = 'Page ' + (index + 1) + ' of ' + panels.length;
      if (updateHash) history.replaceState(null, '', '#' + panels[index].id);
    }

    previous.addEventListener('click', function () {
      setIndex(index - 1, true);
    });
    next.addEventListener('click', function () {
      setIndex(index + 1, true);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-carousel-target]'), function (link) {
      link.addEventListener('click', function (event) {
        var targetIndex = Number(link.getAttribute('data-carousel-target'));
        if (!Number.isInteger(targetIndex) || !panels[targetIndex]) return;
        event.preventDefault();
        setIndex(targetIndex, true);
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    setIndex(0, false);
  }

  function initContactModal() {
    var modal = document.querySelector('[data-contact-modal]');
    var openButton = document.querySelector('[data-contact-open]');
    var closeButtons = modal ? modal.querySelectorAll('[data-contact-close]') : [];
    var form = modal ? modal.querySelector('[data-contact-form]') : null;
    var status = modal ? modal.querySelector('[data-contact-status]') : null;
    if (!modal || !openButton || !form) return;

    var lastFocus = null;

    function close() {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus) lastFocus.focus();
    }

    openButton.addEventListener('click', function () {
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('modal-open');
      var firstField = form.querySelector('input:not([type="hidden"])');
      if (firstField) firstField.focus();
    });

    Array.prototype.forEach.call(closeButtons, function (button) {
      button.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) close();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!status) return;
      var endpoint = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.contactFormSubmitEndpoint;
      if (!endpoint) {
        status.textContent = 'The contact form is not configured yet. Please call the workshop.';
        return;
      }

      var submitButton = form.querySelector('button[type="submit"]');
      var formData = new FormData(form);
      formData.set('_replyto', formData.get('email') || '');
      if (submitButton) submitButton.disabled = true;
      status.textContent = 'Sending your enquiry…';

      try {
        var response = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: formData
        });
        if (!response.ok) throw new Error('Contact request failed');
        form.reset();
        status.textContent = 'Thanks — your enquiry has been sent to GMT Electrical Services.';
      } catch (_error) {
        status.textContent = 'We could not send the form. Please call 0208 683 0464 instead.';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  function initRevealAnimations() {
    var targets = document.querySelectorAll(
      '.hero-copy, .quick-panel, .section-heading, .service-card, .workshop-photo, .workshop-motion-content, .about-band > *, .contact-card > *'
    );
    if (!targets.length) return;

    Array.prototype.forEach.call(targets, function (element, index) {
      element.classList.add('reveal');
      element.style.setProperty('--reveal-delay', Math.min(index % 6, 5) * 70 + 'ms');
    });

    var reveal = function (element) {
      element.classList.add('is-visible');
    };

    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(targets, reveal);
      return;
    }

    var observer = new IntersectionObserver(function (entries, currentObserver) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        currentObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    Array.prototype.forEach.call(targets, function (element) {
      observer.observe(element);
    });
  }

  function initPublicHomepage() {
    initWorkshopMap();
    initServiceCarousel();
    initContentCarousel();
    initContactModal();
    initRevealAnimations();
  }

  window.addEventListener('resize', refreshMapSize);
  window.addEventListener('orientationchange', refreshMapSize);
  window.addEventListener('pageshow', refreshMapSize);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPublicHomepage);
  } else {
    initPublicHomepage();
  }
})();
