// Playwright config for the draft editor (docsync/editor/edit.html), the
// single-file app assessed in docs/primer/LIBRARIES.md — recommendation #1
// there was to formalize the ad-hoc /tmp Playwright harness into the repo.
// Dev-only: nothing here ships to users.
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PRIMER_TEST_PORT || 8199;

module.exports = defineConfig({
  testDir: 'tests/editor',
  // Stages the default project's editor from this working tree (see the
  // file: on a machine whose registry points budget-primer elsewhere, the
  // suite was otherwise testing a stale edit.html), and brackets an impact-map
  // run (`npm run test:full`; tools/affected.mjs reads the map).
  globalSetup: './tests/editor/fixtures/global-setup.js',
  globalTeardown: './tests/editor/fixtures/global-teardown.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Pyodide (~30MB, cdn.jsdelivr.net) boots once per test — generous timeouts.
  // Non-Chromium engines compile that WASM measurably slower, and a parallel
  // run stacks several boots at once; the first-render wait in editor-test.js
  // doubles its budget off-Chromium, so the per-test ceiling must clear it.
  timeout: process.env.ALL_BROWSERS ? 180_000 : 90_000,
  // And fewer of them at once: a matrix run stacks WASM compiles, and it was
  // the CONTENTION, not the engine, that pushed heavy boots past any budget —
  // the same specs pass with room to spare when four run instead of ten.
  workers: process.env.ALL_BROWSERS ? 4 : undefined,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/primer/`,
    trace: 'retain-on-failure',
    // No service worker under test, except where a spec opts back in
    // (standalone.spec.js asserts registration itself). A second Pyodide
    // boot is served from the SW's cache, and Playwright's Firefox
    // instrumentation — tracing OR any route interception — wedges on that
    // SW-served ~30MB stream: every multi-boot spec timed out at first
    // render on an app that was fine in a bare browser. Blocked, boots pull
    // through the ordinary HTTP cache, which every engine instruments fine.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The cross-engine matrix is opt-in (ALL_BROWSERS=1): tripling every
    // local run would triple a ~14-minute suite for work that is almost
    // always engine-neutral. CI or an explicit compatibility pass turns
    // them on with --project=firefox / --project=webkit.
    ...(process.env.ALL_BROWSERS ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
    ] : []),
  ],
  webServer: {
    command: 'python3 report2027/tools/serve.py',
    url: `http://localhost:${PORT}/__ping`,
    reuseExistingServer: false,
    timeout: 30_000,
    // PRIMER_OPEN=0: serve.py's default behavior opens a real browser tab on
    // startup (nice for `make live`, pointless — and awkward on a CI runner
    // with no display — when Playwright is about to drive its own browser).
    env: { PRIMER_PORT: String(PORT), PRIMER_OPEN: '0',
           // Save/Push/export/upload answer with test-safe mocks SERVER-side
           // (see serve.py) — context.route() blocks would turn on request
           // interception, whose Firefox pipe wedges a second Pyodide boot.
           PRIMER_TEST_SAFE: '1',
           // Never let the suite's shared server idle-exit mid-run: spec
           // pages come and go by design, so their goodbyes would reap it.
           PRIMER_LINGER: '0',
           // No network from the suite: the push-health probe asks GitHub
           // whether a push would work, and a real answer for a real
           // checkout would bleed into specs that mock everything else.
           PRIMER_PUSH_PROBE: '0',
           // The connect-github spec stands in for GitHub on this port; the
           // fake client id keeps the device flow ON without a real App.
           PRIMER_GH_BASE: 'http://localhost:8390',
           PRIMER_GH_API: 'http://localhost:8390',
           PRIMER_GH_CLIENT: 'Iv23TESTCLIENT' },
  },
});
