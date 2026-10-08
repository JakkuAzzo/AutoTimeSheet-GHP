const MAX = 2000;

function value(input, fallback = '') {
  return String(input == null ? fallback : input).trim().slice(0, MAX);
}

function aliases(input) {
  const source = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(source.map((item) => value(item, '')).filter(Boolean))].slice(0, 40);
}

export function canonicalEstimateInput(input = {}) {
  const canonical_id = value(input.canonical_id || input.canonicalId, '');
  if (!canonical_id) throw new Error('canonical_id is required');
  const source = value(input.source, 'email');
  if (!['email', 'app'].includes(source)) throw new Error('source must be email or app');
  return {
    canonical_id,
    estimate_number: value(input.estimate_number || input.estimateNumber),
    number_aliases: aliases(input.number_aliases || input.numberAliases),
    client: value(input.client || input.client_company || input.company),
    client_email: value(input.client_email || input.clientEmail || input.email),
    reference: value(input.reference),
    estimate_date: value(input.estimate_date || input.estimateDate || input.date, '', 80),
    source,
    mailbox: value(input.mailbox || input.source_mailbox, '').toLowerCase(),
    internet_message_id: value(input.internet_message_id || input.internetMessageId, '', 1000),
    mailbox_message_id: value(input.mailbox_message_id || input.mailboxMessageId || input.outlook_message_id || input.outlookMessageId, '', 255),
    outlook_message_id: value(input.outlook_message_id || input.outlookMessageId, '', 255),
    outlook_url: value(input.outlook_url || input.outlookUrl, '', 2000),
    sharepoint_url: value(input.sharepoint_url || input.sharepointUrl, '', 2000),
    attachment_url: value(input.attachment_url || input.attachmentUrl, '', 2000),
    correlation_status: value(input.correlation_status || input.correlationStatus, 'unmatched', 80)
  };
}

function merged(existing, incoming) {
  const current = existing || {};
  const next = canonicalEstimateInput({ ...current, ...incoming, number_aliases: [...aliases(current.number_aliases), ...aliases(incoming.number_aliases), current.estimate_number, incoming.estimate_number] });
  next.number_aliases = aliases(next.number_aliases).filter((item) => item !== next.estimate_number);
  return next;
}

export function createEstimateIndexStore(db) {
  return {
    async upsert(input) {
      const incoming = canonicalEstimateInput(input);
      const existing = incoming.outlook_message_id
        ? await db.prepare('SELECT * FROM estimate_index WHERE outlook_message_id = ?').bind(incoming.outlook_message_id).first()
        : await db.prepare('SELECT * FROM estimate_index WHERE canonical_id = ?').bind(incoming.canonical_id).first();
      const row = merged(existing, incoming);
      await db.prepare(`INSERT INTO estimate_index
        (canonical_id, estimate_number, number_aliases_json, client, client_email, reference, estimate_date, source,
         outlook_message_id, outlook_url, sharepoint_url, attachment_url, correlation_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        ON CONFLICT(canonical_id) DO UPDATE SET estimate_number=excluded.estimate_number,
        number_aliases_json=excluded.number_aliases_json, client=excluded.client, client_email=excluded.client_email,
        reference=excluded.reference, estimate_date=excluded.estimate_date, source=excluded.source,
        outlook_message_id=COALESCE(excluded.outlook_message_id, estimate_index.outlook_message_id), outlook_url=excluded.outlook_url,
        sharepoint_url=excluded.sharepoint_url, attachment_url=excluded.attachment_url,
        correlation_status=excluded.correlation_status, updated_at=CURRENT_TIMESTAMP`)
        .bind(row.canonical_id, row.estimate_number, JSON.stringify(row.number_aliases), row.client, row.client_email,
          row.reference, row.estimate_date, row.source, row.outlook_message_id || null, row.outlook_url,
          row.sharepoint_url, row.attachment_url, row.correlation_status, null).run();
      const mailboxMessageId = row.mailbox_message_id || row.outlook_message_id;
      if (row.source === 'email' && row.mailbox && mailboxMessageId) {
        await db.prepare(`INSERT INTO estimate_mail_sources
          (canonical_id, mailbox, outlook_message_id, internet_message_id, outlook_url, created_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(mailbox, outlook_message_id) DO UPDATE SET canonical_id=excluded.canonical_id,
          internet_message_id=excluded.internet_message_id, outlook_url=excluded.outlook_url`)
          .bind(row.canonical_id, row.mailbox, mailboxMessageId, row.internet_message_id, row.outlook_url).run();
      }
      return row;
    },
    async list(limit = 500) {
      const result = await db.prepare(`SELECT i.*,
        COALESCE((SELECT json_group_array(json_object('mailbox', s.mailbox, 'outlook_message_id', s.outlook_message_id,
          'internet_message_id', s.internet_message_id, 'outlook_url', s.outlook_url))
          FROM estimate_mail_sources s WHERE s.canonical_id = i.canonical_id), '[]') AS mail_sources_json
        FROM estimate_index i ORDER BY i.updated_at DESC LIMIT ?`).bind(Math.min(Math.max(Number(limit) || 500, 1), 500)).all();
      return (result.results || []).map((row) => ({ ...row, number_aliases: aliasesFromJson(row.number_aliases_json), mail_sources: mailSourcesFromJson(row.mail_sources_json), source_mailboxes: [...new Set(mailSourcesFromJson(row.mail_sources_json).map((source) => source.mailbox).filter(Boolean))] }));
    }
  };
}

function aliasesFromJson(raw) {
  try { return aliases(JSON.parse(raw || '[]')); } catch (_) { return aliases(raw); }
}

function mailSourcesFromJson(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch (_) { return []; }
}

function normaliseRow(row) {
  return { ...row, number_aliases: Array.isArray(row.number_aliases) ? row.number_aliases : aliasesFromJson(row.number_aliases_json) };
}

export function correlateEstimateRecords(indexRows = [], invoice = {}, records = []) {
  const invoiceNumber = value(invoice.invoice_number || invoice.invoiceNumber);
  const reference = value(invoice.reference);
  const client = value(invoice.contact_name || invoice.client || invoice.client_company).toLowerCase();
  const rows = indexRows.map(normaliseRow);
  const direct = rows.filter((row) => invoiceNumber && (row.estimate_number === invoiceNumber || row.number_aliases.includes(invoiceNumber)));
  const referenced = direct.length ? direct : rows.filter((row) => reference && (row.estimate_number === reference || row.number_aliases.includes(reference)));
  const exact = referenced.length ? referenced : rows.filter((row) => reference && row.reference && row.reference.toLowerCase() === reference.toLowerCase());
  const clientOnly = exact.length ? [] : rows.filter((row) => client && row.client && row.client.toLowerCase() === client);
  const chosen = exact.length ? exact : clientOnly;
  const unique = [...new Map(chosen.map((row) => [row.canonical_id, row])).values()];
  const rule = direct.length ? 'estimate-number' : referenced.length ? 'estimate-number-alias' : exact.length ? 'reference' : 'client';
  if (!exact.length) {
    const candidates = unique.map((row) => ({ canonical_id: row.canonical_id, rule: 'client' }));
    return { matches: [], candidates, explanation: candidates.length ? 'Customer name only; Accounts review required' : 'No confident estimate match' };
  }
  const matches = unique.length === 1 ? [{ canonical_id: unique[0].canonical_id, rule }] : [];
  const candidates = unique.length > 1 ? unique.map((row) => ({ canonical_id: row.canonical_id, rule: 'ambiguous' })) : [];
  return { matches, candidates, explanation: matches.length ? `Matched by ${rule}` : candidates.length ? 'Multiple candidates require Accounts review' : 'No confident estimate match' };
}
