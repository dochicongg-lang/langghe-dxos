-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Danh sách CHO PHÉP của route nội bộ Flowable (trace-api -> Flowable), chạy ở pha rewrite của APISIX.
-- Flowable REST không có phân quyền mịn (chỉ cần quyền access-rest-api là làm được mọi thứ: quản lý engine, tạo/xóa người dùng,
-- triển khai/xóa quy trình; đã kiểm chứng), nên việc giới hạn quyền của trace-api làm ở đây: chỉ ba thao tác quy trình hồ sơ OCOP cần.
-- Mật khẩu admin của Flowable chỉ nằm ở route này (cổng gác gắn Basic auth), KHÔNG nằm trong trace-api.
-- Tệp này là khuôn: scripts/gen-flowable-route.js thay __KEY__ bằng khóa nội bộ FLOWABLE_PROXY_KEY. Chỉ dùng chuỗi ASCII.
return function(conf, ctx)
  local function deny(code, msg) return code, { error = msg } end

  local key = ngx.req.get_headers()['x-internal-key']
  if type(key) ~= 'string' or key ~= '__KEY__' then
    return deny(401, 'Thieu hoac sai khoa noi bo')
  end

  local method = ngx.req.get_method()
  local p = (ngx.var.uri or ''):match('^/flowable%-internal(/.*)$') or ''
  local cjson = require('cjson.safe')

  local function json_body()
    ngx.req.read_body()
    local data = ngx.req.get_body_data()
    if data == nil or #data > 65536 then return nil end
    local ok = cjson.decode(data)
    if type(ok) ~= 'table' then return nil end
    return ok
  end

  -- xem nhiem vu: chi cua MOT tien trinh (khong liet ke tat ca)
  if p == '/runtime/tasks' and method == 'GET' then
    local id = ngx.req.get_uri_args()['processInstanceId']
    if type(id) ~= 'string' or id == '' then return deny(403, 'Chi duoc xem viec cua mot tien trinh') end
    return
  end

  -- hoan thanh nhiem vu: chi hanh dong complete (khong claim, delegate, resolve...)
  if p:find('^/runtime/tasks/[%w%-]+$') and method == 'POST' then
    local b = json_body()
    if b == nil or b.action ~= 'complete' then return deny(403, 'Chi duoc hoan thanh viec') end
    return
  end

  -- bat dau tien trinh: chi quy trinh ho so OCOP
  if p == '/runtime/process-instances' and method == 'POST' then
    local b = json_body()
    if b == nil or b.processDefinitionKey ~= 'dxosOcopSupport' then return deny(403, 'Chi duoc bat dau quy trinh ho so OCOP') end
    return
  end

  return deny(403, 'Thao tac khong nam trong danh sach cho phep')
end
