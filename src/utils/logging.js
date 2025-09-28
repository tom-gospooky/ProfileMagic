function redactString(str) {
  if (typeof str !== 'string') return str;
  // Basic redaction for Slack-style tokens and Bearer headers
  return str
    .replace(/xox[aboprs]-[A-Za-z0-9-]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  return out;
}

// Build a compact, safe error payload from Slack Web API errors
function formatSlackError(err) {
  const safe = {};
  if (!err || typeof err !== 'object') return { message: String(err) };

  safe.message = redactString(err.message || '');
  if (err.code) safe.code = err.code;
  if (err.status || err.statusCode) safe.status = err.status || err.statusCode;

  // Slack Web API shape: err.data often contains ok:false and error
  if (err.data && typeof err.data === 'object') {
    const d = err.data;
    safe.slack = pick(d, ['ok', 'error', 'warnings', 'needed', 'provided']);
    if (d.response_metadata && d.response_metadata.messages) {
      safe.slack.response_metadata = { messages: d.response_metadata.messages };
    }
  }

  // Some SDK errors carry request info
  if (err.request && typeof err.request === 'object') {
    const r = err.request;
    const reqInfo = {};
    if (r.method) reqInfo.method = r.method;
    if (r.url) reqInfo.url = redactString(r.url);
    if (r.headers) {
      reqInfo.headers = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (/authorization/i.test(k)) reqInfo.headers[k] = '[REDACTED]';
        else reqInfo.headers[k] = Array.isArray(v) ? v.map(redactString) : redactString(v);
      }
    }
    safe.request = reqInfo;
  }

  return safe;
}

function logSlackError(context, err) {
  try {
    const payload = formatSlackError(err);
    console.error(`Slack API error in ${context}:`, JSON.stringify(payload));
  } catch (e) {
    console.error(`Slack API error in ${context}:`, err?.message || String(err));
  }
}

module.exports = { formatSlackError, logSlackError };

