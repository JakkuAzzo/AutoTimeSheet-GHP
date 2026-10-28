(function () {
  'use strict';
  var carousel = document.querySelector('.portal-dashboard-carousel');
  if (!carousel) return;
  var slides = Array.prototype.slice.call(carousel.querySelectorAll(':scope > section'));
  var controls = carousel.querySelector('.dashboard-slide-controls');
  var previous = carousel.querySelector('[data-dashboard-previous]');
  var next = carousel.querySelector('[data-dashboard-next]');
  var status = carousel.querySelector('[data-dashboard-slide-status]');
  if (slides.length !== 3 || !controls || !previous || !next || !status) return;
  var titles = ['Record your day', 'My work', 'My statistics'];
  var current = 0;
  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach(function (slide, position) { slide.hidden = position !== current; });
    status.textContent = 'Page ' + (current + 1) + ' of ' + slides.length + ': ' + titles[current];
  }
  previous.addEventListener('click', function () { show(current - 1); });
  next.addEventListener('click', function () { show(current + 1); });
  show(0);
  controls.hidden = false;
})();
