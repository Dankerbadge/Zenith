const ALLOWED_CATEGORIES = new Set(['Bug', 'Billing', 'Account', 'Feature request', 'Other']);
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const rateStore = globalThis.__zenithContactRateStore || new Map();
globalThis.__zenithContactRateStore = rateStore;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

function extractIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function cleanRateStore(now) {
  for (const [ip, entry] of rateStore.entries()) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
      rateStore.delete(ip);
    }
  }
}

function applyRateLimit(ip) {
  const now = Date.now();
  cleanRateStore(now);

  const current = rateStore.get(ip);
  if (!current || now - current.start > RATE_LIMIT_WINDOW_MS) {
    rateStore.set(ip, { start: now, count: 1 });
    return true;
  }

  if (current.count >= RATE_LIMIT_MAX) {
    return false;
  }

  current.count += 1;
  rateStore.set(ip, current);
  return true;
}

function validate(payload) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const category = typeof payload.category === 'string' ? payload.category.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const diagnostics = typeof payload.diagnostics === 'string' ? payload.diagnostics.trim() : '';
  const company = typeof payload.company === 'string' ? payload.company.trim() : '';

  if (company) {
    return { ok: false, status: 200, message: 'Request received.' };
  }

  if (name.length < 2 || name.length > 120) {
    return { ok: false, status: 400, message: 'Please enter your name (2-120 characters).' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return { ok: false, status: 400, message: 'Please provide a valid email address.' };
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    return { ok: false, status: 400, message: 'Please choose a valid support category.' };
  }

  if (message.length < 10 || message.length > 5000) {
    return { ok: false, status: 400, message: 'Please include a message between 10 and 5000 characters.' };
  }

  if (diagnostics.length > 3000) {
    return { ok: false, status: 400, message: 'Diagnostics are too long. Please shorten and retry.' };
  }

  return {
    ok: true,
    data: { name, email, category, message, diagnostics },
  };
}

function buildEmailBody(data, meta) {
  return [
    'New Zenith support request',
    '',
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Category: ${data.category}`,
    `Submitted: ${new Date().toISOString()}`,
    `IP: ${meta.ip}`,
    `User-Agent: ${meta.userAgent}`,
    '',
    'Message:',
    data.message,
    '',
    'Diagnostics:',
    data.diagnostics || 'None provided',
  ].join('\n');
}

async function sendViaResend(data, req) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, message: 'Support endpoint is not configured yet. Please email support@zenithfit.app for now.' };
  }

  const to = process.env.CONTACT_TO_EMAIL || 'support@zenithfit.app';
  const from = process.env.CONTACT_FROM_EMAIL || 'Zenith Support <onboarding@resend.dev>';
  const subject = `[Zenith Support] ${data.category} - ${data.name}`;
  const text = buildEmailBody(data, {
    ip: extractIp(req),
    userAgent: String(req.headers['user-agent'] || 'unknown'),
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: data.email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    let errorPayload = null;
    try {
      errorPayload = await response.json();
    } catch (err) {
      errorPayload = null;
    }

    return {
      ok: false,
      status: 502,
      message: 'We could not deliver your request right now. Please try again shortly.',
      details: errorPayload,
    };
  }

  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  const ip = extractIp(req);
  if (!applyRateLimit(ip)) {
    json(res, 429, {
      ok: false,
      message: 'Too many requests. Please wait a few minutes before trying again.',
    });
    return;
  }

  let payload = {};
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (err) {
    json(res, 400, { ok: false, message: 'Invalid request payload.' });
    return;
  }
  const validated = validate(payload);
  if (!validated.ok) {
    json(res, validated.status, { ok: validated.status === 200, message: validated.message });
    return;
  }

  try {
    const sent = await sendViaResend(validated.data, req);
    if (!sent.ok) {
      json(res, sent.status || 500, { ok: false, message: sent.message });
      return;
    }

    json(res, 200, { ok: true, message: 'Request received.' });
  } catch (err) {
    json(res, 500, {
      ok: false,
      message: 'Unexpected server error while sending your request. Please try again shortly.',
    });
  }
};
