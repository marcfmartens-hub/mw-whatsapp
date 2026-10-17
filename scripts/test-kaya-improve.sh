#!/bin/sh
set -eu
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
./node_modules/.bin/tsc lib/kaya-improve/config.ts lib/kaya-improve/detect.ts lib/kaya-improve/zip.ts lib/kaya-improve/events.ts lib/kaya-improve/approve.ts lib/kaya-improve/pending.ts lib/kaya-improve/all-proposals.ts --outDir "$out" --rootDir lib --module commonjs --target es2020 --esModuleInterop --resolveJsonModule --skipLibCheck
./node_modules/.bin/tsc lib/auth.ts --outDir "$out/auth" --module commonjs --target es2020 --esModuleInterop --skipLibCheck
node scripts/kaya-auth-tests.cjs "$out/auth"
NODE_PATH="$PWD/node_modules" node scripts/kaya-recent-tests.cjs "$out/kaya-improve"
node scripts/kaya-improve-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-learning-v2-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-replay-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-watch-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-conversation-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-event-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-auto-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-finding-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-all-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-manual-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-publisher-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-repair-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-pending-tests.cjs "$out/kaya-improve"
NODE_PATH="$PWD/node_modules" node scripts/kaya-stress-tests.cjs "$out/kaya-improve"
python3 - "$out/kaya-improve/test.zip" <<'PY'
import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert z.read('before/lib/example.ts').decode()=='before 😊'
 assert z.read('after/lib/example.ts').decode()=='after ✓'
 assert 'before/new.txt' not in z.namelist()
 assert json.loads(z.read('manifest.json'))['id']=='test'
 print('ZIP contents, hashes, unicode and new-file backup round trip passed.')
PY
