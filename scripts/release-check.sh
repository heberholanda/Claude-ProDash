#!/usr/bin/env bash
# Pre-release gate for a Claude Code plugin with a hooks module (mod).
# Runs the CLI checks and the plugin-directory rules this repo has been through (see CLAUDE.md).
# It cannot run the directory's own scan: re-validate at https://claude.ai/directory/manage before releasing.
# Usage: bash scripts/release-check.sh        (from the repository root)
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
bad() { echo "FAIL: $*"; fail=1; }
ok() { echo "ok:   $*"; }

MODS=$(python -I -c "import json;print(' '.join('hooks/'+m.lstrip('./') for m in json.load(open('hooks/hooks.json'))['modules']))")

# 1. Claude Code's own checks
claude plugin validate . >/tmp/rc-validate.txt 2>&1 && ok "claude plugin validate" || { bad "claude plugin validate"; tail -20 /tmp/rc-validate.txt; }
claude plugin test . >/tmp/rc-test.txt 2>&1 && grep -q " 0 fail" /tmp/rc-test.txt && ok "claude plugin test" || { bad "claude plugin test"; tail -20 /tmp/rc-test.txt; }

# 2. Manifest: listing fields, icon, version bumped past the last tag
python -I - <<'PY' || fail=1
import json, os, struct, subprocess, sys
d = json.load(open('.claude-plugin/plugin.json', encoding='utf-8'))
need = ['name', 'displayName', 'version', 'description', 'author', 'license', 'homepage', 'repository',
        'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'keywords', 'icon']
miss = [k for k in need if not d.get(k)]
print(('FAIL: plugin.json is missing ' + ', '.join(miss)) if miss else 'ok:   plugin.json listing fields')
icon = d.get('icon', '')
w = h = 0
if os.path.isfile(icon):
    head = open(icon, 'rb').read(24)
    if head[:8] == b'\x89PNG\r\n\x1a\n': w, h = struct.unpack('>II', head[16:24])
good_icon = w == h and 512 <= w <= 2048 and os.path.getsize(icon) < 2 * 1024 * 1024
print('ok:   icon %dx%d PNG' % (w, h) if good_icon else 'FAIL: icon must be a square PNG, 512-2048 px, under 2 MB')
subprocess.run(["git", "fetch", "-q", "--tags"], capture_output=True)
tag = subprocess.run(["git", "describe", '--tags', '--abbrev=0'], capture_output=True, text=True).stdout.strip().lstrip('v')
same = tag and tag == d.get('version')
print(('FAIL: version %s equals the last tag; bump it' % tag) if same else 'ok:   version %s (last tag %s)' % (d.get('version'), tag or 'none'))
sys.exit(1 if miss or not good_icon or same else 0)
PY

# 3. Directory rules for the hooks module
for f in $MODS; do
  grep -nE "on\('(tool\.check|agent\.spawn|agent\.register|config\.set|fs\.write)'" "$f" && bad "$f hooks a permission-sensitive event (read the verdict with \$.tool.check from tool.call instead)"
  grep -nE "\b(const|let|var|function)\s+(h|Fragment|jsx_\w*|jsxs_\w*|Fragment_\w*)\b|for \((const|let) (h|Fragment) " "$f" && bad "$f declares h/Fragment (JSX compiles to them)"
  grep -nE "\b(const|let|var)\s+(e|next)\b" "$f" && bad "$f rebinds a hook parameter name (e/next)"
  grep -nE "'(cmd|sh|bash|zsh)'\s*,\s*'(/c|-c)'" "$f" && bad "$f runs a shell (cmd /c, sh -c); run the program by name"
  grep -nE "'(curl|wget|npx|bunx)'" "$f" && bad "$f runs a downloader/launcher; use \$.http.fetch or a pinned program"
  grep -nE "'-Command',\s*\`" "$f" && bad "$f builds a PowerShell command in a template literal; use one fixed string"
  grep -nE '.-Command.,\s*.[^'"'"']*\$[A-Za-z_(]' "$f" && bad "$f PowerShell command uses variables or \$(...); keep cmdlet pipelines only"
  grep -niE '(token|api[_-]?key|secret|password).{0,80}https?://|https?://.{0,80}(token|api[_-]?key|secret|password)' "$f" && bad "$f has a credential word next to a URL"
done
[ $fail = 0 ] && ok "directory rules in $MODS"

# 4. Disclosure: every hooked event and every program the mod runs is named in the README
for f in $MODS; do
  for ev in $(grep -oE "on\('[a-zA-Z.]+'" "$f" | sed "s/on('//;s/'//" | sort -u); do
    grep -q "\`$ev\`" README.md || bad "README does not name the hooked event \`$ev\`"
  done
  for prog in $(grep -oE "(process\.run\(|run\()\s*\[\s*'[A-Za-z0-9_.-]+'" "$f" | grep -oE "'[^']+'" | tr -d "'" | sort -u); do
    grep -q "\`$prog\`" README.md || bad "README does not name the program \`$prog\` the mod runs"
  done
done

# 5. Docs: no download-and-run in shipped text
grep -rnE "(curl|wget|iwr|irm)[^|\n]*\|\s*(sh|bash|iex|pwsh|powershell)\b" --include=*.md --include=*.ts --include=*.tsx --include=*.json . && bad "download-and-run pattern in shipped text"
grep -nA2 "git clone" README.md | grep -qE "plugin-dir|npm (i|install|run)|node |bash |sh " && bad "README chains git clone with a run command in one block"

# 6. No Claude attribution in commits since the last tag
git fetch -q --tags 2>/dev/null; range="$(git describe --tags --abbrev=0 2>/dev/null)..HEAD"; [ "$range" = "..HEAD" ] && range=HEAD
git log --format=%B $range | grep -qiE "co-authored-by:.*(claude|anthropic)|generated with \[?claude" && bad "a commit since the last tag carries Claude attribution"

echo
[ $fail = 0 ] && echo "PASS: ready for the directory re-validation and the release" || echo "Release blocked: fix the FAIL lines above"
exit $fail
