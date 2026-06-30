#!/usr/bin/env bash
#
# One-command demo for the mini-app: boots the whole stack and opens the shop.
#
#   platform (../constructor)  :8080   real HTTP executor
#   example-service (../example-service) :4000
#   mock wallet shell           :4100   holds the device key, signs consent
#   mini-app (Vite)             :5180   the shop UI
#
# Run from the example-miniapp repo root:  bash demo/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${PLATFORM_DIR:-$HERE/../constructor}"
SERVICE="${SERVICE_DIR:-$HERE/../example-service}"
JWT_SECRET="devsecret"
LOG_DIR="$HERE/demo/.logs"; mkdir -p "$LOG_DIR"

say() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
PIDS=()
cleanup() {
  say "stopping demo"
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  for port in 8080 9090 4000 4100 5180; do lsof -ti:$port | xargs kill -9 2>/dev/null || true; done
}
trap cleanup EXIT

# 0. Postgres
say "ensuring Postgres is up"
docker compose -f "$PLATFORM/deploy/docker-compose.yml" up -d >/dev/null
for i in $(seq 1 30); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' sc-postgres 2>/dev/null)" == "healthy" ]] && break; sleep 1
done

# 1. service keys
say "service keys"
[[ -f "$SERVICE/keys/service.public.pem" ]] || (cd "$SERVICE" && npm run keygen >/dev/null)

# 2. mock wallet shell (generates the device key; we read its public key)
say "starting mock wallet shell on :4100"
( cd "$HERE" && AUTH_JWT_SECRET="$JWT_SECRET" PLATFORM_BASE_URL=http://localhost:8080 \
    npm run shell > "$LOG_DIR/shell.log" 2>&1 ) &
PIDS+=($!)
for i in $(seq 1 20); do curl -sf http://localhost:4100/context -o /dev/null && break; sleep 1; done
DEV_PUB="$(curl -s http://localhost:4100/context | node -e 'process.stdin.once("data",d=>process.stdout.write(JSON.parse(d).devicePublicKeyPEM))')"

# 3. platform with the shell's device key
say "starting platform on :8080 (DEVICE_KEY_PEM from shell, EXECUTOR_MODE=http)"
( cd "$PLATFORM" && AUTH_MODE=jwt AUTH_JWT_SECRET="$JWT_SECRET" \
    DEVICE_KEY_PEM="$DEV_PUB" EXECUTOR_MODE=http \
    go run ./cmd/server > "$LOG_DIR/platform.log" 2>&1 ) &
PIDS+=($!)
sleep 5

# 4. register the service
say "registering the service"
TOKEN="$(AUTH_JWT_SECRET=$JWT_SECRET node -e '
  const c=require("crypto");const b=x=>Buffer.from(x).toString("base64url");
  const h=b(JSON.stringify({alg:"HS256",typ:"JWT"}));const p=b(JSON.stringify({sub:"u_42",roles:["admin"]}));
  const s=c.createHmac("sha256",process.env.AUTH_JWT_SECRET).update(h+"."+p).digest("base64url");
  process.stdout.write(`${h}.${p}.${s}`)')"
SVC_PUB="$(cat "$SERVICE/keys/service.public.pem")"
BODY="$(SVC_PUB="$SVC_PUB" node -e 'console.log(JSON.stringify({
  name:"Random Image Service",status:"SERVICE_STATUS_ACTIVE",
  executeUrl:"http://localhost:4000/execute",statusUrl:"http://localhost:4000/status",
  publicKeys:[{kid:"example-svc-key-1",pem:process.env.SVC_PUB}],
  receivingWallets:[{currencyId:"1",walletId:"wlt_recv_img"}],fee:{percent:"10"}}))')"
SVC_ID="$(curl -s -X POST http://localhost:8080/v1/admin/services \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$BODY" \
  | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).serviceId))')"
echo "serviceId = $SVC_ID"

# 5. example service
say "starting example-service on :4000"
( cd "$SERVICE" && SERVICE_ID="$SVC_ID" PORT=4000 PLATFORM_BASE_URL=http://localhost:8080 \
    npm run start > "$LOG_DIR/service.log" 2>&1 ) &
PIDS+=($!)
for i in $(seq 1 20); do curl -sf http://localhost:4000/healthz -o /dev/null && break; sleep 1; done

# 6. mini-app
say "starting mini-app on :5180"
( cd "$HERE" && npm run dev > "$LOG_DIR/miniapp.log" 2>&1 ) &
PIDS+=($!)
for i in $(seq 1 20); do curl -sf http://localhost:5180 -o /dev/null && break; sleep 1; done

say "open the shop:  http://localhost:5180"
command -v open >/dev/null && open http://localhost:5180 || true
echo "  logs: $LOG_DIR/"
echo "  Ctrl+C to stop everything."
wait
