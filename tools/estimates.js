(() => {
  const $ = (id) => document.getElementById(id);
  const lines = $('estimate-lines');
  const preview = $('estimate-preview');
  const status = $('estimate-status');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = (value) => new Intl.NumberFormat('en-GB', { style:'currency', currency:'GBP' }).format(Number(value) || 0);
  const today = new Date();
  $('estimate-date').value = today.toISOString().slice(0, 10);

  function addLine(values = {}) {
    const row = document.createElement('div');
    row.className = 'estimate-line';
    row.innerHTML = `<label>Description<input data-line="description" required placeholder="Supply and fitting" value="${esc(values.description || '')}"></label><label>Qty<input data-line="quantity" type="number" min="0" step="0.01" value="${values.quantity ?? 1}"></label><label>Unit price<input data-line="unit" type="number" min="0" step="0.01" value="${values.unit ?? 0}"></label><div class="estimate-line-total" data-line-total>£0.00</div><button type="button" class="estimate-line-remove" aria-label="Remove estimate line">Remove</button>`;
    row.querySelector('.estimate-line-remove').addEventListener('click', () => { row.remove(); render(); });
    row.querySelectorAll('input').forEach((input) => input.addEventListener('input', render));
    lines.appendChild(row);
    render();
  }

  function data() {
    const items = [...lines.querySelectorAll('.estimate-line')].map((row) => ({
      description: row.querySelector('[data-line="description"]').value.trim(),
      quantity: Number(row.querySelector('[data-line="quantity"]').value) || 0,
      unit: Number(row.querySelector('[data-line="unit"]').value) || 0
    })).filter((item) => item.description || item.unit);
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit, 0);
    const vatRate = Number($('estimate-vat-rate').value) || 0;
    const vat = subtotal * vatRate / 100;
    return { number:$('estimate-number').value.trim(), date:$('estimate-date').value, attention:$('estimate-attention').value.trim(), company:$('estimate-company').value.trim(), email:$('estimate-client-email').value.trim(), validity:$('estimate-validity').value, preparedBy:$('estimate-prepared-by').value.trim(), vatRate, reference:$('estimate-reference').value.trim(), opening:$('estimate-opening').value.trim(), terms:$('estimate-terms').value.trim(), items, subtotal, vat, total:subtotal + vat };
  }

  function documentHtml(item) {
    const d = data();
    return `<div class="estimate-paper-header"><img class="estimate-paper-logo" src="${location.origin}${location.pathname.replace(/tools\/estimates\.html.*$/, '')}image.png" alt="GMT Electrical Services Ltd"><div class="estimate-paper-company"><p>Electric Motor Repairs &amp; Rewinds</p><p>Electrical &amp; Mechanical Engineers</p><p>Air Conditioning Repair &amp; Service</p><p>93-95 Gloucester Rd, Croydon CR0 2DN</p><p>Tel 020 8683 0464</p><p>info@gmt-services.co.uk</p></div></div><h1 class="estimate-paper-title">Estimate</h1><div class="estimate-paper-meta"><div><p><strong>For the attention of:</strong> ${esc(d.attention || 'Client contact')}</p><p><strong>Company:</strong> ${esc(d.company || 'Client company')}</p><p><strong>Re:</strong> ${esc(d.reference || 'Estimate')}</p></div><div><p><strong>Date:</strong> ${esc(d.date)}</p><p><strong>Estimate no:</strong> ${esc(d.number)}</p></div></div><div class="estimate-paper-body"><p>${esc(d.opening).replace(/\n/g, '<br>')}</p><table class="estimate-paper-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${d.items.map((x) => `<tr><td>${esc(x.description)}</td><td>${x.quantity}</td><td>${money(x.unit)}</td><td>${money(x.quantity * x.unit)}</td></tr>`).join('') || '<tr><td colspan="4">No line items added.</td></tr>'}</tbody></table><div class="estimate-paper-total"><p><span>Subtotal</span><strong>${money(d.subtotal)}</strong></p><p><span>VAT (${d.vatRate}%)</span><strong>${money(d.vat)}</strong></p><p class="grand-total"><span>Total</span><strong>${money(d.total)}</strong></p></div></div><p class="estimate-paper-terms">${esc(d.terms)}<br><br>Estimate validity: ${esc(d.validity || '30')} days.</p><p>Regards,<br>${esc(d.preparedBy || 'GMT Electrical Services Ltd')}</p>`;
  }

  function render() {
    const d = data();
    lines.querySelectorAll('.estimate-line').forEach((row) => { const q = Number(row.querySelector('[data-line="quantity"]').value) || 0; const u = Number(row.querySelector('[data-line="unit"]').value) || 0; row.querySelector('[data-line-total]').textContent = money(q * u); });
    preview.innerHTML = documentHtml(d);
  }

  function wordDownload() {
    const d = data();
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)} - Estimate</title><style>body{font-family:Arial;color:#1e293b;margin:48px}h1{text-align:center;letter-spacing:.1em;text-transform:uppercase}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}td:not(:first-child),th:not(:first-child){text-align:right}.total{margin-left:auto;width:260px}</style></head><body>${documentHtml(d)}</body></html>`;
    const blob = new Blob([content], { type:'application/msword' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${d.number || 'GMT-estimate'}.doc`; link.click(); URL.revokeObjectURL(link.href);
    status.textContent = 'Word-compatible estimate downloaded. Review it before sending.';
  }

  function addHidden(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value == null ? '' : value;
    form.appendChild(input);
  }

  function addAttachment(form, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.createElement('input');
    input.type = 'file'; input.name = 'attachment'; input.hidden = true; input.files = transfer.files;
    form.appendChild(input);
  }

  function sendToAccounts() {
    const endpoint = String(window.GMT_APP_CONFIG?.estimateFormSubmitEndpoint || '').trim();
    if (!endpoint) { status.textContent = 'Estimate filing is not configured yet. Download the document and send it through the approved Accounts workflow.'; return; }
    const d = data();
    if (!$('estimate-form').reportValidity()) return;
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)} - Estimate</title></head><body>${documentHtml(d)}</body></html>`;
    const file = new File([content], `${d.number || 'GMT-estimate'}.doc`, { type:'application/msword' });
    const frame = document.createElement('iframe');
    frame.name = `estimate-submit-${Date.now()}`; frame.hidden = true; document.body.appendChild(frame);
    const form = document.createElement('form');
    form.method = 'POST'; form.action = endpoint; form.target = frame.name; form.enctype = 'multipart/form-data'; form.hidden = true;
    addHidden(form, '_subject', `[GMT][ESTIMATE] ${d.number} | ${d.company}`);
    addHidden(form, '_template', 'box'); addHidden(form, '_captcha', 'false');
    addHidden(form, 'gmt_type', 'estimate'); addHidden(form, 'gmt_schema_version', '1');
    addHidden(form, 'gmt_estimate_number', d.number); addHidden(form, 'gmt_estimate_date', d.date);
    addHidden(form, 'gmt_client_company', d.company); addHidden(form, 'gmt_client_contact', d.attention);
    addHidden(form, 'gmt_client_email', d.email); addHidden(form, 'gmt_reference', d.reference);
    addHidden(form, 'gmt_subtotal', d.subtotal.toFixed(2)); addHidden(form, 'gmt_vat', d.vat.toFixed(2));
    addHidden(form, 'gmt_total', d.total.toFixed(2)); addHidden(form, 'gmt_submitted_at', new Date().toISOString());
    addHidden(form, 'message', 'Estimate document attached for protected Accounts filing and approval.');
    addAttachment(form, file); document.body.appendChild(form); form.submit();
    status.textContent = 'Estimate sent to the dedicated Accounts filing route.';
  }

  $('add-estimate-line').addEventListener('click', () => addLine());
  $('download-estimate-word').addEventListener('click', wordDownload);
  $('print-estimate').addEventListener('click', () => { render(); window.print(); });
  $('send-estimate').addEventListener('click', sendToAccounts);
  $('clear-estimate').addEventListener('click', () => { if (confirm('Clear this estimate?')) { lines.innerHTML = ''; addLine(); status.textContent = 'Estimate cleared.'; } });
  document.querySelectorAll('#estimate-form input, #estimate-form textarea').forEach((input) => input.addEventListener('input', render));
  addLine({ description:'', quantity:1, unit:0 });
})();
