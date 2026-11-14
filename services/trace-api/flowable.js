// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Lớp trung gian gọi Flowable REST (G2.2). Trình duyệt KHÔNG gọi Flowable trực tiếp cho nghiệp vụ OCOP:
 * mọi thao tác đi qua trace-api (đã kiểm quyền theo config/access.json), rồi trace-api mới điều khiển Flowable
 * từ trong mạng Docker. Hai cách xác thực:
 *   - apiKey (mặc định khi triển khai): gọi route NỘI BỘ của cổng gác (cổng 9081, không publish ra máy chủ) kèm khóa X-Internal-Key. Cổng gác
 *     gắn Basic auth của Flowable và chỉ cho đúng ba thao tác của quy trình OCOP (apisix/flowable-internal.lua), nên trace-api KHÔNG giữ mật
 *     khẩu admin của Flowable và nếu bị chiếm cũng không xóa được quy trình, tạo người dùng hay quản trị engine.
 *   - user/password (Basic): gọi thẳng Flowable, giữ lại cho thử nghiệm cục bộ.
 * Lý do làm ở cổng gác: Flowable REST không phân quyền mịn, chỉ cần quyền access-rest-api là làm được mọi thứ (đã kiểm chứng trên 7.0.1).
 */
const PROCESS_KEY = "dxosOcopSupport";

class FlowableError extends Error {}

function createFlowableClient({ baseUrl, apiKey, user, password, fetchImpl = fetch }) {
  const authHeaders = apiKey ? { "x-internal-key": apiKey } : { authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64") };

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { ...authHeaders, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new FlowableError(`Không gọi được Flowable: ${e.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new FlowableError(`Flowable trả ${res.status} cho ${method} ${path}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  const vars = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));

  return {
    /** Bắt đầu một tiến trình cho hồ sơ; trả về id tiến trình. */
    async start(businessKey, variables = {}) {
      const r = await call("POST", "/runtime/process-instances", { processDefinitionKey: PROCESS_KEY, businessKey, variables: vars(variables) });
      return r.id;
    },
    /** Hoàn thành nhiệm vụ đang mở (theo taskDefinitionKey) của một tiến trình. */
    async complete(instanceId, taskKey, variables = {}) {
      const r = await call("GET", `/runtime/tasks?processInstanceId=${encodeURIComponent(instanceId)}&taskDefinitionKey=${encodeURIComponent(taskKey)}`);
      const task = r.data?.[0];
      if (!task) throw new FlowableError(`Tiến trình ${instanceId} không có nhiệm vụ "${taskKey}" đang mở`);
      await call("POST", `/runtime/tasks/${task.id}`, { action: "complete", variables: vars(variables) });
    },
    /** Nhiệm vụ đang mở của tiến trình (để hiển thị hồ sơ đang ở bước nào của quy trình). */
    async openTask(instanceId) {
      const r = await call("GET", `/runtime/tasks?processInstanceId=${encodeURIComponent(instanceId)}`);
      const t = r.data?.[0];
      return t ? { key: t.taskDefinitionKey, name: t.name } : null;
    },
  };
}

module.exports = { createFlowableClient, FlowableError, PROCESS_KEY };
