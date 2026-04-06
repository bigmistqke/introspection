# Testing

- Test actual behaviors, not type shapes. Anything the type checker catches doesn't need a test.
- No mocking. Tests run against real implementations (real browsers via Playwright, real file I/O, etc.).

# TypeScript

- No `as never` casts. Use a proper type, a narrower cast (`as Record<string, unknown>`, `as object`), or a typed wrapper. `as never` suppresses errors without explaining why.
- No abbreviated variable names. Write `parameters` not `params`, `error` not `err`, `event` not `evt`, `result` not `res`. Full names make code searchable and self-documenting.
