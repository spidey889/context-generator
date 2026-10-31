// Server-only coarse location, never an IP/coordinate or a client observation.
(function (root) {
  const fields = ["country", "region", "city"];
  function valid(key, value) {
    if (typeof value !== "string") return false;
    if (value === "unknown") return true;
    if (key === "country") return value.length === 2 && !/[^A-Z]/.test(value);
    if (key === "region") return value.length >= 1 && value.length <= 3 && !/[^A-Z0-9]/.test(value);
    return [...value].length <= 80 && /\p{L}/u.test(value)
      && !/[\u0000-\u001f\u007f-\u009f<>@:/\\{}\[\]%?#&=]/u.test(value) && !/[0-9]+[.][0-9]+/.test(value);
  }
  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3
      || !fields.every(key => Object.hasOwn(input, key) && valid(key, input[key]))) return null;
    return Object.fromEntries(fields.map(key => [key, input[key]]));
  }
  function fromHeaders(read) {
    const values = { country: read("x-vercel-ip-country"), region: read("x-vercel-ip-country-region"), city: "" };
    // Vercel uses RFC3986 encoding, not form encoding: decode once; '+' stays '+'.
    try { values.city = decodeURIComponent(read("x-vercel-ip-city")).normalize("NFC").trim(); } catch {}
    return Object.fromEntries(fields.map(key => [key, valid(key, values[key]) ? values[key] : "unknown"]));
  }
  const api = { validate, fromHeaders };
  root.CapRequestLocation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
