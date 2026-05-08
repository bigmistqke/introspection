// Page-realm IIFE. Runs in every navigated frame via addInitScript and once
// in the current realm via Runtime.evaluate at install time.

export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_cookies';
  if (typeof Document === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  window[BINDING + '_emit'] = emit;

  function parseCookieString(raw) {
    var parts = String(raw).split(';');
    var first = parts.shift() || '';
    var eq = first.indexOf('=');
    if (eq < 0) return null;
    var name = first.slice(0, eq).trim();
    var value = first.slice(eq + 1).trim();
    if (!name) return null;
    var out = { name: name, value: value };
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i].trim();
      if (!seg) continue;
      var aeq = seg.indexOf('=');
      var key = (aeq < 0 ? seg : seg.slice(0, aeq)).trim().toLowerCase();
      var val = aeq < 0 ? '' : seg.slice(aeq + 1).trim();
      if (key === 'expires') {
        var t = Date.parse(val);
        if (!isNaN(t)) out.expires = Math.floor(t / 1000);
      } else if (key === 'max-age') {
        var n = Number(val);
        if (!isNaN(n)) out.expires = Math.floor(Date.now() / 1000) + n;
      } else if (key === 'domain') {
        out.domain = val;
      } else if (key === 'path') {
        out.path = val;
      } else if (key === 'secure') {
        out.secure = true;
      } else if (key === 'samesite') {
        var v = val.toLowerCase();
        if (v === 'strict') out.sameSite = 'Strict';
        else if (v === 'lax') out.sameSite = 'Lax';
        else if (v === 'none') out.sameSite = 'None';
      }
    }
    return out;
  }

  function isExpired(parsed) {
    return typeof parsed.expires === 'number' && parsed.expires <= Math.floor(Date.now() / 1000);
  }

  // ─── Document.prototype.cookie setter ────────────────────────────────────
  var origDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (origDesc && origDesc.set) {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: origDesc.enumerable,
      get: origDesc.get,
      set: function(raw) {
        origDesc.set.call(this, raw);
        try {
          var parsed = parseCookieString(String(raw));
          if (!parsed) {
            emit({ kind: 'write', source: 'document.cookie', operation: 'set', name: '', raw: String(raw) });
            return;
          }
          var op = isExpired(parsed) ? 'delete' : 'set';
          var payload = {
            kind: 'write',
            source: 'document.cookie',
            operation: op,
            name: parsed.name,
            raw: String(raw),
          };
          if (op === 'set') payload.value = parsed.value;
          if (parsed.domain !== undefined) payload.domain = parsed.domain;
          if (parsed.path !== undefined) payload.path = parsed.path;
          if (parsed.expires !== undefined) payload.expires = parsed.expires;
          if (parsed.secure !== undefined) payload.secure = parsed.secure;
          if (parsed.sameSite !== undefined) payload.sameSite = parsed.sameSite;
          emit(payload);
        } catch (_) { /* swallow */ }
      },
    });
  }
})();
`
