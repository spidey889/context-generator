function getHeader(req, name) {
  const headers = req.headers || {};
  const directValue = headers[name] ?? headers[name.toLowerCase()];
  const matchingKey = directValue === undefined
    ? Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
    : null;
  const value = directValue ?? (matchingKey ? headers[matchingKey] : undefined);
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function invalid(status, code, error) {
  return { ok: false, status, code, error };
}

function parseBoundedJsonBody(req, maxBytes, payloadLabel) {
  let body = req.body;
  let requestBytes;

  if (typeof body === "string") {
    requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > maxBytes) {
      return invalid(413, "request_too_large", `${payloadLabel} is too large`);
    }
    try {
      body = JSON.parse(body);
    } catch {
      return invalid(400, "invalid_json", "Invalid JSON body");
    }
  } else {
    try {
      requestBytes = Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
    } catch {
      return invalid(400, "invalid_json", "Invalid JSON body");
    }
    if (requestBytes > maxBytes) {
      return invalid(413, "request_too_large", `${payloadLabel} is too large`);
    }
  }

  return { ok: true, body, requestBytes };
}

module.exports = { getHeader, invalid, parseBoundedJsonBody };
