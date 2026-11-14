// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRoute, INTERNAL_PORT } = require("../../../scripts/gen-flowable-route");
const { createFlowableClient } = require("../flowable");

const KEY = "k".repeat(32);

test("route nội bộ Flowable: chỉ khớp cổng nội bộ, khóa nằm trong Lua, Basic auth gắn ở cổng gác", () => {
  const r = buildRoute(KEY, "QkFTSUM=");
  assert.deepEqual(r.vars, [["server_port", "==", INTERNAL_PORT]]);
  assert.equal(INTERNAL_PORT, "9081");
  assert.equal(r.uri, "/flowable-internal/*");
  assert.deepEqual(r.hosts, ["apisix"]); // cùng host với route S3, nếu không route S3 khớp trước (APISIX khớp host trước độ ưu tiên)
  assert.ok(r.priority > 0, "phải ưu tiên hơn route S3 cùng khớp host apisix");
  assert.equal(r.plugins["proxy-rewrite"].headers.set.Authorization, "Basic QkFTSUM=");
  assert.equal(r.plugins["proxy-rewrite"].regex_uri[1], "/flowable-rest/service/$1");
  const lua = r.plugins["serverless-pre-function"].functions[0];
  assert.ok(lua.includes(KEY) && !lua.includes("__KEY__"));
  assert.equal(r.plugins["serverless-pre-function"].phase, "rewrite");
  assert.deepEqual(r.upstream.nodes, { "flowable:8080": 1 });
});

test("danh sách cho phép trong Lua chỉ gồm đúng ba thao tác của quy trình OCOP", () => {
  const lua = buildRoute(KEY, "x").plugins["serverless-pre-function"].functions[0];
  assert.match(lua, /dxosOcopSupport/); // chỉ quy trình hồ sơ OCOP (cùng PROCESS_KEY với flowable.js)
  assert.match(lua, /processInstanceId/); // xem việc chỉ theo MỘT tiến trình
  assert.match(lua, /'complete'/); // chỉ hoàn thành việc
  assert.match(lua, /deny\(403, 'Thao tac khong nam trong danh sach cho phep'\)\s*end\s*$/); // mặc định TỪ CHỐI
  for (const forbidden of ["management", "identity", "repository", "DELETE", "PUT"]) assert.ok(!lua.includes(forbidden), `Lua không được nhắc tới ${forbidden}`);
  assert.equal(require("../flowable").PROCESS_KEY, "dxosOcopSupport");
});

test("sinh route từ chối khóa yếu hoặc thiếu", () => {
  assert.throws(() => buildRoute("ngan", "x"), /FLOWABLE_PROXY_KEY/);
  assert.throws(() => buildRoute(undefined, "x"), /FLOWABLE_PROXY_KEY/);
  assert.throws(() => buildRoute(KEY, ""), /FLOWABLE_BASIC/);
  assert.throws(() => buildRoute(KEY, "x", "return function() end"), /__KEY__/);
});

test("Flowable client chế độ khóa nội bộ: gửi X-Internal-Key, KHÔNG gửi Basic", async () => {
  let seen;
  const fl = createFlowableClient({
    baseUrl: "http://apisix:9081/flowable-internal",
    apiKey: KEY,
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "i-1" }) };
    },
  });
  assert.equal(await fl.start("OCOP-1"), "i-1");
  assert.equal(seen.url, "http://apisix:9081/flowable-internal/runtime/process-instances");
  assert.equal(seen.headers["x-internal-key"], KEY);
  assert.equal(seen.headers.authorization, undefined);
});
