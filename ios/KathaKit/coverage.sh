#!/usr/bin/env bash
#
# coverage.sh — KathaKit line-coverage gate.
#
# Runs the SwiftPM test suite with coverage, extracts the TOTAL line-coverage %
# for Sources/KathaKit via llvm-cov, prints the summary, and EXITS NON-ZERO if
# coverage is below the threshold. Mirrors the backend's --cov-fail-under=95.
#
# Usage:  ./coverage.sh [threshold]     (default threshold: 95)
#
set -euo pipefail

THRESHOLD="${1:-95}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

echo "==> swift test --enable-code-coverage"
swift test --enable-code-coverage

# Locate the test bundle and the merged profile data robustly across toolchains.
XCTEST="$(find .build -name '*.xctest' -type d | head -1)"
PROFDATA="$(find .build -name 'default.profdata' | head -1)"

if [[ -z "$XCTEST" || -z "$PROFDATA" ]]; then
  echo "ERROR: could not locate .xctest bundle or default.profdata under .build" >&2
  exit 2
fi

# The test binary lives inside the bundle on macOS (Contents/MacOS/<name>) and at
# the bundle root on Linux. Prefer the macOS layout, fall back to the flat one.
BASENAME="$(basename "$XCTEST" .xctest)"
BINARY="$XCTEST/Contents/MacOS/$BASENAME"
if [[ ! -f "$BINARY" ]]; then
  BINARY="$XCTEST/$BASENAME"
fi
if [[ ! -f "$BINARY" ]]; then
  echo "ERROR: could not locate the test binary inside $XCTEST" >&2
  exit 2
fi

# llvm-cov ships inside the Swift/Xcode toolchain — invoke via xcrun when present.
if command -v xcrun >/dev/null 2>&1; then
  LLVM_COV=(xcrun llvm-cov)
else
  LLVM_COV=(llvm-cov)
fi

echo "==> llvm-cov report (Sources/KathaKit)"
REPORT="$("${LLVM_COV[@]}" report "$BINARY" -instr-profile "$PROFDATA" Sources/KathaKit)"
echo "$REPORT"

# The TOTAL row's line-coverage % is the 4th percentage-bearing column. Parse it
# from the TOTAL line: fields are Regions Missed Cover% Functions Missed Executed% Lines Missed Cover%...
TOTAL_LINE="$(echo "$REPORT" | grep '^TOTAL')"
# Extract all percentages on the TOTAL line; line coverage is the 3rd percentage.
PCT="$(echo "$TOTAL_LINE" | grep -oE '[0-9]+\.[0-9]+%' | sed -n '3p' | tr -d '%')"

if [[ -z "$PCT" ]]; then
  echo "ERROR: could not parse line coverage from TOTAL row" >&2
  exit 2
fi

echo ""
echo "Sources/KathaKit total line coverage: ${PCT}%  (threshold ${THRESHOLD}%)"

# Numeric comparison via awk (handles decimals; no bc dependency).
if awk -v p="$PCT" -v t="$THRESHOLD" 'BEGIN { exit !(p + 0 >= t + 0) }'; then
  echo "PASS: coverage meets the ${THRESHOLD}% gate."
  exit 0
else
  echo "FAIL: coverage ${PCT}% is below the ${THRESHOLD}% gate." >&2
  exit 1
fi
