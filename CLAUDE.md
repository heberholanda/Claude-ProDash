# Pro Dash: rules for every change and release

This repository is a Claude Code plugin whose code is a hooks module (a mod: `hooks/register.tsx`). Every change must keep it valid for `claude plugin validate`, `claude plugin test` and the plugin directory's checks at https://claude.ai/directory/manage. These rules come from that directory's findings; break none of them.

## Directory status

The directory accepts mods only from Verified organizations, and this account's organization is not one (no way to apply yet). A submission is refused with "Mods accepted only from Verified organizations" until that changes. Keep the code clean anyway: it is what a Verified listing, and the install from this repo's own marketplace, rely on.

## Code rules (hooks module)

- Never hook `tool.check`, `agent.spawn`, `agent.register`, `config.set` or `fs.write`. To know a call's permission verdict, ask `$.tool.check({ tool, input })` (a read-only query) from the `tool.call` hook.
- Every hook passes its event on unchanged: `return next(e)`, or `const r = await next(e)` and `return r`. Never change `e`, never answer for Claude Code.
- `$` appears only as `$.noun.method(...)` or as one whole argument to a top-level function. Do not pass `$` to helpers that schedule work (`$.clock.after` inside a helper was refused); keep counters in module memory and write them from the session's 1 s timer.
- Never declare `h`, `Fragment`, `jsx_*`, `jsxs_*`, `Fragment_*` (JSX compiles to them). Never declare a variable named `e` or `next`.
- Run programs by name with fixed arguments: `$.process.run(['git', ...])`. No `cmd /c`, `sh -c`, `bash -c`, `curl`, `wget`, `npx`. PowerShell only as one fixed string of cmdlet pipelines, with no `$variables`, `$(...)` or script blocks, and the output parsed in TypeScript.
- Network only through `$.http.fetch` to a literal host. No credential words (token, key, secret, password) near a URL; read no token, key or env credential.
- New logic gets a test in `tests/prodash.test.tsx`.

## README rules

- The section **What the mod runs, sends and hooks** names every program the mod runs (with its arguments and why), every hooked event in backticks, and everything that leaves the machine and where. Update it in the same change as the code.
- No download-and-run text: no `curl … | sh`, and no `git clone` followed by a run command in one code block.

## Manifest rules (`.claude-plugin/plugin.json`)

Keep `name`, `displayName`, `version`, `description`, `author`, `license`, `homepage`, `repository`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `keywords` and `icon` (`.claude-plugin/icon.png`, square PNG, 512–2048 px, under 2 MB). The directory keeps the first icon it sees; do not expect a later icon change to show.

## Release checklist

1. Bump `version` in `.claude-plugin/plugin.json` (semver: feature = minor, fix = patch).
2. `bash scripts/release-check.sh` prints `PASS`. It runs validate and tests and checks the rules above that can be checked mechanically.
3. Push, then re-validate the repository at https://claude.ai/directory/manage/new/plugin: no **Blocking** finding; each new policy hold is explained in the README.
4. `gh release create vX.Y.Z` with notes in the format of the previous releases (What's new, Update commands).
5. Commit messages, PR bodies and release notes carry no Claude or Co-Authored-By attribution.
