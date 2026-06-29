(() => {
  const GMT_JOB_CARD_IMAGE_CC = 'gmtelectricalservices+jobcard-images@outlook.com';

  function endpoint() {
    return String(window.GMT_APP_CONFIG?.formSubmitEndpoint || '').replace('/ajax/', '/');
  }

  function taggedEndpoint(tag) {
    return endpoint().replace(/([^/?#/@]+)@([^/?#]+)/, (_, local, domain) => `${local.split('+')[0]}+${tag}@${domain}`);
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

  function recipientList(...values) {
    const seen = new Set();
    return values
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter((value) => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()))
      .join(',');
  }

  function sendImageEmail(file, fields = {}) {
    const url = taggedEndpoint('jobcard-images');
    if (!file || !url) return;
    ensureFrame();
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.target = 'job-card-image-frame';
    form.enctype = 'multipart/form-data';
    form.hidden = true;

    addHidden(form, '_subject', '[GMT][JOBCARD][IMAGE] Job card image attachment');
    addHidden(form, '_template', 'box');
    addHidden(form, '_captcha', 'false');
    addHidden(form, '_cc', recipientList(window.GMT_APP_CONFIG?.formSubmitCc, GMT_JOB_CARD_IMAGE_CC));
    addHidden(form, 'submission_type', 'Job Card Image');
    addHidden(form, 'job_reference', fields.ref);
    addHidden(form, 'client', fields.client);
    addHidden(form, 'site_address', fields.site);
    addHidden(form, 'assigned_engineer', fields.engineer);
    addHidden(form, 'planned_date', fields.date);
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
    form.addEventListener('submit', () => {
      const file = image.files?.[0];
      const fields = {
        ref: document.getElementById('job-ref')?.value || '',
        client: document.getElementById('job-client')?.value || '',
        site: document.getElementById('job-site')?.value || '',
        engineer: document.getElementById('job-engineer')?.value || '',
        date: document.getElementById('job-date')?.value || ''
      };
      setTimeout(() => sendImageEmail(file, fields), 250);
    }, true);
  });
})();
