// Page-realm IIFE that patches the IndexedDB API surface and ferries events
// to the host via the Runtime binding. Filled in by Task 4 onwards.

export const BROWSER_SCRIPT = `
(function() {
  if (typeof IDBFactory === 'undefined') return;
})();
`
