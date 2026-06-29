(function () {
  function initWorkshopMap() {
    var el = document.getElementById('workshopMap');
    if (!el || !window.L) return;

    var location = [51.3859, -0.0893];
    var map = window.L.map(el, {
      center: location,
      zoom: 16,
      scrollWheelZoom: false,
      dragging: true,
      tap: true
    });

    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    window.L.circleMarker(location, {
      radius: 9,
      color: '#123d1d',
      weight: 4,
      fillColor: '#c49a2f',
      fillOpacity: 1
    })
      .addTo(map)
      .bindPopup('GMT Electrical Services<br>93-95 Gloucester Rd, Croydon CR0 2DN');

    setTimeout(function () {
      map.invalidateSize();
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkshopMap);
  } else {
    initWorkshopMap();
  }
})();
