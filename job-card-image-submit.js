(() => {
  function endpoint() {
    return String(window.GMT_APP_CONFIG?.formSubmitEndpoint || '').replace('/ajax/', '/');
  }

  function ensureFrame() {
    let frame = document.getElementById('job-card-image-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'job-card-image-frame';
      frame.name = 'job-card-image-frame';
      frame.hidden = true;
      document.body.appendChild(frame);
    }
  }

  function addHidden(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value == null ? '' : String(value);
    form.appendChild(input);
  }

  function sendImageEmail() {
    const file = document.getElementById('job-image')?.files?.[0];
    const url = endpoint();
    if (!file || !url) return;
    ensureFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = 'job-card-image-frame';
    form.enctype = 'multipart/form-data';
    form.hidden = true;

    addHidden(form, '_subject', 'GMT Job Card Image Attachment');
    addHidden(form, '_template', 'box');
    addHidden(form, '_captcha', 'false');
    addHidden(form, 'submission_type', 'Job Card Image');
    addHidden(form, 'job_reference', document.getElementById('job-ref')?.value || '');
    addHidden(form, 'client', document.getElementById('job-client')?.value || '');
    addHidden(form, 'site_address', document.getElementById('job-site')?.value || '');
    addHidden(form, 'assigned_engineer', document.getElementById('job-engineer')?.value || '');
    addHidden(form, 'planned_date', document.getElementById('job-date')?.value || '');
    addHidden(form, 'message', 'Optional job card image attached. Match this to the main job card submission using the job reference/client/site.');

    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'attachment';
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 2000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('job-card-form');
    const image = document.getElementById('job-image');
    if (!form || !image) return;
    form.addEventListener('submit', () => setTimeout(sendImageEmail, 250), true);
  });
})();
