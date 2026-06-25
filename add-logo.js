(() => {
  function logoPath() {
    return location.pathname.includes('/timesheets/') || location.pathname.includes('/jobs/') || location.pathname.includes('/tasks/') || location.pathname.includes('/calendar/') ? '../image.png' : 'image.png';
  }
  function addLogo() {
    const header = document.querySelector('.app-header');
    if (!header || header.querySelector('.site-logo')) return;
    const first = header.firstElementChild;
    if (!first) return;
    const wrap = document.createElement('div');
    wrap.className = 'brand-block';
    const img = document.createElement('img');
    img.src = logoPath();
    img.alt = 'GMT Electrical Services Ltd logo';
    img.className = location.pathname.endsWith('/') || location.pathname.endsWith('/index.html') ? 'site-logo' : 'site-logo small-logo';
    header.insertBefore(wrap, first);
    wrap.appendChild(img);
    wrap.appendChild(first);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLogo);
  else addLogo();
})();
