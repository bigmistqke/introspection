// Page-realm IIFE. Runs in every navigated frame via addInitScript and once
// in the current realm via Runtime.evaluate at install time.
//
// Communicates with the host via window['__introspection_plugin_indexeddb'],
// a Runtime.addBinding installed server-side. Each call sends a JSON string
// describing one event-relevant moment.

export const BROWSER_SCRIPT = `
(function() {
  var BINDING = '__introspection_plugin_indexeddb';
  if (typeof IDBFactory === 'undefined') return;
  if (window[BINDING + '_installed']) return;
  window[BINDING + '_installed'] = true;

  var SETTINGS_KEY = BINDING + '_settings';
  var settings = window[SETTINGS_KEY] || { reads: false };

  var TX_ID_KEY = '__introspection_idb_tx_id__';

  var txCounter = 0;
  function nextTxId() {
    txCounter += 1;
    return 'tx-' + txCounter + '-' + Date.now();
  }

  function emit(payload) {
    try {
      payload.origin = location.origin;
      var binding = window[BINDING];
      if (typeof binding === 'function') binding(JSON.stringify(payload));
    } catch (_) { /* swallow */ }
  }

  function safeJSON(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return undefined; }
  }

  // Capture-surface patches are added by subsequent code paths in this script.
  // Exposed via window so future patches can compose:
  window[BINDING + '_emit'] = emit;
  window[BINDING + '_nextTxId'] = nextTxId;
  window[BINDING + '_safeJSON'] = safeJSON;
  window[BINDING + '_settings'] = settings;
})();
`
