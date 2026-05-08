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

  // ─── IDBDatabase.transaction ────────────────────────────────────────────
  var origTransaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(stores, mode) {
    var tx = origTransaction.apply(this, arguments);
    var transactionId = nextTxId();
    try {
      Object.defineProperty(tx, TX_ID_KEY, { value: transactionId, configurable: true });
    } catch (_) {
      tx[TX_ID_KEY] = transactionId;
    }
    var names = Array.prototype.slice.call(tx.objectStoreNames || []);
    var dbName = String(this.name);
    var actualMode = tx.mode;

    emit({
      kind: 'transaction',
      operation: 'begin',
      database: dbName,
      transactionId: transactionId,
      mode: actualMode,
      objectStoreNames: names
    });

    tx.addEventListener('complete', function() {
      emit({
        kind: 'transaction', operation: 'complete', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names
      });
    });
    tx.addEventListener('abort', function() {
      emit({
        kind: 'transaction', operation: 'abort', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names,
        error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : undefined
      });
    });
    tx.addEventListener('error', function() {
      emit({
        kind: 'transaction', operation: 'error', database: dbName,
        transactionId: transactionId, mode: actualMode, objectStoreNames: names,
        error: tx.error ? String(tx.error.name + ': ' + tx.error.message) : 'unknown'
      });
    });

    return tx;
  };

  // ─── Schema (only valid in versionchange transactions) ──────────────────
  function keyPathOf(kp) {
    if (kp == null) return null;
    if (Array.isArray(kp)) return kp.slice();
    return String(kp);
  }

  var origCreateStore = IDBDatabase.prototype.createObjectStore;
  IDBDatabase.prototype.createObjectStore = function(name, options) {
    var store = origCreateStore.apply(this, arguments);
    emit({
      kind: 'schema',
      operation: 'createObjectStore',
      database: String(this.name),
      objectStore: String(name),
      keyPath: keyPathOf(store.keyPath),
      autoIncrement: !!store.autoIncrement
    });
    return store;
  };

  var origDeleteStore = IDBDatabase.prototype.deleteObjectStore;
  IDBDatabase.prototype.deleteObjectStore = function(name) {
    var result = origDeleteStore.apply(this, arguments);
    emit({
      kind: 'schema',
      operation: 'deleteObjectStore',
      database: String(this.name),
      objectStore: String(name)
    });
    return result;
  };

  var origCreateIndex = IDBObjectStore.prototype.createIndex;
  IDBObjectStore.prototype.createIndex = function(name, keyPath, options) {
    var index = origCreateIndex.apply(this, arguments);
    var dbName = (this.transaction && this.transaction.db) ? this.transaction.db.name : '';
    emit({
      kind: 'schema',
      operation: 'createIndex',
      database: String(dbName),
      objectStore: String(this.name),
      index: String(name),
      keyPath: keyPathOf(keyPath),
      unique: !!index.unique,
      multiEntry: !!index.multiEntry
    });
    return index;
  };

  var origDeleteIndex = IDBObjectStore.prototype.deleteIndex;
  IDBObjectStore.prototype.deleteIndex = function(name) {
    var result = origDeleteIndex.apply(this, arguments);
    var dbName = (this.transaction && this.transaction.db) ? this.transaction.db.name : '';
    emit({
      kind: 'schema',
      operation: 'deleteIndex',
      database: String(dbName),
      objectStore: String(this.name),
      index: String(name)
    });
    return result;
  };

  // ─── Object store writes ────────────────────────────────────────────────
  function txContext(store) {
    var tx = store.transaction;
    var transactionId = (tx && tx[TX_ID_KEY]) || 'unknown';
    var dbName = (tx && tx.db) ? String(tx.db.name) : '';
    return { transactionId: transactionId, database: dbName };
  }

  function wrapWriteRequest(req, base) {
    var requestedAt = performance.now();
    base.requestedAt = requestedAt;
    req.addEventListener('success', function() {
      base.completedAt = performance.now();
      base.outcome = 'success';
      emit(base);
    });
    req.addEventListener('error', function() {
      base.completedAt = performance.now();
      base.outcome = 'error';
      base.error = req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown';
      emit(base);
    });
  }

  function inferKey(store, value, explicitKey) {
    if (explicitKey !== undefined) return explicitKey;
    if (store.keyPath != null) {
      try {
        if (Array.isArray(store.keyPath)) {
          return store.keyPath.map(function(p) { return value && value[p]; });
        }
        return value && value[store.keyPath];
      } catch (_) { return undefined; }
    }
    return undefined;
  }

  var origAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function(value, key) {
    var ctx = txContext(this);
    var req = origAdd.apply(this, arguments);
    var inferred = inferKey(this, value, key);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'add',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(inferred),
      value: safeJSON(value),
    });
    return req;
  };

  var origPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) {
    var ctx = txContext(this);
    var req = origPut.apply(this, arguments);
    var inferred = inferKey(this, value, key);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'put',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(inferred),
      value: safeJSON(value),
    });
    return req;
  };

  var origDeleteRecord = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function(key) {
    var ctx = txContext(this);
    var req = origDeleteRecord.apply(this, arguments);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'delete',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
      key: safeJSON(key),
    });
    return req;
  };

  var origClearStore = IDBObjectStore.prototype.clear;
  IDBObjectStore.prototype.clear = function() {
    var ctx = txContext(this);
    var req = origClearStore.apply(this, arguments);
    wrapWriteRequest(req, {
      kind: 'write', operation: 'clear',
      database: ctx.database, objectStore: String(this.name),
      transactionId: ctx.transactionId,
    });
    return req;
  };

  // ─── Reads (opt-in) ────────────────────────────────────────────────────
  function wrapReadRequest(req, base) {
    var requestedAt = performance.now();
    base.requestedAt = requestedAt;
    req.addEventListener('success', function() {
      base.completedAt = performance.now();
      base.outcome = 'success';
      var result = req.result;
      if (base.operation === 'count') {
        base.count = typeof result === 'number' ? result : undefined;
      } else if (base.operation === 'getAll' || base.operation === 'getAllKeys') {
        base.count = Array.isArray(result) ? result.length : undefined;
        base.value = safeJSON(result);
      } else if (base.operation === 'openCursor' || base.operation === 'openKeyCursor') {
        if (result == null) {
          base.value = null;
          emit(base);
          return;
        }
        var advanceCount = 0;
        var snapshot = Object.assign({}, base);
        snapshot.completedAt = performance.now();
        snapshot.value = safeJSON({ key: result.key, primaryKey: result.primaryKey, value: result.value });
        snapshot.count = ++advanceCount;
        emit(snapshot);
        return;
      } else {
        base.value = safeJSON(result);
      }
      emit(base);
    });
    req.addEventListener('error', function() {
      base.completedAt = performance.now();
      base.outcome = 'error';
      base.error = req.error ? String(req.error.name + ': ' + req.error.message) : 'unknown';
      emit(base);
    });
  }

  function readPatchFor(proto, isIndex) {
    var origGet = proto.get;
    proto.get = function(key) {
      if (!settings.reads) return origGet.apply(this, arguments);
      var ctx = txContext(isIndex ? this.objectStore : this);
      var req = origGet.apply(this, arguments);
      wrapReadRequest(req, {
        kind: 'read', operation: 'get',
        database: ctx.database,
        objectStore: String(isIndex ? this.objectStore.name : this.name),
        index: isIndex ? String(this.name) : undefined,
        transactionId: ctx.transactionId,
        query: safeJSON(key),
      });
      return req;
    };

    var origGetAll = proto.getAll;
    if (origGetAll) {
      proto.getAll = function() {
        if (!settings.reads) return origGetAll.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetAll.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getAll',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origGetKey = proto.getKey;
    if (origGetKey) {
      proto.getKey = function(key) {
        if (!settings.reads) return origGetKey.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetKey.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getKey',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(key),
        });
        return req;
      };
    }

    var origGetAllKeys = proto.getAllKeys;
    if (origGetAllKeys) {
      proto.getAllKeys = function() {
        if (!settings.reads) return origGetAllKeys.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origGetAllKeys.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'getAllKeys',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origCount = proto.count;
    if (origCount) {
      proto.count = function() {
        if (!settings.reads) return origCount.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origCount.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'count',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origOpenCursor = proto.openCursor;
    if (origOpenCursor) {
      proto.openCursor = function() {
        if (!settings.reads) return origOpenCursor.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origOpenCursor.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'openCursor',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }

    var origOpenKeyCursor = proto.openKeyCursor;
    if (origOpenKeyCursor) {
      proto.openKeyCursor = function() {
        if (!settings.reads) return origOpenKeyCursor.apply(this, arguments);
        var ctx = txContext(isIndex ? this.objectStore : this);
        var req = origOpenKeyCursor.apply(this, arguments);
        wrapReadRequest(req, {
          kind: 'read', operation: 'openKeyCursor',
          database: ctx.database,
          objectStore: String(isIndex ? this.objectStore.name : this.name),
          index: isIndex ? String(this.name) : undefined,
          transactionId: ctx.transactionId,
          query: safeJSON(arguments[0]),
        });
        return req;
      };
    }
  }

  readPatchFor(IDBObjectStore.prototype, false);
  readPatchFor(IDBIndex.prototype, true);
})();
`
