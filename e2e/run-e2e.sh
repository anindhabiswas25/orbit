#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# One-command e2e runner for the Orbit off-chain stack.
#
#   - boots a local Hardhat node
#   - deploys the full stack with a mock USDC (scripts/deploy-local.js)
#   - builds the SDK if needed
#   - runs e2e/e2e-flow.js (user flow + CLI + SDK + backend + live agents)
#   - tears the node down on exit
#
# Usage:  npm run test:e2e   (or)   bash e2e/run-e2e.sh
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."   # repo root

RPC=http://127.0.0.1:8545
NODE_LOG=$(mktemp)
NODE_PID=""

cleanup() {
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  pkill -f "hardhat node" 2>/dev/null
  rm -f "$NODE_LOG"
}
trap cleanup EXIT

echo "▶ Starting local Hardhat node..."
npx hardhat node > "$NODE_LOG" 2>&1 &
NODE_PID=$!

echo "▶ Waiting for RPC..."
for i in $(seq 1 30); do
  if curl -s -X POST -H 'Content-Type: application/json' \
       --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' "$RPC" 2>/dev/null \
       | grep -q 0x7a69; then
    echo "  RPC up."
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then echo "  ✗ Node never came up"; cat "$NODE_LOG"; exit 1; fi
done

echo "▶ Deploying local stack..."
npx hardhat run scripts/deploy-local.js --network localhost || { echo "deploy failed"; exit 1; }

echo "▶ Ensuring SDK is built..."
if [ ! -f sdk/dist/index.js ]; then
  [ -d sdk/node_modules ] || npm --prefix sdk install
  npm --prefix sdk run build
fi

echo "▶ Running e2e flow test..."
node e2e/e2e-flow.js
RC=$?

exit $RC
