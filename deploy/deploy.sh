#!/bin/bash
# ZAXIRA USUL. Odatda deploy avtomatik: main branch'ga push → GitHub Actions (.github/workflows/deploy.yml).
# Bu skript faqat GitHub Actions ishlamay qolganda qo'lda yuklash uchun.
#
# Plesk shared hosting'ga deploy (Node.js extension / Passenger).
# Ishga tushirish: ./deploy/deploy.sh          — kodni yangilaydi, serverdagi DB'ga tegmaydi
#                  ./deploy/deploy.sh --with-db — lokal DB'ni ham yuklaydi (serverdagi ma'lumot o'chadi!)
set -euo pipefail
SERVER="host9529@45.138.159.2"
BS_VERSION="$(node -p "require('better-sqlite3/package.json').version")"
NODE_ABI="137"   # Plesk'dagi Node 24
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
B="$WORK/bundle"; mkdir -p "$B"

# 1. Standalone build
npm run build
cp -R .next/standalone/. "$B/"
cp -R public "$B/public"
cp -R .next/static "$B/.next/static"
rm -f "$B"/clamo_accreditation.db*
if [ "${1:-}" = "--with-db" ]; then
  sqlite3 clamo_accreditation.db 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
  cp clamo_accreditation.db "$B/"
fi

# 2. better-sqlite3 uchun Linux binary (lokal build macOS uchun)
curl -fsSL "https://github.com/WiseLibs/better-sqlite3/releases/download/v$BS_VERSION/better-sqlite3-v$BS_VERSION-node-v$NODE_ABI-linux-x64.tar.gz" \
  | tar xz -C "$WORK"
cp "$WORK/build/Release/better_sqlite3.node" "$B/node_modules/better-sqlite3/build/Release/"

# 3. Startup fayl va minimal package.json (Plesk'da "NPM install" bosilmasin)
cp deploy/app.js "$B/app.js"  # backoffice.env ni yuklaydi (serverda alohida turadi)
echo '{ "name": "clamo-accreditation-system", "version": "1.0.0", "private": true }' > "$B/package.json"

# 4. Yuklash va qayta ishga tushirish
(cd "$B" && COPYFILE_DISABLE=1 tar czf "$WORK/clamo.tgz" --no-xattrs .)
scp "$WORK/clamo.tgz" "$SERVER:clamo.tgz"
ssh "$SERVER" 'cd httpdocs && rm -rf .next node_modules && tar xzf ../clamo.tgz && rm ../clamo.tgz && mkdir -p tmp && touch tmp/restart.txt'
echo "✅ Yuklandi. Tekshirish: https://lochinbek-ai.uz"
