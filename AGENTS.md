# AGENTS.md

Guide for coding agents (and humans) working on this repository. What the project does, how to run it and where each file lives is in the [README](README.md); this file is about how the code is written.

The first goal is code a person can read once, top to bottom, and understand. When readability and cleverness disagree, readability wins.

## Before you finish

```
npm run typecheck
npm test
```

Both must pass. CI runs them on Node 22.18 and 24.

## Language and runtime

- Everything in the repository is in English: identifiers, comments, docs, commit messages.
- Node runs the TypeScript files directly (type stripping, Node 22.18 or later): there is no build step. The `tsconfig.json` enforces what that allows:
  - only erasable syntax: no `enum`, no `namespace`, no constructor parameter properties (`constructor(private readonly x: X)`);
  - imports end in `.ts`, and type-only imports use `import type` or `type` in the braces.
- The browser code in `web/` is plain JavaScript, HTML and CSS, with no bundler.

## Writing readable code

**Names**

- Name things with the project's words: game, product, expansion, card, price guide, catalogue, archive, ledger. Use the same word for the same thing everywhere.
- Put the unit in numeric names: `maxAgeMs`, `spacingMs`, `imageCacheSeconds`.
- A function name says what it gives or does (`latestPrices`, `writeAtomically`), not how.

**Shape**

- One class per file; the file name is the class name in kebab-case (`CatalogIndexes` lives in `catalog-indexes.ts`).
- Fields are declared at the top of the class and assigned in the constructor. Constants are `static readonly` with a doc comment saying where the value comes from.
- Keep functions short and flat: check bad input first and return or throw early, then write the normal path without nesting.
- Read the input, then do the work. In an HTTP route, parse and check every parameter before querying anything.
- Prefer a few explicit lines over a dense one-liner. A temporary variable with a good name is cheaper than a reader's minute.
- No abstraction for a single use, no options nobody passes, no code "for later".

**Comments**

- Every source file starts with a one-line comment saying what the file is for.
- Doc comments (`/** … */`) explain what a member gives and its edge cases: when it returns `null`, what an empty value means.
- Inline comments explain *why* (an observed Cardmarket behaviour, a limit a site asks for), never *what* the next line does.

**Errors and logs**

- Fail with a message a user can act on: `"No InfluxDB token: set INFLUX_TOKEN"`.
- Turn an unknown error into text with `error instanceof Error ? error.message : String(error)`.
- Log through the `Logger` from `LoggerFactory`, never `console`: `info` for what happened, `warn` for a failure the program survives, `debug` for detail.

## Structure

- `src/app.ts` wires the dependencies; classes receive what they need in their constructor and never build their own collaborators. This is what makes them testable.
- Each CLI command is a class in `src/commands/` with a `register(program)` method.
- The web server (`src/web/web-server.ts`) uses [Hono](https://hono.dev): one `app.get(...)` per route, so the route list reads like a table of contents. Query parameters are checked by `ApiQuery`, which throws Hono's `HTTPException(400)`; `onError` turns that into a JSON error and hides every other failure behind a 500.
- Values from a request reach InfluxDB as query parameters, never in the SQL text.
- The InfluxDB token only comes from the `INFLUX_TOKEN` environment variable.

## Tests

- `node:test` and `node:assert/strict`, files in `test/` named after the class they test.
- Test names describe a behaviour in the present tense: `"refuses bad parameters before querying"`.
- No mocking library: fake a collaborator by subclassing it and overriding what the test needs (see `FakeCatalog` in `test/web-server.test.ts`). Use `LoggerFactory.silent()` and temporary folders from `mkdtemp`.
- Tests never reach the network or a real InfluxDB.

## Changes

- Update the README when a command, option, environment variable, API route or data layout changes, and keep its file list in "Code" current.
- Commit messages: one imperative sentence that says what changes for the user or the code, e.g. "Show the 1-day average in the card price chart".
- Add a dependency only when it makes the code clearly simpler, and say why in the commit.
