# AGENTS.md

## Commands

```bash
npm test                    # unit tests (vitest, 10s timeout)
npm run typecheck           # tsc --noEmit
npm run build               # tsc + Vue UI build + copy dashboard dist (3-step)
npm run test:integration    # integration tests (real browser, 60s timeout, single worker)
npm run dev                 # tsx run.ts (no build needed)
```

Demo directory has its own commands — **always run from `demo/`**, never root:
```bash
cd demo && npm test         # demo integration tests
cd demo && npm run dashboard
cd demo && npm run server   # mock web app on :61775
```

Run a single test file:
```bash
npx vitest run tests/unit/dsl/parser.test.ts
```

## Architecture

- **ESM-only** — all imports use `.js` extensions, `"type": "module"` everywhere
- **TypeScript strict** — `strict: true`, target ES2022, NodeNext resolution
- **No linter/formatter** — no eslint, prettier, or editorconfig exists
- **No CI/CD** — no GitHub Actions

### Layers

```
src/engine/    → execution engine (scheduler, workflow-runner, step-executor, checkpoint)
src/dsl/       → parser + executor (text script → Playwright calls)
src/adapters/  → YAML loader (Zod validated), element CSV registry
src/types/     → TypeScript type definitions
src/dashboard/ → web dashboard (raw node:http server + Vue 3 SPA)
src/utils.ts   → shared helpers (stripQuotes, escapeRegex, sleep)
```

- `run.ts` — CLI entry (commander), reads version from `package.json` via `createRequire`
- `src/index.ts` — public API barrel export
- Demo is NOT a workspace; uses `"resumewright": "file:../"` with vitest alias to source

### Build chain

`tsc` → `npm run build -w ui` (Vue/Vite) → `node scripts/copy-dashboard-dist.js`

Dashboard UI workspace: `src/dashboard/ui` (Vue 3 + Pinia + Vite, private package)

## Testing

- **Unit**: `tests/unit/` — 10s timeout, globals enabled, v8 coverage on `src/**` excluding `src/types/`
- **Integration**: `tests/integration/` — 60s timeout, `forks` pool, single worker, needs Playwright chromium
- **Demo**: `demo/tests/` — 60s timeout, aliases `resumewright` to `../src/index.ts` (no build needed)
- Demo vitest deduplicates `@playwright/test` and `playwright` to avoid dual-loading

## Key Conventions

- DSL variables use `$snake_case`
- Element locators: text-first, prefixes for disambiguation (`role:`, `label:`, `testid:`, `css:`, `xpath:`, `@alias`)
- Runtime state lives in `.resumewright/` (checkpoints, screenshots, traces) — gitignored
- Playwright is a **peer dependency** (`>=1.40.0`), must install chromium separately
- `workflow-runner.ts` installs stdout/stderr hooks lazily on `run()` call, not at import time

## Spec Docs

- `resumewright-spec.md` — full framework spec
- `resumewright-dsl-spec.md` — DSL language spec (700+ lines)
