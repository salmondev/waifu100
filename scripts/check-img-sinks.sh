#!/bin/sh
# T-0009 review M4: list every image sink and Serper call site for review.
cd "$(dirname "$0")/.." || exit 1
echo "== <img src=...> (src line within 3 lines of each <img)"
grep -rn -A3 --include='*.tsx' '<img' src | grep -v '\.test\.' | grep 'src='
echo "== element .src assignments"
grep -rnE --include='*.ts' --include='*.tsx' '\.src *= ' src | grep -v '\.test\.'
echo "== next/image / optimizer"
grep -rnE --include='*.ts' --include='*.tsx' "next/image|/_next/image\?" src | grep -v '\.test\.' || echo "(none)"
echo "== Serper call sites (must all be serperFetch)"
grep -rn --include='*.ts' --include='*.tsx' 'google.serper.dev' src | grep -v '\.test\.'
echo "== raw fetch to Serper (must be empty)"
grep -rnE --include='*.ts' --include='*.tsx' 'fetch\((SERPER_URL|"https://google\.serper)' src | grep -v serperFetch | grep -v '\.test\.' || echo "(none)"
