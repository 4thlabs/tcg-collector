# AGENTS.md

Guide for coding agents (and humans) working on this repository. What the project does, how to run it and where each
file lives is in the [README](README.md); this file is about how the code is written.

The first goal is code a person can read once, top to bottom, and understand. When readability and cleverness
disagree, readability wins.

## Before you finish

```
npm run format   # Prettier rewrites src/, test/ and web/
npm run check    # typecheck, lint, format check and tests: all must pass
```

CI runs the same checks on Node 22.18 and 24. A change that does not pass `npm run check` is not finished.

## Language and runtime

- Everything in the repository is in English: identifiers, comments, docs, commit messages.
- Node runs the TypeScript files directly (type stripping, Node 22.18 or later): there is no build step. The
  `tsconfig.json` enforces what that allows:
  - only erasable syntax: no `enum`, no `namespace`, no constructor parameter properties
    (`constructor(private readonly x: X)`);
  - imports end in `.ts`, and type-only imports use `import type` or `type` in the braces.
- The browser code in `web/` is plain JavaScript, HTML and CSS, with no bundler.

## Readability rules

The rules apply to all the code: `src/`, `test/` and `web/`. The first group is checked by the tools, so
`npm run check` catches a slip; the second group is checked by whoever reads the change.

### Checked by the tools

Prettier (`.prettierrc.json`) does the layout, ESLint (`eslint.config.js`) checks the rest.

1. **Formatting is Prettier's**: 120 characters per line, double quotes, semicolons, trailing commas. Do not fight it;
   if its output reads badly, split the code into named steps instead.
2. **No one-liners.** Every `if`, `else` and loop has braces, with its body on its own lines, and a line holds a single
   statement. Guards too:

   ```ts
   // Avoid
   if (!card) return null;
   for (const field of volatileFields) delete content[field];

   // Prefer
   if (!card) {
     return null;
   }
   for (const field of volatileFields) {
     delete content[field];
   }
   ```

3. **Air between the parts of a function**: a blank line after the declarations, after every block (`if`, loop,
   `try`), and before the `return`. Consecutive declarations stay together.

   ```ts
   static of(body: Buffer): string {
     const text = body.toString("utf8");
     const content = JSON.parse(text) as Record<string, unknown>;

     for (const field of ContentFingerprint.volatileFields) {
       delete content[field];
     }

     const canonical = JSON.stringify(content);
     const hash = createHash("sha256");

     hash.update(canonical);

     return hash.digest("hex");
   }
   ```

4. **No nested ternaries**, and no ternary inside a template literal: name the value first.
5. **One fallback per expression**: not `a ?? b ?? c`.
6. **No `reduce`**: a `for` loop with a named total says what it adds up.
7. **Comments stay within 120 characters** too (Prettier does not wrap them).
8. **No `console`**: log through the `Logger`. A command whose output *is* the result (the `games` table) disables the
   rule for its file and says why.
9. `==` only as `== null`, which checks for null and undefined at once; `const` unless the value changes.

### Checked in review

10. **One step per line.** A line does one thing. When a line parses *and* casts *and* filters, or hashes *and*
    formats, split it and name each intermediate value: the names are the explanation.

    ```ts
    // Avoid
    const json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    return createHash("sha256").update(JSON.stringify(json)).digest("hex");

    // Prefer
    const text = body.toString("utf8");
    const content = JSON.parse(text) as Record<string, unknown>;
    const canonical = JSON.stringify(content);
    const hash = createHash("sha256");

    hash.update(canonical);

    return hash.digest("hex");
    ```

11. **No call that does real work inside another call's arguments**: name its result first
    (`const ledgerPath = join(dataDir, "ledger.json")`, then `open(ledgerPath)`). Trivial conversions (`String(id)`,
    `Number(value)`, `ErrorMessage.of(error)`) may stay inline.
12. **Array chains of more than two steps** (`filter`, `map`, `sort`…) become named steps or a `for` loop.
13. **A callback longer than one short expression** becomes a named function or method.
14. **A builder or fluent chain** (InfluxDB `Point`, Commander, Hono) is written one call per line.
15. **Flat functions**: check bad input first and return or throw early, then write the normal path without nesting.
    Read the input, then do the work: in an HTTP route, parse and check every parameter before querying anything.
16. **No abstraction for a single use**, no options nobody passes, no code "for later".

## Names

- Name things with the project's words: game, product, expansion, card, price guide, catalogue, archive, ledger. Use
  the same word for the same thing everywhere.
- Put the unit in numeric names: `maxAgeMs`, `spacingMs`, `imageCacheSeconds`.
- A function name says what it gives or does (`latestPrices`, `writeAtomically`), not how.
- A boolean reads as a fact: `alreadyOpen`, `knownWithoutImage`, `withYear`.

## Shape

- One class per file; the file name is the class name in kebab-case (`CatalogIndexes` lives in `catalog-indexes.ts`).
  Small helpers are classes with static methods too (`InfluxDay.of(time)`, `ErrorMessage.of(error)`).
- Fields are declared at the top of the class and assigned in the constructor. Constants are `static readonly` with a
  doc comment saying where the value comes from.

## Comments

- Every source file starts with a one-line comment saying what the file is for.
- Doc comments (`/** … */`) explain what a member gives and its edge cases: when it returns `null`, what an empty
  value means.
- Inline comments explain *why* (an observed Cardmarket behaviour, a limit a site asks for), never *what* the next
  line does.

## Errors and logs

- Fail with a message a user can act on: `"No InfluxDB token: set INFLUX_TOKEN"`.
- Turn an error caught as `unknown` into text with `ErrorMessage.of(error)`.
- Log through the `Logger` from `LoggerFactory`: `info` for what happened, `warn` for a failure the program survives,
  `debug` for detail.

## Structure

- `src/app.ts` wires the dependencies; classes receive what they need in their constructor and never build their own
  collaborators. This is what makes them testable.
- Each CLI command is a class in `src/commands/` with a `register(program)` method.
- The web server (`src/web/web-server.ts`) uses [Hono](https://hono.dev): one `app.get(...)` per route, so the route
  list reads like a table of contents. Query parameters are checked by `ApiQuery`, which throws Hono's
  `HTTPException(400)`; `onError` turns that into a JSON error and hides every other failure behind a 500.
- Values from a request reach InfluxDB as query parameters, never in the SQL text.
- The InfluxDB token only comes from the `INFLUX_TOKEN` environment variable.

## Tests

- `node:test` and `node:assert/strict`, files in `test/` named after the class they test.
- Test names describe a behaviour in the present tense: `"refuses bad parameters before querying"`.
- No mocking library: fake a collaborator by subclassing it and overriding what the test needs (see `FakeCatalog` in
  `test/web-server.test.ts`). Use `LoggerFactory.silent()` and temporary folders from `mkdtemp`.
- Tests never reach the network or a real InfluxDB.

## Changes

- Update the README when a command, option, environment variable, API route or data layout changes, and keep its file
  list in "Code" current.
- Commit messages: one imperative sentence that says what changes for the user or the code, e.g. "Show the 1-day
  average in the card price chart".
- Add a dependency only when it makes the code clearly simpler, and say why in the commit.
