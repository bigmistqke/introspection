// Page-realm IIFE that patches Document.prototype.cookie setter and
// CookieStore.prototype.set/delete. Filled in by Task 4 onwards.

export const BROWSER_SCRIPT = `
(function() {
  if (typeof Document === 'undefined') return;
})();
`
