(function () {
  var KNOWN_BLOCKED_FORM_EMAILS = ['tickettm2019@gmail.com'];

  function normaliseFormEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function prepareProtectedForm(form) {
    if (!form || form.dataset.protectionReady === 'true') return;
    form.dataset.protectionReady = 'true';
    form.dataset.formStartedAt = String(Date.now());
    var confirmationField = form.querySelector('[data-email-confirmation]');
    if (confirmationField) {
      confirmationField.addEventListener('input', function () {
        confirmationField.setCustomValidity('');
      });
    }
    form.addEventListener('input', function () {
      form.dataset.lastInteractionAt = String(Date.now());
    });
  }

  function validateProtectedForm(form) {
    prepareProtectedForm(form);
    var honey = form.querySelector('[name="_honey"]');
    if (honey && honey.value.trim()) return 'We could not verify this submission. Please try again.';

    var emailField = form.querySelector('[name="email"]');
    var confirmationField = form.querySelector('[data-email-confirmation]');
    var email = normaliseFormEmail(emailField && emailField.value);
    var confirmation = normaliseFormEmail(confirmationField && confirmationField.value);
    if (!email || !confirmation || email !== confirmation) {
      if (confirmationField) confirmationField.setCustomValidity('Email addresses must match.');
      return 'Please make sure both email fields match.';
    }
    if (confirmationField) confirmationField.setCustomValidity('');
    if (KNOWN_BLOCKED_FORM_EMAILS.indexOf(email) !== -1) {
      return 'This email address could not be verified. Please use another address.';
    }

    var startedAt = Number(form.dataset.formStartedAt || 0);
    if (startedAt && Date.now() - startedAt < 1200) {
      return 'Please take a moment to complete the form and try again.';
    }
    return '';
  }

  function enquiryRecordId(form) {
    if (form && form.dataset.enquiryRecordId) return form.dataset.enquiryRecordId;
    var suffix = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    var value = 'enquiry-' + suffix;
    if (form) form.dataset.enquiryRecordId = value;
    return value;
  }

  function addEnquiryMetadata(formData, form, requestType, isBooking) {
    var recordId = enquiryRecordId(form);
    formData.set('gmt_record_id', recordId);
    formData.set('gmt_enquiry_id', recordId);
    formData.set('gmt_type', isBooking ? 'calendar' : 'enquiry');
    formData.set('gmt_action', isBooking ? 'booking_request' : 'website_enquiry');
    formData.set('gmt_schema_version', '1');
    formData.set('gmt_customer_name', formData.get('name') || '');
    formData.set('gmt_customer_email', formData.get('email') || '');
    formData.set('gmt_customer_phone', formData.get('phone') || '');
    formData.set('gmt_request_type', requestType || 'General enquiry');
    formData.set('gmt_message', formData.get('message') || '');
    formData.set('gmt_mailbox', 'info@gmt-services.co.uk');
    formData.set('gmt_inbox_status', 'New — awaiting Microsoft 365 inbox link');
    formData.set('gmt_portal_record_url', window.location.origin + '/portal/submissions.html?record=' + encodeURIComponent(recordId));
    return recordId;
  }

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

    // Use public street tiles without a browser-exposed API key. The former
    // CARTO endpoint renders an API KEY placeholder when its key is missing.
    window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
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

  function initHeroCarousel() {
    var root = document.querySelector('[data-hero-carousel]');
    var track = root ? root.querySelector('[data-hero-track]') : null;
    var slides = track ? Array.prototype.slice.call(track.querySelectorAll('.hero-media-slide')) : [];
    if (!root || !track || slides.length < 2) return;

    var mobileHeroLayout = window.matchMedia('(max-width: 820px)');
    var siteHeader = document.querySelector('.site-header');
    var siteNav = document.querySelector('[data-site-nav]');
    function updateMobileHeroHeight() {
      if (!mobileHeroLayout.matches) {
        root.style.removeProperty('--gmt-mobile-hero-height');
        return;
      }
      var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      var headerHeight = siteHeader ? siteHeader.getBoundingClientRect().height : 0;
      var navHeight = siteNav ? siteNav.getBoundingClientRect().height : 0;
      root.style.setProperty('--gmt-mobile-hero-height', Math.max(320, viewportHeight - headerHeight - navHeight) + 'px');
    }
    updateMobileHeroHeight();
    window.addEventListener('resize', updateMobileHeroHeight);
    window.addEventListener('orientationchange', updateMobileHeroHeight);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', updateMobileHeroHeight);
    if (window.ResizeObserver && siteHeader && siteNav) {
      var headerObserver = new ResizeObserver(updateMobileHeroHeight);
      headerObserver.observe(siteHeader);
      headerObserver.observe(siteNav);
    }

    var intro = root.querySelector('[data-hero-intro]');
    var inner = root.querySelector('.hero-inner');
    var index = 0;
    var duration = 5500;
    var paused = false;
    var timer = null;
    var introTimer = null;
    var introListeners = [];
    var carouselStarted = false;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setIndex(nextIndex) {
      index = (nextIndex + slides.length) % slides.length;
      track.style.transform = 'translate3d(0, -' + (index * 100) + '%, 0)';
      slides.forEach(function (slide, slideIndex) {
        slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
      });
    }

    function setPaused(nextPaused) {
      paused = nextPaused;
      root.toggleAttribute('data-hero-paused', paused);
    }

    function advance() {
      if (!paused) setIndex(index + 1);
    }

    function startCarousel() {
      if (carouselStarted || reducedMotion) return;
      carouselStarted = true;
      timer = window.setInterval(advance, duration);
    }

    function clearIntroListeners() {
      introListeners.forEach(function (listener) {
        document.removeEventListener(listener.type, listener.handler);
      });
      introListeners = [];
    }

    function finishIntro() {
      if (!root.classList.contains('is-hero-intro-active')) return;
      if (introTimer) window.clearTimeout(introTimer);
      clearIntroListeners();
      root.classList.remove('is-hero-intro-active');
      if (inner) {
        inner.inert = false;
        inner.removeAttribute('aria-hidden');
      }
      if (intro) intro.setAttribute('aria-hidden', 'true');
      startCarousel();
    }

    function beginIntro() {
      if (reducedMotion) {
        finishIntro();
        return;
      }
      if (!intro || !inner) {
        root.classList.remove('is-hero-intro-active');
        startCarousel();
        return;
      }
      root.classList.add('is-hero-intro-active');
      intro.setAttribute('aria-hidden', 'false');
      inner.setAttribute('aria-hidden', 'true');
      inner.inert = true;
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
        var handler = finishIntro;
        introListeners.push({ type: type, handler: handler });
        document.addEventListener(type, handler, { once: true, passive: true });
      });
      introTimer = window.setTimeout(finishIntro, 2000);
    }

    root.addEventListener('focusin', function () { setPaused(true); });
    root.addEventListener('focusout', function (event) {
      if (!root.contains(event.relatedTarget)) setPaused(false);
    });
    document.addEventListener('visibilitychange', function () {
      setPaused(document.hidden);
    });

    setIndex(0);
    beginIntro();
    window.addEventListener('beforeunload', function () {
      if (timer) window.clearInterval(timer);
      if (introTimer) window.clearTimeout(introTimer);
      clearIntroListeners();
    });
  }

  function initWorkshopMotionCarousel() {
    var root = document.querySelector('[data-workshop-motion-track]');
    var slides = root ? Array.prototype.slice.call(root.querySelectorAll('.workshop-motion-image')) : [];
    var backdrop = document.querySelector('[data-workshop-motion-backdrop]');
    if (!root || slides.length < 2) return;

    var index = 0;
    var duration = 7000;
    var timer = null;
    var paused = false;
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setIndex(nextIndex) {
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach(function (slide, slideIndex) {
        slide.classList.toggle('is-active', slideIndex === index);
      });
      if (backdrop) {
        var imageUrl = slides[index].currentSrc || slides[index].src;
        backdrop.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
      }
    }

    function advance() {
      if (!paused) setIndex(index + 1);
    }

    root.addEventListener('mouseenter', function () { paused = true; });
    root.addEventListener('mouseleave', function () { paused = false; });
    root.addEventListener('focusin', function () { paused = true; });
    root.addEventListener('focusout', function (event) {
      if (!root.contains(event.relatedTarget)) paused = false;
    });
    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
    });

    setIndex(0);
    if (!reducedMotion) {
      timer = window.setInterval(advance, duration);
      window.addEventListener('beforeunload', function () {
        if (timer) window.clearInterval(timer);
      });
    }
  }

  function initContentCarousel() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-content-carousel]'), function (root) {
      var track = root.querySelector('[data-content-track]');
      var panels = track ? Array.prototype.slice.call(track.querySelectorAll('.content-carousel-panel')) : [];
      var previous = root.querySelector('[data-content-prev]');
      var next = root.querySelector('[data-content-next]');
      var page = root.querySelector('[data-content-page]');
      var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-content-tab]'));
      if (!track || !panels.length || (tabs.length ? tabs.length !== panels.length : !previous || !next)) return;

      var index = 0;
      var mobileLayout = window.matchMedia('(max-width: 820px)');
      function sizeActivePanel() {
        if (mobileLayout.matches && root.classList.contains('is-carousel-enhanced')) {
          track.style.height = panels[index].scrollHeight + 'px';
        } else {
          track.style.removeProperty('height');
        }
      }

      function sizeTrack() {
        var panelWidth = root.clientWidth;
        if (!panelWidth) return;
        track.style.width = (panelWidth * panels.length) + 'px';
        panels.forEach(function (panel) {
          panel.style.flex = '0 0 ' + panelWidth + 'px';
          panel.style.width = panelWidth + 'px';
        });
        track.style.transform = 'translate3d(-' + (index * panelWidth) + 'px, 0, 0)';
        sizeActivePanel();
      }

      function setIndex(nextIndex, updateHash) {
        index = (nextIndex + panels.length) % panels.length;
        panels.forEach(function (panel, panelIndex) {
          var active = panelIndex === index;
          panel.setAttribute('aria-hidden', active ? 'false' : 'true');
          panel.inert = !active;
          panel.classList.toggle('is-active', active);
        });
        tabs.forEach(function (tab, tabIndex) {
          var active = tabIndex === index;
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
          tab.setAttribute('tabindex', active ? '0' : '-1');
        });
        var panelWidth = root.clientWidth;
        track.style.transform = 'translate3d(-' + (index * panelWidth) + 'px, 0, 0)';
        sizeActivePanel();
        if (page) page.textContent = 'Page ' + (index + 1) + ' of ' + panels.length;
        if (panels[index].querySelector('#workshopMap')) refreshMapSize();
        if (updateHash && panels[index].id) history.replaceState(null, '', '#' + panels[index].id);
      }

      if (previous) previous.addEventListener('click', function () {
        setIndex(index - 1, true);
      });
      if (next) next.addEventListener('click', function () {
        setIndex(index + 1, true);
      });

      tabs.forEach(function (tab, tabIndex) {
        tab.addEventListener('click', function () {
          setIndex(tabIndex, true);
        });
        tab.addEventListener('keydown', function (event) {
          var targetIndex = null;
          if (event.key === 'ArrowRight') targetIndex = (index + 1) % tabs.length;
          if (event.key === 'ArrowLeft') targetIndex = (index + tabs.length - 1) % tabs.length;
          if (event.key === 'Home') targetIndex = 0;
          if (event.key === 'End') targetIndex = tabs.length - 1;
          if (targetIndex === null) return;
          event.preventDefault();
          tabs[targetIndex].focus();
          setIndex(targetIndex, true);
        });
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-carousel-target]'), function (link) {
        var targetId = link.getAttribute('data-carousel-target');
        var targetIndex = panels.findIndex(function (panel) { return panel.id === targetId; });
        if (targetIndex < 0) return;
        link.addEventListener('click', function (event) {
          event.preventDefault();
          setIndex(targetIndex, true);
          root.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      var hashTarget = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
      var hashPanel = hashTarget && hashTarget.closest('.content-carousel-panel');
      var initialIndex = hashPanel ? panels.indexOf(hashPanel) : 0;
      track.style.transition = 'none';
      setIndex(initialIndex >= 0 ? initialIndex : 0, false);
      root.classList.add('is-carousel-enhanced');
      window.requestAnimationFrame(function () {
        sizeTrack();
        track.style.removeProperty('transition');
      });
      window.addEventListener('resize', sizeTrack);
    });
  }

  function initGoogleReviewsCarousel() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-google-reviews-carousel]'), function (root) {
      var track = root.querySelector('[data-reviews-track]');
      var slides = track ? Array.prototype.slice.call(track.querySelectorAll('[data-review-slide]')) : [];
      if (!track || slides.length < 2) return;

      var index = 0;
      var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      var pointerInside = false;
      var focusInside = false;
      var pageVisible = !document.hidden;
      var inViewport = true;
      var timer = null;

      track.style.width = (slides.length * 100) + '%';
      slides.forEach(function (slide) {
        slide.style.flex = '0 0 ' + (100 / slides.length) + '%';
      });

      function setIndex(nextIndex) {
        index = (nextIndex + slides.length) % slides.length;
        slides.forEach(function (slide, slideIndex) {
          var active = slideIndex === index;
          slide.setAttribute('aria-hidden', active ? 'false' : 'true');
          slide.inert = !active;
          slide.classList.toggle('is-active', active);
        });
        track.style.transform = 'translate3d(-' + (index * 100 / slides.length) + '%, 0, 0)';
      }

      function shouldPause() {
        return reducedMotion.matches || pointerInside || focusInside || !pageVisible || !inViewport;
      }

      root.addEventListener('mouseenter', function () { pointerInside = true; });
      root.addEventListener('mouseleave', function () { pointerInside = false; });
      root.addEventListener('focusin', function () { focusInside = true; });
      root.addEventListener('focusout', function (event) {
        if (!root.contains(event.relatedTarget)) focusInside = false;
      });
      document.addEventListener('visibilitychange', function () { pageVisible = !document.hidden; });
      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          inViewport = entries.some(function (entry) { return entry.isIntersecting; });
        }, { threshold: 0.05 });
        observer.observe(root);
      }
      setIndex(0);
      timer = window.setInterval(function () {
        if (!shouldPause()) setIndex(index + 1);
      }, 6500);
      window.addEventListener('beforeunload', function () {
        if (timer) window.clearInterval(timer);
      });
    });
  }

  function initContactModal() {
    var modal = document.querySelector('[data-contact-modal]');
    var slot = modal ? modal.querySelector('[data-workshop-enquiry-slot]') : null;
    var card = document.querySelector('.workshop-enquiry-card');
    var topicTitle = modal ? modal.querySelector('[data-contact-topic-title]') : null;
    var offering = modal ? modal.querySelector('[data-contact-offering]') : null;
    var concerns = modal ? modal.querySelector('[data-contact-concerns]') : null;
    var imageWrap = modal ? modal.querySelector('[data-contact-image-wrap]') : null;
    var contextImage = imageWrap ? imageWrap.querySelector('[data-contact-image]') : null;
    var closeButtons = modal ? modal.querySelectorAll('[data-contact-close]') : [];
    if (!modal || !slot || !card) return;

    var placeholder = document.createElement('aside');
    placeholder.className = 'hero-copy workshop-enquiry-card workshop-enquiry-prompt';
    placeholder.id = 'workshop-enquiry';
    placeholder.setAttribute('aria-labelledby', 'workshop-enquiry-prompt-title');
    placeholder.innerHTML = '<p class="eyebrow">Make an enquiry</p><h3 id="workshop-enquiry-prompt-title">Talk to the workshop</h3><p>Tell GMT about the equipment, the fault and the support you need.</p><a class="button primary" href="#workshop-enquiry" data-enquire-nav>Make an enquiry</a>';
    card.removeAttribute('id');
    card.parentNode.replaceChild(placeholder, card);
    slot.appendChild(card);

    var form = card.querySelector('[data-workshop-enquiry-form]');
    var topicSelect = form ? form.querySelector('[data-service-topic]') : null;
    var message = form ? form.querySelector('[name="message"]') : null;
    var openButtons = Array.prototype.slice.call(document.querySelectorAll('[data-enquire-nav], [data-service-enquiry-open]'));

    var lastFocus = null;

    function setContext(trigger) {
      var topic = trigger && trigger.getAttribute('data-enquiry-topic') || 'General enquiry';
      var serviceCard = trigger && trigger.closest('.service-card');
      if (topic === 'General enquiry' && serviceCard) {
        var heading = serviceCard.querySelector('h3');
        if (heading) topic = heading.textContent.trim();
      }
      var detail = trigger && trigger.getAttribute('data-enquiry-offering') || 'Tell GMT what equipment you need help with and what has changed.';
      var points = trigger && trigger.getAttribute('data-enquiry-concerns');
      var imageSource = trigger && trigger.getAttribute('data-enquiry-image');
      var imageAlt = trigger && trigger.getAttribute('data-enquiry-image-alt');
      if (serviceCard) {
        var serviceImage = serviceCard.querySelector('img');
        if (serviceImage) {
          imageSource = imageSource || serviceImage.getAttribute('src');
          imageAlt = imageAlt || serviceImage.getAttribute('alt');
        }
      }
      var defaultPoints = ['Equipment type and make or model, if known', 'What the equipment does and when the issue occurs', 'Photos or nameplate details, where available'];

      if (topicTitle) topicTitle.textContent = topic === 'General enquiry' ? 'Talk to the workshop' : topic;
      if (offering) offering.textContent = detail;
      if (imageWrap && contextImage) {
        if (imageSource) {
          contextImage.src = imageSource;
          contextImage.alt = imageAlt || topic;
          imageWrap.hidden = false;
        } else {
          contextImage.removeAttribute('src');
          contextImage.alt = '';
          imageWrap.hidden = true;
        }
      }
      if (concerns) {
        concerns.replaceChildren();
        (points ? points.split('|') : defaultPoints).forEach(function (point) {
          var item = document.createElement('li');
          item.textContent = point.trim();
          concerns.appendChild(item);
        });
      }
      if (topicSelect) {
        var option = Array.prototype.find.call(topicSelect.options, function (item) { return item.value.toLowerCase() === topic.toLowerCase(); });
        if (!option && topic !== 'General enquiry') {
          option = document.createElement('option');
          option.value = topic;
          option.textContent = topic;
          topicSelect.appendChild(option);
        }
        topicSelect.value = option ? option.value : 'General enquiry';
      }
      if (message) message.placeholder = topic === 'General enquiry'
        ? 'Tell us what equipment you need help with and what has changed.'
        : 'Tell us more about your ' + topic.toLowerCase() + ' enquiry.';
    }

    function close() {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus) lastFocus.focus();
    }

    function open(trigger) {
      lastFocus = trigger || document.activeElement;
      setContext(trigger);
      modal.hidden = false;
      document.body.classList.add('modal-open');
      var workshopForm = card.querySelector('[data-workshop-enquiry-form]');
      var toggle = card.querySelector('[data-workshop-enquiry-toggle]');
      if (workshopForm) workshopForm.hidden = false;
      if (toggle) toggle.hidden = true;
      card.classList.add('is-expanded');
      var firstField = workshopForm && workshopForm.querySelector('input:not([type="hidden"])');
      if (firstField) firstField.focus();
      else {
        var closeButton = modal.querySelector('.contact-close');
        if (closeButton) closeButton.focus();
      }
    }

    openButtons.forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        open(button);
      });
    });

    Array.prototype.forEach.call(closeButtons, function (button) {
      button.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) close();
      if (event.key !== 'Tab' || modal.hidden) return;
      var focusable = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')).filter(function (item) {
        return !item.hidden && item.getAttribute('aria-hidden') !== 'true';
      });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    window.addEventListener('hashchange', function () {
      if (window.location.hash === '#workshop-enquiry') open(null);
    });
    if (window.location.hash === '#workshop-enquiry') open(null);
  }

  function initWorkshopEnquiry() {
    var form = document.querySelector('[data-workshop-enquiry-form]');
    var card = form ? form.closest('.workshop-enquiry-card') : null;
    var status = card ? card.querySelector('[data-workshop-enquiry-status]') : null;
    var toggle = card ? card.querySelector('[data-workshop-enquiry-toggle]') : null;
    if (!form || !status || !card || !toggle) return;
    prepareProtectedForm(form);

    var requestType = form.querySelector('[name="request_type"]');
    var bookingFields = form.querySelector('[data-booking-fields]');
    function syncBookingFields() {
      var booking = requestType && /^(Call|Meeting)$/i.test(requestType.value);
      if (bookingFields) bookingFields.hidden = !booking;
      ['preferred_date', 'preferred_time'].forEach(function (name) {
        var input = form.querySelector('[name="' + name + '"]');
        if (input) input.required = !!booking;
      });
      if (booking && form.querySelector('[name="message"]') && !form.querySelector('[name="message"]').value.trim()) form.querySelector('[name="message"]').placeholder = 'Tell us what you would like to discuss.';
    }
    if (requestType) { requestType.addEventListener('change', syncBookingFields); syncBookingFields(); }

    function setExpanded(expanded) {
      card.classList.toggle('is-expanded', expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Close enquiry form' : 'Open enquiry form';
      form.hidden = !expanded;
    }

    var isMobile = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
    setExpanded(!isMobile || window.location.hash === '#workshop-enquiry');
    toggle.addEventListener('click', function () {
      setExpanded(!card.classList.contains('is-expanded'));
    });

    if (card.closest('[data-contact-modal]')) toggle.hidden = true;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var protectionError = validateProtectedForm(form);
      if (protectionError) {
        status.textContent = protectionError;
        return;
      }
      var endpoint = window.GMT_APP_CONFIG && window.GMT_APP_CONFIG.contactFormSubmitEndpoint;
      if (!endpoint) {
        status.textContent = 'The enquiry form is not configured yet. Please call the workshop.';
        return;
      }

      var submitButton = form.querySelector('button[type="submit"]');
      var formData = new FormData(form);
      formData.set('_replyto', formData.get('email') || '');
      var requestTypeValue = formData.get('request_type') || 'General enquiry';
      var isBooking = /^(Call|Meeting)$/i.test(requestTypeValue);
      formData.set('_subject', isBooking ? '[GMT][' + requestTypeValue + '] Booking request' : 'New workshop enquiry — GMT Electrical Services');
      addEnquiryMetadata(formData, form, requestTypeValue, isBooking);
      formData.set('gmt_calendar_name', 'GMT Operational Calendar');
      if (submitButton) submitButton.disabled = true;
      status.textContent = 'Sending your enquiry…';

      try {
        var response = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: formData
        });
        if (!response.ok) throw new Error('Workshop enquiry failed');
        form.reset();
        syncBookingFields();
        status.textContent = 'We’ve got your enquiry — please check your email for a reply from GMT.';
        status.classList.add('is-visible');
        form.classList.add('is-submitted');
        form.setAttribute('aria-hidden', 'true');
        toggle.hidden = true;
        window.setTimeout(function () {
          form.hidden = true;
        }, 480);
      } catch (_error) {
        status.textContent = 'We could not send the form. Please call 0208 683 0464 instead.';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  function initStickyNavigation() {
    var navBar = document.querySelector('[data-site-nav]');
    if (!navBar) return;
    navBar.classList.remove('is-hidden');
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
    initStickyNavigation();
    initWorkshopMap();
    initHeroCarousel();
    initWorkshopMotionCarousel();
    initServiceCarousel();
    initContentCarousel();
    initGoogleReviewsCarousel();
    initContactModal();
    initWorkshopEnquiry();
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
