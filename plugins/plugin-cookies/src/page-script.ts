// Page-realm IIFE. Runs in every navigated frame via addInitScript and once
// in the current realm via Runtime.evaluate at install time.
//
// Communicates with the host via window['__introspection_plugin_cookies'],
// a Runtime.addBinding installed server-side.

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
})();
`
