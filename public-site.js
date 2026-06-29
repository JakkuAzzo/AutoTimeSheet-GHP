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

  function initPublicHomepage() {
    initWorkshopMap();
    initServiceCarousel();
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
