#!/usr/bin/env bash
# Nạp quy trình hỗ trợ hồ sơ OCOP (workflows/dxos-ocop-support.bpmn20.xml) vào Flowable qua cổng gác APISIX.
# Idempotent: tên bản triển khai gắn mã băm nội dung tệp; chỉ nạp khi nội dung đổi (sửa BPMN thì chạy lại để có phiên bản mới).
# Dùng: bash scripts/setup-ocop-workflow.sh   (sau khi hệ thống và scripts/setup-keycloak-roles.sh đã chạy)
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

GW="http://localhost:${APISIX_GATEWAY_PORT:-9080}"
KC="http://localhost:8080/realms/${KEYCLOAK_REALM:-dxos}/protocol/openid-connect/token"
FILE="workflows/dxos-ocop-support.bpmn20.xml"
HASH=$(sha256sum "$FILE" | cut -c1-8)
NAME="dxos-ocop-support-$HASH"

TOKEN=$(curl -s -X POST "$KC" -d grant_type=password -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" -d username=tester -d password=tester | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "Không lấy được token (tài khoản tester) để nạp quy trình"; exit 1; }

EXISTS=$(curl -s -H "Authorization: Bearer $TOKEN" "$GW/api/workflow/repository/deployments?name=$NAME")
case "$EXISTS" in
  *'"total":0'*|'') ;;
  *"$NAME"*) echo "OK quy trình OCOP đã có ($NAME)"; exit 0 ;;
esac

RESP=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" -F "deploymentName=$NAME" -F "category=dxos" -F "file=@$FILE;filename=dxos-ocop-support.bpmn20.xml" "$GW/api/workflow/repository/deployments")
CODE=$(printf '%s' "$RESP" | tail -n1)
[ "$CODE" = 201 ] || { echo "Nạp quy trình thất bại (HTTP $CODE): $(printf '%s' "$RESP" | head -n -1)"; exit 1; }
echo "OK đã nạp quy trình OCOP ($NAME)"
