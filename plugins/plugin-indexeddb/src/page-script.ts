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

  window[BINDING + '_emit'] = emit;
  window[BINDING + '_nextTxId'] = nextTxId;
  window[BINDING + '_safeJSON'] = safeJSON;
  window[BINDING + '_settings'] = settings;

  // ─── IDBFactory.open ─────────────────────────────────────────────────────
  var origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, version) {
    var req = origOpen.apply(this, arguments);
    var oldVersion;
    req.addEventListener('upgradeneeded', function(ev) {
      oldVersion = ev.oldVersion;
      var tx = req.transaction;
      if (tx) {
        var transactionId = nextTxId();
        try {
          Object.defineProperty(tx, TX_ID_KEY, { value: transactionId, configurable: true });
        } catch (_) {
          tx[TX_ID_KEY] = transactionId;
        }
        var dbName = String(name);
        var names = Array.prototype.slice.call(tx.objectStoreNames || []);
        emit({
          kind: 'transaction', operation: 'begin', database: dbName,
          transactionId: transactionId, mode: 'versionchange', objectStoreNames: names
        });
        tx.addEventListener('complete', function() {
          emit({
            kind: 'transaction', operation: 'complete', database: dbName,
            transactionId: transactionId, mode: 'versionchange', objectStoreNames: names
          });
        });
        tx.addEventListener('abort', function() {
          emit({
            kind: 'transaction', operation: 'abort', database: dbName,
            transactionId: transactionId, mode: 'versionchange', objectStoreNames: names,
            error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : undefined
          });
        });
      }
      emit({
        kind: 'database',
        operation: 'upgrade',
        name: String(name),
        oldVersion: ev.oldVersion,
        newVersion: ev.newVersion
      });
    });
    req.addEventListener('blocked', function() {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'blocked',
        oldVersion: oldVersion
      });
    });
    req.addEventListener('success', function() {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'success',
        newVersion: req.result ? req.result.version : version
      });
    });
    req.addEventListener('error', function() {
      emit({
        kind: 'database',
        operation: 'open',
        name: String(name),
        outcome: 'error',
        error: req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown'
      });
    });
    return req;
  };

  // ─── IDBFactory.deleteDatabase ──────────────────────────────────────────
  var origDeleteDb = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function(name) {
    var req = origDeleteDb.apply(this, arguments);
    req.addEventListener('success', function() {
      emit({ kind: 'database', operation: 'delete', name: String(name), outcome: 'success' });
    });
    req.addEventListener('error', function() {
      emit({
        kind: 'database', operation: 'delete', name: String(name), outcome: 'error',
        error: req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown'
      });
    });
    req.addEventListener('blocked', function() {
      emit({ kind: 'database', operation: 'delete', name: String(name), outcome: 'blocked' });
    });
    return req;
  };

  // ─── IDBDatabase.close ──────────────────────────────────────────────────
  var origClose = IDBDatabase.prototype.close;
  IDBDatabase.prototype.close = function() {
    var name = this.name;
    var version = this.version;
    var result = origClose.apply(this, arguments);
    emit({ kind: 'database', operation: 'close', name: String(name), oldVersion: version });
    return result;
  };
})();
`
