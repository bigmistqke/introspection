# Testing

- Test actual behaviors, not type shapes. Anything the type checker catches doesn't need a test.
- No mocking. Tests run against real implementations (real browsers via Playwright, real file I/O, etc.).
