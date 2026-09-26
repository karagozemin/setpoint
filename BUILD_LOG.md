# Build log

## 2026-09-26 — M6 live product

### Implemented

- Replaced the artifact-console root with an editorial product landing at `/`, a live operator workflow at `/app`, and the preserved historical console at `/evidence`.
- Added a browser-safe `RWAIndexLiveAdapter` that detects only the registered external vault, verifies its base asset/oracle/swap adapter links, reads live balances, targets, oracle timestamps, guards, roles, and agent sessions, and exposes explicit live RPC/block provenance.
- Added a precise allocation editor with 100% total validation, the five-asset allowlist, and an 80% Setpoint per-asset bound. Proposed targets remain analysis inputs and do not mutate the external vault strategy.
- Reused the frozen static baseline to construct the simple batch outside React. The live path re-reads state, validates policy, refuses stale accounting, and runs exact `rebalance(Trade[])` simulation from the configured manager identity when inputs are current.
- Added EIP-1193 wallet connect, chain detection, switch/add Robinhood Chain testnet, external manager/session authorization checks, calldata copy/export, authorized submission, receipt wait, explorer linking, and confirmed-state re-read.
- Kept live and historical data boundaries separate. `/app` imports no artifact/scenario adapter; `/evidence` retains byte-identical checked-in evidence and no writable execution surface.
- Added direct-route Vercel rewrites and a CSP exception only for the verified public RPC.
- Added `pnpm live:smoke`, four live-adapter tests, and five product-boundary tests.
- Recorded the live boundary in Decision 0002 and rewrote the README around the real product.

### Live findings and limitations

- The configured RWA Index oracle observations are genuinely stale relative to the deployed 86,400-second guard. Live NAV/drift calls revert with `StalePrice`; the app displays raw balances/targets and returns `NO_TRADE / STALE_PRICE` without substitution.
- The public RPC serves `latest` state but rejected explicit block-number `eth_call` at a just-reported head. Reads therefore use batched latest windows with an observed block identity; a new exact simulation is mandatory immediately before submission.
- The deployed Synthra adapter does not expose a verified public executable quote method. The fork sampler depends on disposable allowance/inventory mutation and is not used live. A recoverable full-batch failure therefore remains fail-closed rather than producing a fabricated adaptive result.
- No funded deployment key is configured. More importantly, no Setpoint contract is required by the implemented external-vault path: the vault already enforces authorization and guards. No vanity contract or sandbox is deployed.
- The configured manager can be used as an `eth_call` identity, but a random connected wallet cannot submit a manager-only rebalance. Unauthorized users receive export actions only.

### Validation

```bash
pnpm install --frozen-lockfile
pnpm security:demo
pnpm typecheck
pnpm test
pnpm build
pnpm demo:check
pnpm live:smoke
```

- 86/86 tests pass.
- Live smoke: chain ID 46630; vault/oracle/adapter/base bytecode present; five live asset/oracle reads; five stale observations; exact vault `eth_call` capability confirmed.
- Security invariants remain 11/11.
- M2 planner SHA-256 remains `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.
- No file under `src/core/` and no accepted historical artifact changed.
- Vercel preview: `https://setpoint-fl1z2lkvh-karagozs-projects.vercel.app` (deployment-protected). Hosted visual checks passed for `/`, `/app`, the live `NO_TRADE` result, mobile, `/evidence`, wallet-disconnected state, and forced RPC failure.
- Review screenshots: `docs/images/m6-landing-desktop.png`, `m6-live-vault.png`, `m6-analysis-result.png`, `m6-mobile.png`, and `m6-evidence.png`.
- Production was not promoted before preview review.

## 2026-09-26 — Public demo and deployment readiness

### Implemented

- Prepared the existing Vite/React operator console for static Vercel deployment with a minimal `vercel.json`, explicit build/output settings, no backend, and restrictive browser security headers.
- Kept Large Target / Adaptive Fallback as the default and moved it to the first core navigation position. The first evidence viewport now exposes the 31.025554% initial drift, 10-leg and 60.051107%-NAV simple attempt, `INSUFFICIENT_OUTPUT`, adaptive decision, 22.5%-NAV execution, 19.113279% confirmed drift, and terminal refusal evidence without claiming completion.
- Added compact product context using the PRD wording, precise RWA Index compatibility language, and a persistent public-demo/no-live-funds disclosure.
- Added restrained GitHub, PRD v1.2, security-model, and reproduction links.
- Replaced eager JSON imports with selected-scenario evidence fetching. Raw checked-in artifacts remain the single source, first-render JavaScript fell from 353.32 kB to approximately 260 kB uncompressed, and evidence-fetch/application errors remain distinct from typed `NO_TRADE` decisions.
- Added explicit handling and tests for unknown scenarios, missing evidence, malformed JSON, and rendering failures.
- Disabled production source maps and added professional title, description, Open Graph, Twitter summary, and theme-color metadata. No unapproved logo, social proof, or favicon was introduced.
- Added `pnpm demo:check` to build and audit the emitted static bundle, verify byte-identical evidence exports, frozen results, security invariants, scenario mappings, local-path absence, credential signatures, and the lack of browser execution endpoints.

### Public-safety audit

- `.env.example` contains only the public Robinhood testnet RPC and local Anvil host controls; it contains no private credential. `.env` remains ignored.
- The production bundle contains no private keys, wallet secrets, RPC credentials, internal tokens, environment secrets, local filesystem paths, localhost URLs, shell/Anvil trigger, writable API, mutation endpoint, or transaction-submission client.
- Browser data loading is same-origin and read-only. All nine emitted evidence/summary files are byte-identical to their checked-in sources.
- Fork-only transaction hashes remain labeled `Fork transaction`; no public explorer link is generated for local Anvil transactions.
- Public contract addresses and reproducibility data remain visible because they are not secrets.

### Deployment target and status

- Target: Vercel static hosting.
- Build command: `pnpm build`.
- Output directory: `dist/operator-console`.
- Root directory: repository root.
- Public URL: `https://setpoint-neon.vercel.app`.
- The authenticated Vercel CLI created project `karagozs-projects/setpoint`, connected it to `https://github.com/karagozemin/setpoint`, and assigned the stable production alias above.

### Errors and corrections

- The pre-readiness bundle eagerly imported all core and security JSON into the main JavaScript. The scenario catalog now contains metadata only and fetches the selected checked-in artifact on demand.
- The first `demo:check` run scanned Node-based test files as browser sources and correctly rejected their `node:` imports. The scan boundary was corrected to exclude test-only files while continuing to inspect every shipped frontend source and emitted file.
- Runtime evidence previously could not express fetch or malformed-JSON failures because data was compiled into the bundle. The new loader exposes a dedicated application/evidence error state and never represents delivery failure as `NO_TRADE`.

### Validation and freeze

```bash
pnpm install --frozen-lockfile
pnpm security:demo
pnpm typecheck
pnpm test
pnpm build
pnpm demo:check
```

- 76/76 tests pass.
- Security invariants remain 11/11.
- All required production evidence URLs resolve from the static bundle and match their sources byte-for-byte.
- The live root and required evidence URLs return HTTP 200 with the configured CSP, referrer, permissions, framing, and content-type protections.
- Headless Chrome inspection passed for the desktop default, normal, stale-oracle, one safety case, and 520px compact layouts.
- The public-output safety scan passes.
- Existing M4.2 scenario outcomes remain unchanged.
- No file under `src/core/` or `integrations/rwa-index/` changed.
- M2 planner SHA-256 remains `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.

### Remaining limitations

- This is a historical evidence console, not a production execution service. It has no live refresh, wallet, transaction submission, authentication, or production funds.
- Evidence availability depends on the static host serving the emitted JSON files. Delivery failures are reported as application errors.
- The public demo is tied to Vercel availability and the `setpoint-neon.vercel.app` alias; no custom domain is configured.
- External founder validation and hackathon/Founder House presentation work have not started.

## 2026-09-26 — Security and failure demonstrations

### Implemented

- Added deterministic evidence for stale accounting, a policy-breaking target, an unsupported route, unsafe residual liquidity, and an unknown simulation failure under `artifacts/security/`.
- Added `pnpm security:demo`, which builds the five artifacts from the frozen hybrid core or accepted fork evidence, validates their invariants, verifies source hashes, and writes `security-summary.json`.
- Reused the accepted stale-oracle and large-target M4.2 fork artifacts. No historical artifact or benchmark outcome was overwritten.
- Added a policy-validation fixture whose 95% target exceeds the allowlisted asset's 80% maximum. This proves Setpoint policy rejection, not actor-level authorization in the external vault.
- Added an unsupported asset-to-asset route fixture that preserves the rejected leg in evidence and stops before simulation.
- Added an `UNKNOWN_REVERT` simulation fixture proving unknown failures cannot enter the recoverable fallback path.
- Recorded the explicit recoverable simulation allowlist and eleven security invariants, including simulation gating, safe residual refusal, confirmed-state re-read, authorization boundary, and UI/policy separation.
- Added [the security model](./docs/SECURITY.md) with trust assumptions, addressed threats, and explicit out-of-scope threats. It makes no audit or formal-verification claim.
- Added a compact Safety cases selector to the existing operator console. The three accepted M5 flows remain unchanged and all safety screens are mapped from raw artifacts through a presentation-only adapter.

### Evidence levels and results

| Scenario | Level | Result |
|---|---|---|
| Stale oracle | Fork evidence | `STALE_PRICE`; zero fallback, legs, and turnover |
| Policy-breaking target | Integration test evidence | `INVALID_POLICY`; no simulation, fallback, or execution |
| Unsupported route | Integration test evidence | `UNSUPPORTED_ASSET` with `UNSUPPORTED_ROUTE` evidence; no fallback or execution |
| Unsafe liquidity | Fork evidence | 10-leg fast path fails `INSUFFICIENT_OUTPUT`; 3 safe legs and 22.5% turnover execute; residual USDC→NFLX ends `NO_SAFE_LIQUIDITY` |
| Unknown failure | Integration test evidence | `UNKNOWN_REVERT`; no fallback or execution |

The unsafe-liquidity artifact preserves the accepted observations: drift improves from 31.025554% to 19.113279%, attempted simple turnover is 60.051107% of NAV, and the confirmed-state re-read occurs before the residual no-trade decision.

### Tests and validation

Added tests for every required fail-closed outcome, the recoverable allowlist, simulation-gated fallback, failed-plan non-execution, unsupported-leg preservation, unchanged normal and large-target behavior, deterministic artifact generation, checked-in artifact parity, UI evidence mapping, and the frozen M2 hash.

```bash
pnpm install --frozen-lockfile
pnpm security:demo
pnpm typecheck
pnpm test
pnpm build
```

Validation results:

- deterministic evidence generation passed with 11/11 invariants held;
- core and presentation typechecks passed;
- 74/74 tests passed;
- Vite production build passed and emitted all allowlisted raw security evidence exports;
- accepted M4.2 normal and large-target figures remained unchanged; and
- M2 planner SHA-256 remains `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.

### Errors encountered and corrections

- The first new fallback-allowlist test passed a synchronous planner where the hybrid interface requires an asynchronous planner. The fixture was corrected to use an async wrapper; no production behavior changed.
- The unsafe-liquidity wrapper initially inferred preflight success from the presence of fast-path evidence. It now reads the recorded `preflightPassed` field directly from the accepted M4.2 artifact.
- Security evidence initially had no UI representation. A separate artifact-to-view-model adapter was added; it deliberately leaves portfolio snapshots and trade arrays empty when the compact security artifact does not contain them.

### Assumptions, fork-only behavior, and remaining blockers

- Fork evidence is historical Robinhood Chain testnet evidence. Oracle refresh, role impersonation, pool synchronization, strategy changes, and execution occurred only on disposable Anvil forks.
- Integration-test evidence uses deterministic confirmed-state fixtures and the real frozen hybrid solver, but it was not observed onchain and is labeled accordingly.
- The malicious-target demonstration covers Setpoint's constrained policy boundary. The external RWA integration does not provide evidence for actor-level target-change authorization, so none is claimed.
- Precise oracle age is unavailable in the existing stale artifact and remains unreported.
- The current evidence does not solve compromised admins, false-but-fresh oracles, compromised RPC, external smart-contract bugs, key compromise, MEV guarantees, production manipulation outside configured limits, or cross-venue risk.
- No core safety bug was found. No file under `src/core/` or `integrations/rwa-index/` changed, and no solver, benchmark, or vault behavior was modified.
- There is no public deployment or external validation in this milestone. Those remain intentionally blocked pending review.

## 2026-09-26 — M5 operator console

### Implemented

- Added a Vite 8, React 19, and TypeScript operator console at the repository root with `pnpm dev`, `pnpm build`, and `pnpm preview` commands.
- Added a deterministic presentation adapter in `web/data/` that maps the existing M4.2 summary and hybrid scenario artifacts into `OperatorScenarioViewModel`; React components contain no solver, portfolio, liquidity, or failure-classification logic.
- Added the required demo scenarios: normal `FAST_PATH`, large-target `ADAPTIVE_FALLBACK`, and stale-oracle `NO_TRADE`.
- Added exact ordered trade views for the simple batch and selected safe subset, plus artifact-backed resized, removed, and blocked-leg evidence.
- Added policy guards, portfolio target bands, before/after confirmed state, simulation provenance, execution hash, fork/testnet labeling, and direct raw-artifact view/download actions.
- Added an explicit application error boundary so UI failures remain distinct from typed `NO_TRADE` outcomes.
- Added responsive desktop, laptop, and compact-screen layouts with keyboard focus states and non-color status labels.
- Added the captured console image at `docs/images/operator-console.png` and documented local UI operation in the README.

### Artifact adapter

```text
artifacts/m4-2-summary.json + artifacts/hybrid/*.json
                         ↓
              web/data/adapter.ts
                         ↓
             OperatorScenarioViewModel
                         ↓
               React presentation only
```

The production build copies the actual `artifacts/hybrid/*.json` files as static evidence exports. It does not reconstruct replacement JSON in the browser.

### Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

Results:

- core and presentation typechecks passed;
- 62/62 tests passed, including nine artifact/view-model tests;
- Vite production build passed;
- 1440px desktop and compact-screen headless Chrome renders were inspected;
- direct raw-evidence serving was verified against `large-target-change.json`; and
- M2 planner SHA-256 remains `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`.

### Errors and corrections

- The first UI mapping displayed aggregate attempted turnover for the large-target scenario (`120.259613%`). M4.2 intentionally counts both failed attempts and the executed fallback in that aggregate. The operator story requires the original simple-plan figure, so the adapter now derives `60.051107%` from the artifact's fast-path expected turnover and authoritative initial NAV; executed turnover remains the recorded `22.500000%`.
- Vite initially warned that a TypeScript config was loaded as CommonJS. Renaming it to `vite.config.mts` removed the warning without changing repository module semantics.
- Pointing Vite's public directory directly at the imported artifact folder caused development warnings. A narrow Vite plugin now serves and emits only the three allowlisted source artifacts under `/evidence/`, without copying or reconstructing their contents in application code.

### Assumptions, fork-only behavior, and limitations

- The console is a reliable static demo over accepted, versioned evidence. It does not trigger Anvil or expose shell execution in the browser.
- NAV is denominated in the deployment's 18-decimal mock USDC. All fork executions and transaction hashes are explicitly labeled fork-only.
- The stale-oracle artifact does not record a trustworthy portfolio snapshot or precise oracle age, so the UI shows those values as unavailable instead of fabricating them.
- The UI presents three required scenarios. Thin, asymmetric, and defensive artifacts are retained but are not exposed in the initial selector.
- There is no authentication, persistence, live RPC refresh, production transaction submission, public deployment, or external validation in M5.
- No file under `src/core/` or `integrations/rwa-index/` changed. Hybrid selection, M2, M4.1, liquidity sampling, failure taxonomy, vault behavior, and benchmark results remain frozen.

## 2026-09-26 — PRD v1.2 hybrid source of truth

### Implemented

- Added `Setpoint_PRD_v1_2.md` as the product and engineering source of truth.
- Added `Setpoint_PRD_v1_1_to_v1_2_CHANGELOG.md` with the concise revision summary.
- Updated the README positioning and PRD reference.
- Incorporated the accepted M0–M4.2 evidence and froze simple `FAST_PATH`, allowlisted `ADAPTIVE_FALLBACK`, and fail-closed `NO_TRADE` behavior.
- Defined M5 as the next operator-console milestone without implementing UI or changing execution code.

### Validation

```bash
git diff --check
pnpm typecheck
pnpm test
```

The PRD values were cross-checked against `artifacts/m4-2-summary.json`, the M4.2 cycle artifacts, and `docs/decisions/0001-hybrid-rebalance-orchestration.md`.

### Assumptions and limitations

- PRD v1.1 remains in the repository as the historical source document.
- PRD v1.2 is Markdown-first so it is directly reviewable and diffable; no new PDF toolchain was added.
- No M5 code, production adapter, benchmark rerun, or onchain mutation was part of this documentation revision.

## 2026-09-26 — M4.2 hybrid fast path and adaptive fallback

### Product decision

The previous assumption was that adaptive sizing should be Setpoint's default rebalance strategy. M2 versus M4/M4.1 evidence showed that straightforward coherent batches are faster or equivalent in ordinary scenarios, while adaptive planning adds clear value when the straightforward batch cannot execute.

The accepted decision is documented in `docs/decisions/0001-hybrid-rebalance-orchestration.md`: simple safe execution is the default; M4.1 is an explicit fallback for stressed or unexecutable rebalances. Setpoint does not try to beat a simple batch that already works. It preflights execution, rescues safe portfolio progress when possible, refuses unsafe residual trades, and re-solves from confirmed state.

### Implemented

- Added `src/core/hybrid-solver.ts` with explicit `FAST_PATH`, `ADAPTIVE_FALLBACK`, and `NO_TRADE` outcomes and deterministic mode-selection reasons.
- Fast path uses the unchanged M2 planner output, then checks input validity, allowlisted USDC-hub routes, ordering, balances, per-leg caps, optional turnover/minimum-cash policies, exact-size current executable quotes, min-out compatibility, impact, expected NAV loss, and the real vault simulation.
- Added exact fast-path amounts to the real `SynthraSwapAdapter.swap()` sampling set without changing the M2 planner.
- Added an explicit recoverability mapping. Adaptive fallback is limited to output, size, balance, drift-improvement, value-loss, and related executable-liquidity constraints.
- Reused the M4.1 multi-leg solver without introducing a second adaptive implementation.
- Persisted fast-path trades, preflight issues, fast simulation, selected mode/reason, fallback trigger, adaptive result, costs, rejected legs, and confirmed post-state per cycle.
- Added scenario- and cycle-level adaptive fallback rates and separate M4.2 artifact directories.
- Added `pnpm m4:hybrid` with fresh Anvil lifecycle and artifact validation against both historical M4 and M4.1 baseline hashes.
- Added 16 hybrid tests. The full suite contains 53 passing tests.

### Failure mapping

Recoverable simulation failures:

- `INSUFFICIENT_OUTPUT`
- `TRADE_TOO_LARGE`
- `INSUFFICIENT_BALANCE`
- `DRIFT_NOT_IMPROVED`
- `EXCESSIVE_VALUE_LOSS`

Recoverable preflight failures include missing/exceeded executable depth, missing exact-size quote, min-out incompatibility, excessive impact/expected loss, per-leg or turnover caps, conservative balance/minimum-cash violations, and an empty simple plan.

Non-recoverable conditions include stale/missing prices, stale liquidity, invalid NAV/policy/targets, paused vault, unsupported asset/route, malformed order or trade, loose min-out construction, unauthorized execution, slippage-policy construction errors, and unknown reverts. These select `NO_TRADE`; adaptive fallback is not invoked.

### Commands and artifacts

```bash
pnpm typecheck
pnpm test
pnpm m4:hybrid
```

Output:

- `artifacts/liquidity-m4-2/*.json`
- `artifacts/hybrid/*.json`
- `artifacts/comparison-m4-2/*.json`
- `artifacts/m4-2-summary.json`

Final validation fork:

- block: `124725774`
- block hash: `0xb5fcc713b8f099c630eb808e65dff914fc3d5ee723abda8e29c680482766bc87`
- chain ID: `46630`
- M2 planner SHA-256: `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92`

### Equivalent-state results

| Scenario | Selected mode | M2 final drift | M4.2 final drift | Executed batches / legs | Terminal result |
|---|---|---:|---:|---:|---|
| Stale oracle | `NO_TRADE` | unavailable | unavailable | 0 / 0 | `STALE_PRICE`; no fallback |
| Moderate, deeper toy | `FAST_PATH` | 0.075394% | 0.075394% | 1 / 6 | target bands satisfied |
| Moderate, thin toy | `FAST_PATH` | 0.143624% | 0.143624% | 1 / 6 | target bands satisfied |
| Asymmetric liquidity | `FAST_PATH` | 0.072184% | 0.072184% | 1 / 6 | target bands satisfied |
| Large target change | `ADAPTIVE_FALLBACK`, then `NO_TRADE` | 31.025554% | 19.113279% | 1 / 3 | safe subset, then `NO_SAFE_LIQUIDITY` |
| Defensive 20% cash | `FAST_PATH` | 0.063295% | 0.063295% | 1 / 5 | target bands satisfied |

All four normal non-stale scenarios used the simple path, avoided adaptive work, and matched M2's final state, turnover, leg count, and NAV delta. No normal scenario became worse.

The large-target proof is explicit in the cycle artifact: the 10-leg, 60.051107%-NAV simple batch passed Setpoint preflight but failed the real vault simulation with `INSUFFICIENT_OUTPUT`; hybrid orchestration then selected M4.1, executed a three-leg 22.5%-NAV safe subset, and reduced drift from 31.025554% to 19.113279%. The next confirmed cycle again preflighted the new simple batch, observed incompatible USDC→NFLX liquidity, invoked fallback, and returned `NO_SAFE_LIQUIDITY` without execution.

Across the five eligible scenarios, one required fallback (20%). Across six eligible solve cycles, two required fallback (33.333333%). Stale input is excluded because fallback is prohibited before eligibility.

### Errors and corrections

- The first hybrid fork run treated the cash target band's lower edge as a hard reserve, causing the safe defensive batch to invoke fallback unnecessarily. The hard preflight reserve is now only the explicit `minimumCashBuffer`; the cash target remains a convergence objective verified from confirmed post-state. Defensive then selected `FAST_PATH` and exactly matched M2.
- Failed fast-path turnover is counted as attempted but never executed. Large-target aggregate attempted turnover therefore includes both failed simple preflights and the selected adaptive batch; executed turnover remains the actual 22.5% subset.

### Remaining limitations

- Exact-size quotes are state-bound preflight evidence, not a proof of multi-leg sequential pool output; the real vault simulation remains the final gate.
- Recoverability is an explicit conservative mapping. Unknown failures never fall through to adaptive retries.
- The final normal scenarios did not exercise a mode switch after an execution; confirmed-state re-read and cross-cycle mode changes are covered in unit tests, while large-target demonstrates fallback followed by terminal no-trade on the next confirmed state.
- Liquidity remains a single toy Synthra route. There is no gas model, CoW/0x, cross-vault netting, custody, new accounting, UI, or production liquidity claim.
- M4.2 is complete for review. M5/UI was not started.

## 2026-09-26 — M4.1 multi-leg adaptive batch planner

### Implemented

- Added a chain-independent portfolio-level batch solver that combines all relevant safe stock→USDC sells and USDC→stock buys into one ordered `Trade[]`.
- Added conservative intra-batch capital accounting: only sell-leg `minAmountOut` can fund buys, input balances cannot be overspent, and cash floors are preserved.
- Added midpoint convergence for weights that begin outside their ranges. Assets already inside a range are not moved to midpoint solely for cosmetic precision.
- Added a deterministic bounded search: maximal feasible batch plus one local reduction/removal per directional leg. Candidates are compared lexicographically by expected target-band drift, quote loss, turnover, minimum safety margin, leg count, and stable ID.
- Added selective `INSUFFICIENT_OUTPUT` backoff using the tightest safety-margin leg and its next smaller executable curve sample. Independent legs remain in the rebuilt batch.
- Added per-leg desired/selected/maximum-safe sizes, binding constraint, curve/sample, expected output, oracle-floor `minAmountOut`, expected quote loss, and safety margin.
- Added terminal excluded-leg evidence, including no compatible sample and no remaining portfolio-level safe progress.
- Added `pnpm m4:batch`, separate M4.1 artifacts, and runtime artifact validation.
- Added nine batch-solver tests. The complete suite now passes 37/37 tests.

### Construction algorithm

For every confirmed state, the RWA integration samples all materially relevant directions through the real deployed `SynthraSwapAdapter.swap()` path. Out-of-band assets are sized toward the midpoint of their accepted range to avoid boundary-chasing after quote loss changes NAV. The solver caps every direction by target distance, balance, the vault's per-leg cap, sampled executable depth, price-impact policy, cash policy, and optional turnover policy.

Buys are allocated from starting USDC above the required cash goal plus the sum of conservative sell `minAmountOut` values. The selected sells are then rebuilt against the exact funded buy spend. If discrete samples do not cover it, only the lowest-priority buy is reduced or removed. All sells precede buys.

The maximal candidate and one local backoff/removal per leg form the bounded candidate set. There is no combinatorial subset search or weighted score. The best lexicographic candidate must strictly reduce projected target-band drift and pass the real vault simulation. A successful fork transaction is followed by a confirmed state read and complete re-sampling.

### Commands and artifacts

```bash
pnpm typecheck
pnpm test
pnpm m4:batch
```

Output:

- `artifacts/liquidity-m4-1/*.json`
- `artifacts/solver-v2-batch/*.json`
- `artifacts/comparison-m4-1/*.json`
- `artifacts/m4-1-summary.json`

Final validation fork:

- block: `124716128`
- block hash: `0xac02366b6bea0ae2f95508500f3a8d95e4c217aa7b35348d781c1d580f3d2025`
- chain ID: `46630`
- M2 planner SHA-256: `dcd079ed25ff6fd7683c947fbf46748abd70862fe2a85a368c919b26fe7cee92` (identical to M4)

### Equivalent-state results

| Scenario | M2 baseline | M4.1 batch planner | Target bands: M2 / M4.1 |
|---|---|---|---|
| Stale oracle | `STALE_PRICE`, 0 executions | `STALE_PRICE`, 0 batches | no / no |
| Moderate, deeper toy | 0.075394%, 1 batch, 6 legs | 0.038903%, 3 batches, 13 legs | yes / yes |
| Moderate, thin toy | 0.143624%, 1 batch, 6 legs | 1.237000%, 1 successful batch, 2 solve cycles, 5 legs, then no safe liquidity | yes / no |
| Asymmetric liquidity | 0.072184%, 1 batch, 6 legs | 0.077219%, 2 batches, 7 legs | yes / yes |
| Large target change | 31.025554%, 0 executions; first 10-leg batch fails | 19.113279%, 1 successful batch, 2 solve cycles, 3 legs, then no safe liquidity | no / no |
| Defensive 20% cash | 0.063295%, 1 batch, 5 legs | 0.063295%, 1 batch, 5 legs | yes / yes |

M4.1 improves materially over one-pair M4: deep moves from 8 batches/outside range to 3/inside; asymmetric from 6 batches and `NO_SAFE_LIQUIDITY` at 4.391698% to 2/inside; defensive from 8 batches/outside to 1/inside; and large-target drift improves from 20.320383% after two M4 steps to 19.113279% after one coherent batch. Thin improves from 1.452714% to 1.237000% but still cannot finish.

M2 remains faster on all four normal non-stale scenarios where it succeeds. It also finishes thin while M4.1 does not. M4.1's demonstrated complement remains safety under stressed sizing: in the large scenario M2 attempts 60.051107% NAV turnover, fails simulation, and executes nothing; M4.1 executes 22.5% turnover as a safe subset before stopping.

The binding terminal route in both thin and large is USDC→NFLX: even the sampled sizes have no output compatible with the vault's 98%-of-oracle floor. M4.1 retains the other sell directions as `NO_PORTFOLIO_LEVEL_SAFE_PROGRESS`; it does not submit a doomed batch. No benchmark result was forced.

### Errors encountered and corrections

- The first live batch run still converged geometrically toward band edges and hit the cycle cap. Quote loss changes NAV after each trade, so selecting exact entry boundaries recreated tiny residual violations. Out-of-band destinations now use the band midpoint, while in-range positions remain untouched unless needed for a safe one-sided correction.
- The initial midpoint capital-accounting change reserved the current in-range cash balance and made discrete sell samples unable to fund matching buys in unit tests. Required funding now preserves the cash floor, while sell capacity may use the full allowed cash range; all buy funding still uses conservative `minAmountOut`.
- Initial terminal no-trade records dropped catalog exclusions. Typed no-trade results now retain unavailable/binding leg evidence, and aggregate removed-leg metrics include the terminal cycle.

### Assumptions, fork-only behavior, and remaining limits

- All M4 assumptions remain: 60-second state-bound quote life, one deployed Synthra route, fork-only mock-USDC probe funding, unchanged vault guards, and no gas estimate.
- The bounded search does not prove a continuous mathematical optimum between samples and intentionally avoids unbounded subset enumeration.
- No simulation failure occurred in the final scenario matrix; selective failure localization is covered by deterministic unit tests. Every executed batch passed the real vault simulation gate.
- The toy pools are not evidence of production liquidity. Oracle refresh, pool synchronization, role impersonation, strategy changes, and executions remain disposable-fork-only.
- No UI/M5, CoW/0x adapter, new DEX, custody, cross-vault netting, contract modification, or AI execution logic was added.
- M4.1 is complete for review. No later milestone was started.

## 2026-09-26 — M4 liquidity-aware adaptive sizing

### Implemented

- Added reusable liquidity snapshots, curves, samples, validity metadata, effective value rate, price impact, known fee, quote loss, and executable-size fields to Setpoint core.
- Added deterministic Solver v2 candidate construction and lexicographic ranking: hard constraints first, then expected target-band drift, quote loss, turnover, min-out safety margin, leg count, and stable candidate ID.
- Added adaptive sizing bounded by target-region distance, deployed per-leg cap, available balance, cash buffer/range, optional turnover policy, executable quote compatibility, and quote freshness.
- Added bounded `INSUFFICIENT_OUTPUT` rebuilding using the binding curve/sample. It selects a smaller sampled alternative rather than blind repeated halving and persists rejected candidates.
- Added non-null expected-cost estimates for Solver v2 plans. Quote loss includes fee and price impact; the known pool fee is also reported as a component and is not added twice. Gas remains unavailable.
- Added a real RWA quote sampler and isolated artifacts for liquidity curves, Solver v2 runs, and equivalent-state comparisons.
- Added eleven adaptive solver tests. The combined suite now has 28 passing tests, including an explicit unchanged-M2-output test.

### Executable quote source

The deployed adapter's `quote()` reads only `slot0` and is explicitly advisory in the upstream source. M4 therefore does not use it as depth.

For each relevant USDC-hub direction, the sampler:

1. snapshots the current confirmed Anvil state;
2. grants the vault temporary input-token allowance and, only for the permissionless mock USDC probe, temporary inventory;
3. invokes the real deployed `SynthraSwapAdapter.swap()` implementation with `eth_call` at 13 increasing sizes from 1/256 of directional need through the full need, plus exact cash-boundary sizes;
4. records the returned pool execution output, oracle output, impact, fee, quote loss, min-out compatibility, state ID, block, and expiry; and
5. reverts the probe snapshot, leaving the scenario state unchanged.

Every executed solver step is still separately simulated through the real vault `rebalance(Trade[])` entry point.

### Common benchmark terminal criterion

The comparison's primary completion condition is: cash and all assets are inside the same ±0.25 percentage-point target bands. The following are reported independently:

- target-band satisfied;
- deployed 5% vault drift trigger satisfied; and
- failure/no-trade/max-cycle terminal reason.

For this benchmark only, both planners may continue below the informational 5% trigger until target bands, a hard failure/no-trade, or the shared scenario cycle cap. No onchain guard is changed. The standalone M2 runner, planner, scenarios, and versioned M2 artifacts remain unchanged.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm m4:adaptive
```

Output:

- `artifacts/liquidity/*.json`
- `artifacts/solver-v2/*.json`
- `artifacts/comparison/*.json`
- `artifacts/m4-summary.json`

### Observed equivalent-state results

Final validation fork:

- block: `124702524`
- block hash: `0x2d68067a4e1e0e149502c55e84bee780b2f76ced434a4c31b8d3e9f3a4ce6a8d`
- chain ID: `46630`

| Scenario | M2 baseline | Solver v2 | Target bands: M2 / v2 | Vault trigger: M2 / v2 |
|---|---|---|---|---|
| Stale oracle | `STALE_PRICE`, 0 steps | `STALE_PRICE`, 0 steps | no / no | no / no |
| Moderate, deeper toy | 0.075394%, 1 step | 1.025983%, 8 steps, cycle cap | yes / no | yes / yes |
| Moderate, thin toy | 0.143624%, 1 step | 1.452714%, 8 steps, cycle cap | yes / no | yes / yes |
| Asymmetric liquidity | 0.072184%, 1 step | 4.391698%, 6 steps, no safe liquidity | yes / no | yes / yes |
| Large target change | 31.025554%, 0 steps, `INSUFFICIENT_OUTPUT` | 20.320383%, 2 steps, no safe liquidity | no / no | no / no |
| Defensive 20% cash | 0.063295%, 1 step | 1.260725%, 8 steps, cycle cap | yes / no | yes / yes |

These results do not support a general “Setpoint is better” claim. The baseline is better on target-band completion, final drift, and step count in four non-stale scenarios. Solver v2's demonstrated advantage is narrower: it avoids the large batch failure, executes two safe transitions, and limits attempted turnover, but it still finishes with higher drift than M3's earlier trajectory and cannot continue once NFLX's executable curve falls below the vault floor.

At the large-target terminal state, even the smallest NFLX buy sample (1/256 of the remaining directional need) has more than 2% oracle-relative loss; `maximumExecutableAmountIn` is zero. The solver therefore returns `NO_SAFE_LIQUIDITY` without submitting a doomed vault simulation. This is the observed limiting pool condition, not forced success.

### Errors and corrections

- The first implementation pass used eight linear points. Near target bands, the smallest point could exceed available cash capacity, causing a false `NO_SAFE_LIQUIDITY`. Sampling now includes geometric small sizes and exact cash-boundary points.
- Initial curve maxima used the full min-to-max band headroom while candidates used only distance-to-entry. That made the largest samples unusable. Directional sampling now uses the same target-entry distance as candidate sizing.
- Solver v2 initially omitted higher-priority use of an in-range asset when a one-sided violation remained. It now permits that only when needed to resolve the out-of-range asset, and supports one-sided cash-capacity corrections.
- The adapter's spot `quote()` was rejected as a depth source after upstream inspection; executable `swap()` calls are used instead.

### Assumptions and fork-only behavior

- Liquidity curves are valid only for their exact confirmed state ID and expire after 60 seconds. Every successful transaction forces a state re-read and full re-sample.
- The pool fee is the deployed fee tier (`100`, or 0.01%). Quote loss is measured in the vault's USDC numeraire against oracle value.
- Probe funding uses the permissionless testnet mock-USDC `mint()` and temporary allowance only inside a reverted Anvil snapshot. It is not a live execution mechanism.
- Pool labels remain relative toy-liquidity descriptions and are not production depth claims.
- All strategy changes, probes, and executions are local-fork-only.

### Remaining limitations

- Discrete sampling does not prove the mathematical optimum between sampled sizes.
- The quote model covers the deployed single Synthra route only; there is no venue routing, CoW, 0x, or cross-vault netting.
- Gas cost is not estimated.
- Pool state can become incompatible with the fixed oracle floor after Setpoint's own trades. Without external liquidity/price restoration, no further safe trade exists on that route.
- M4 is complete for review; M5/UI was not started.

## 2026-09-26 — M3 Setpoint Solver v1

### Implemented

- Added chain-independent canonical types for portfolio state, policy, ranges, prices, trades, plans, simulations, rejected alternatives, and typed no-trade outcomes.
- Added target-range classification and feasibility validation before candidate generation.
- Added a deterministic one-step USDC-hub solver with hard-constraint-first ordering, address-based tie-breaking, available-balance checks, optional turnover/improvement/cash policies, and a mandatory simulation gate.
- Added simple deterministic halving only for M3-eligible failures. `INSUFFICIENT_OUTPUT` is intentionally not resized because that requires the M4 liquidity/depth model.
- Added an RWA Index adapter that reads the deployed vault's actual state, targets, prices, and guards and simulates the exact `rebalance(Trade[])` interface.
- Extracted the exact M2 scenario policies into a shared module so M2 and M3 cannot silently diverge.
- Added an isolated M3 runner and artifacts. After each executed step it discards the old plan, reads confirmed fork state, and solves again.
- Added nine solver tests; the combined M2/M3 suite now contains 17 passing tests.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm m3:solver
```

Generated output:

- `artifacts/solver-v1/stale-oracle.json`
- `artifacts/solver-v1/moderate-drift-deep-toy.json`
- `artifacts/solver-v1/moderate-drift-thin-toy.json`
- `artifacts/solver-v1/asymmetric-liquidity.json`
- `artifacts/solver-v1/large-target-change.json`
- `artifacts/solver-v1/defensive-cash-target.json`
- `artifacts/solver-v1-summary.json`

### Solver behavior

For each confirmed state:

1. Validate NAV, pause state, allowlist, positions, prices, freshness, target feasibility, and policy bounds.
2. Stop with a typed result when the configured target region is reached or authoritative drift is at/below the deployed trigger.
3. Restore cash into its acceptable range first when necessary.
4. Otherwise choose the largest out-of-range source and destination, with token address as the deterministic tie-break.
5. Cap each leg by the deployed absolute 10%-NAV value, available balance, cash policy, and range distance.
6. Construct the deployed 98%-of-oracle `minAmountOut` floor.
7. Accept a plan only after the real external vault simulation passes.
8. Execute only on Anvil, assert actual strict drift reduction and the NAV floor, then re-read and re-solve.

RWA exact targets are adapted to ranges of target ±0.25 percentage points. This tolerance is an explicit M3 integration policy, not a vault contract change. The deployed 5% drift trigger remains authoritative and can stop solving before every asset is inside that tighter range.

### Verified scenario matrix

Final validation fork:

- block: `124692520`
- block hash: `0xb68ec12972f8e4e230f31d1aee4c7790ac84c93e3c151de4785eb30a08d5e803`
- chain ID: `46630`

| Scenario | Initial drift | Final drift | Executed steps | Terminal result |
|---|---:|---:|---:|---|
| Stale oracle | unavailable | unavailable | 0 | `STALE_PRICE` before simulation |
| Moderate, relatively deep toy | 11.417713% | 1.479128% | 2 | `DRIFT_BELOW_TRIGGER` |
| Moderate, thin toy | 11.425554% | 1.538422% | 2 | `DRIFT_BELOW_TRIGGER` |
| Asymmetric liquidity | 11.043267% | 4.755752% | 2 | `DRIFT_BELOW_TRIGGER` |
| Large target change | 31.025554% | 19.506853% | 2 | `SIMULATION_REJECTED` / `INSUFFICIENT_OUTPUT` |
| Defensive 20% cash target | 20.000000% | 3.986560% | 4 | `DRIFT_BELOW_TRIGGER` |

The large-target scenario made two simulation-approved, executed steps and reduced authoritative drift before a later candidate hit the adapter output floor. The solver stopped without executing that rejected candidate. This establishes safe progress, not an M2-vs-M3 performance claim.

### Errors encountered and corrections

- The first full matrix run completed the deep scenario, then Anvil returned “block not found” after a snapshot revert reused a local block number. The adapter now identifies confirmed state from Anvil's authoritative latest block object instead of querying an invalidated explicit local block. The unchanged matrix then completed.
- Expected drift initially mixed the vault's exact-target `totalDrift()` with Setpoint's range-distance projection. Plan expectation fields now use range drift consistently; artifacts separately retain authoritative vault drift before and after execution.
- Basic backoff initially divided an already-rounded `minAmountOut`. It now recomputes the oracle floor from the reduced input to avoid a one-wei slippage-floor violation.

### Assumptions and fork-only behavior

- The RWA integration uses a ±0.25 percentage-point acceptable range around each deployed exact target.
- The vault's `totalAssets()`, `totalDrift()`, balances, targets, guard values, and oracle are authoritative; Setpoint does not reproduce vault accounting.
- The stale solver test replays the original deployed oracle timestamps onto a valid post-refresh portfolio input so validation can fail before simulation. M1/M2 independently record the actual vault stale-read revert.
- Oracle re-timestamping, pool synchronization, manager/syncer impersonation, gas funding, strategy changes, and rebalance execution occur only on disposable Anvil.
- Pool inventory is recorded for context but is not consumed by Solver v1.

### Deliberately deferred / remaining blockers

- No M3 implementation blocker remains; the scenario matrix and artifact schema checks complete reproducibly.
- M4 must add executable depth/quote inputs, cost-aware sizing, and liquidity-aware retry for `INSUFFICIENT_OUTPUT` before any comparative performance claim.
- Gas and expected execution cost remain `null` in M3 plans.
- Exact historical replay still requires an archival Robinhood Chain endpoint; the public RPC supports the latest-state path used here.

## 2026-09-26 — M2 truthful static baseline

### Implemented

- Added a deterministic static baseline matching the RWA Index planner boundary: oracle-valued deltas, 10%-NAV maximum legs, sells before buys, and vault-consistent minimum outputs.
- Kept liquidity/depth entirely outside baseline sizing.
- Added a six-scenario runner using isolated Anvil snapshots of one recorded source fork.
- Added actual-state re-reads after successful cycles; no expected state is reused as confirmed state.
- Persisted per-scenario and aggregate machine-readable artifacts.
- Added typed revert classification for stale price, size, slippage, adapter output, balance, drift, NAV loss, authorization, and asset failures.
- Added eight tests for caps, minimum output, delta detection, sequencing, determinism, recomputation, revert classification, and stale prices.

### Commands

```bash
pnpm typecheck
pnpm test
pnpm m2:baseline
```

Generated output:

- `artifacts/baseline/stale-oracle.json`
- `artifacts/baseline/moderate-drift-deep-toy.json`
- `artifacts/baseline/moderate-drift-thin-toy.json`
- `artifacts/baseline/asymmetric-liquidity.json`
- `artifacts/baseline/large-target-change.json`
- `artifacts/baseline/defensive-cash-target.json`
- `artifacts/baseline-summary.json`

### Baseline algorithm

For each confirmed state:

1. Calculate each stock's target value from vault NAV and its exact onchain target weight.
2. Split every excess/deficit into static chunks no larger than `NAV * maxTradeFraction`.
3. Convert overweight stock chunks to mock USDC first.
4. Spend mock USDC on underweight chunks second.
5. Set each `minAmountOut` to oracle-implied output times `(1 - slippageTolerance)`.
6. Simulate the whole batch against the external vault.
7. On success, execute only on Anvil and re-read the vault. On failure, record the reason and stop without depth-aware resizing.

Target-region completion uses the deployed trigger: `totalDrift() <= 5%`.

### Verified scenario matrix

Final validation fork:

- block: `124684453`
- block hash: `0x87b14680e6386f5622ed1765d10c258f34f5b84ac768d4ff88095d47c8636698`
- chain ID: `46630`

| Scenario | Initial drift | Final drift | Legs | Attempted turnover / NAV | Result |
|---|---:|---:|---:|---:|---|
| Stale oracle | unavailable | unavailable | 0 | 0% | Expected `STALE_ORACLE` no-trade |
| Moderate, relatively deep toy | 11.417713% | 0.075394% | 6 | 20.835426% | Reached region in one successful cycle |
| Moderate, thin toy | 11.425554% | 0.143624% | 6 | 20.851107% | Reached region in one successful cycle |
| Asymmetric liquidity | 11.043267% | 0.072184% | 6 | 20.086533% | Reached region in one successful cycle |
| Large target change | 31.025554% | 31.025554% | 10 | 60.051107% | Simulation failed: `INSUFFICIENT_OUTPUT`; no turnover executed |
| Defensive 20% cash target | 20.000000% | 0.063295% | 5 | 20.000000% | Reached region in one successful cycle |

The thin scenario passed; it simply retained more residual drift and incurred more NAV loss than the relatively deep toy scenario. This is an observation about this recorded toy-pool state, not a Setpoint performance claim. The large change demonstrates a concrete static-sizing failure against the adapter's output floor.

### Errors encountered and corrections

- The first scenario actor address used invalid mixed-case checksum formatting; it was corrected before any benchmark result was accepted.
- The initial large-target vector summed to 90%, so `setStrategy` correctly rejected it. The final vector plus cash target sums exactly to WAD.
- Initial exploratory reallocation scenarios used a 0% cash target. Their static buys consumed the full oracle-valued sale proceeds and failed with `ERC20InsufficientBalance` after DEX fees. The final deep/thin/asymmetric matrix uses an explicit 2% policy cash target for both baseline and future solver runs so liquidity effects are not conflated with a zero-cash funding shortfall.

### Assumptions and fork-only behavior

- Scenario policy changes use the deployed manager and `setStrategy` through Anvil impersonation.
- Existing stale price values are re-timestamped, then the real testnet syncer aligns the toy pools as in M1.
- Snapshot/revert isolates every non-stale scenario at the same prepared fork state.
- Pool token inventory is only a reproducible context proxy; it is not treated as a production quote curve or claimed market depth.
- All writes and scenario target changes exist only on the disposable fork.

### Remaining blockers and next work

- There is no M2 blocker: the control-group artifacts are reproducible with one command.
- The public RPC remains non-archival, so exact old-block replay requires an archival endpoint.
- M3/M4 must use these exact scenario inputs, guards, fork preparation, and metrics when implementing adaptive sizing.
- No comparative or Setpoint performance claim is made in M2.

## 2026-09-26 — M0/M1 external-vault harness

### Implemented

- Read all 35 pages of `Setpoint_PRD_v1_1.pdf` and kept the M0/M1 scope at the vault integration boundary.
- Initialized the previously unversioned folder as a git repository.
- Added RWA Index as a pinned submodule at upstream commit `b2456ca5400ba9ec36d81691554b889fb9250513`.
- Added a minimal TypeScript/viem harness and a single shell entry point that owns the disposable Anvil lifecycle.
- Added address/chain/upstream configuration for the external deployment.
- Verified deployed bytecode, chain ID, vault/oracle/adapter links, manager role, feeder role, and syncer ownership.
- Reproduced the deployed stale-oracle condition before mutation.
- Refreshed oracle timestamps on the fork through the authorized feeder without changing price values.
- Resolved and synchronized all five deployed fee-100 Synthra pools through the deployed pool syncer.
- Read real vault NAV, balances, target weights, cash target, drift, pause state, and guard parameters.
- Built, simulated, and fork-executed the vault's existing `rebalance(Trade[])` flow.
- Added generated JSON evidence with source block, prices, pool state, constraints, candidate attempts, trades, transaction receipt, before/after state, and invariant checks.

### Commands

```bash
git submodule update --init --recursive
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm m1:rwa-index
```

Output:

- `artifacts/rwa-index-m1-latest.json`
- `artifacts/anvil.log`

The latest JSON evidence is versioned; local Anvil logs are regenerated and ignored by git.

### Verified run

Source fork:

- block: `124678866`
- block hash: `0xac3f535eee43d8b2cec5fe29c73d610f093eb3c4bf905a78006adebe87ef09ed`
- chain ID: `46630`

Observed deployed constraints:

- maximum leg value: 10% of pre-batch NAV
- minimum output floor: 98% of oracle-implied output
- maximum price age: 86,400 seconds
- maximum batch NAV loss: 2%
- drift must strictly decrease
- vault paused: false

The current live state was already close to its equal-weight target. The first candidate therefore made a small correction rather than fabricating a large imbalance:

1. sell AMD into mock USDC;
2. buy NFLX with the sell leg's guaranteed minimum proceeds.

Measured fork result:

- `rebalance(Trade[2])` simulation: passed
- fork transaction: `0xb3a76d76ebfb5c1194e08fb0a3e6b9dbe7eae74fed0f274c67ca2a787e0e2381`
- drift: `0.057839%` → `0.045318%`
- NAV: `69.349575584908354972` → `69.349573584742543824` mock-USDC WAD
- strict drift decrease: passed
- 2% NAV floor: passed

These are local-fork results from the recorded source block, not live-chain transactions or benchmark claims.

### Errors and operational findings

- Before refresh, authoritative NAV/drift reads reverted with `StalePrice(TSLA)`. This is the expected deployed guard, not bypassed behavior.
- The public Robinhood testnet RPC is slow for sequential storage reads; the first end-to-end run took longer than a 30-second command-output window but completed normally.
- The upstream repository documents the public RPC as non-archival. Latest-state forking works; old explicit block numbers may fail once pruned.
- No private keys were required and no live-chain write was attempted.

### Assumptions

- All basket and base tokens in this deployment use 18 decimals. The harness verifies every token before applying WAD arithmetic.
- The vault's own oracle/NAV functions are authoritative. The harness does not recreate ERC-4626 share accounting.
- Reusing the deployed nonzero price values with fresh fork timestamps is sufficient for M1 because this milestone tests the stale guard and vault execution interface, not live market-data quality.
- Existing syncer inventory remains sufficient to move each toy pool to its retained oracle value. The harness fails loudly if that ceases to be true.

### Mocked or fork-only behavior

- Account impersonation for the oracle feeder/syncer owner and manager.
- Native gas funding for those impersonated accounts.
- Re-timestamping old oracle values on Anvil.
- Testnet-only pool synchronization using the deployed syncer.
- The base asset itself is the RWA Index project's mintable mock USDC.
- The final rebalance transaction exists only on the disposable fork.

### Remaining blockers and next work

- There is no M1 blocker: the exit criterion is met.
- Exact replay at an old block depends on an archival Robinhood Chain RPC. The default reproducible path therefore records and uses latest available state.
- M2 now supplies the truthful static baseline. The M3/M4 Setpoint solver and comparative benchmark remain unimplemented.
- Pool depth is toy-sized and must not be represented as production liquidity.
