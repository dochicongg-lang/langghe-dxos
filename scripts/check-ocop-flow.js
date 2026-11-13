// Kiểm tra THẬT quy trình hồ sơ OCOP qua cổng gác APISIX + Keycloak + trace-api + Flowable (không giả lập).
// Chạy: node scripts/check-ocop-flow.js   (sau bash scripts/upgrade.sh). Tạo hồ sơ thử mới mỗi lần (mã OCOP-...).
const fs = require("fs");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const GW = `http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};

async function token(user) {
  const r = await fetch(KC, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user}: ${JSON.stringify(j)}`);
  return j.access_token;
}
const api = async (tok, method, path, body) => {
  const r = await fetch(`${GW}/api/trace${path}`, {
    method,
    headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* không có thân JSON */
  }
  return { status: r.status, json };
};
const act = (tok, code, body) => api(tok, "POST", `/applications/${code}/actions`, body);
const flowableGet = (tok, path) => fetch(`${GW}/api/workflow/${path}`, { headers: { authorization: `Bearer ${tok}` } }).then((x) => x.json());

(async () => {
  const [hoa, tuan, ocop, viewer, tester] = await Promise.all(["hoa", "tuan", "ocop", "viewer", "tester"].map(token));
  const DOCS = ["phieu-dang-ky", "bao-cao-tu-danh-gia", "giay-phep-kinh-doanh", "anh-san-pham", "san-pham-mau"];
  const base = { product_name: "Bình gốm men rạn (thử)", product_group: "thu-cong-my-nghe", description: "Hồ sơ thử", product_code: "GOM-BT-0001", self_score: { A: 30, B: 20, C: 25 } };

  ok((await api(null, "GET", "/applications")).status === 401, "không token -> 401");
  // Trình duyệt chỉ gửi PUT/POST sau khi bước kiểm tra CORS (preflight) cho phép; thiếu PUT từng làm nút "Lưu danh mục giấy tờ" hỏng mà gọi API trực tiếp vẫn chạy
  const pre = await fetch(`${GW}/api/trace/applications/x`, { method: "OPTIONS", headers: { origin: env.FRONTEND_ORIGIN ?? "http://localhost:3000", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" } });
  ok((pre.headers.get("access-control-allow-methods") ?? "").split(",").includes("PUT"), "CORS preflight cho phép PUT (giao diện lưu hồ sơ)");
  ok((await api(viewer, "GET", "/applications")).status === 403, "viewer (readonly) không xem được hồ sơ OCOP -> 403");
  const prof = await api(hoa, "GET", "/applications/profile");
  ok(prof.status === 200 && prof.json.id === "hanoi-2026" && prof.json.verified === false, "profile Hà Nội, đánh dấu CHƯA đối chiếu văn bản gốc");

  // ---- Đường chính: nộp thiếu giấy -> bổ sung -> HTX yêu cầu sửa -> nộp lại -> đạt -> kết quả chính thức ----
  let r = await api(hoa, "POST", "/applications", { ...base, documents: ["phieu-dang-ky"] });
  ok(r.status === 201 && r.json.state === "draft" && r.json.owner === "hoa" && r.json.coop === "htx-demo", "hoa tạo hồ sơ nháp (HTX htx-demo)");
  const code = r.json.code;
  ok(r.json.expected?.total === 75 && r.json.expected?.stars === 4, "hạng sao DỰ KIẾN từ tự chấm 75 điểm = 4");
  ok(r.json.missing_documents?.length === 4, "danh mục báo còn thiếu 4 giấy tờ bắt buộc");
  r = await act(hoa, code, { action: "submit" });
  ok(r.status === 400 && /thiếu giấy tờ/.test(r.json.error), "nộp khi thiếu giấy tờ -> 400");
  r = await api(hoa, "PUT", `/applications/${code}`, { documents: DOCS });
  ok(r.status === 200 && r.json.missing_documents.length === 0, "hoa bổ sung đủ giấy tờ");
  r = await act(hoa, code, { action: "submit" });
  ok(r.status === 200 && r.json.state === "in_review" && r.json.open_task?.key === "reviewByCoop", "hoa nộp -> chờ HTX sơ duyệt; Flowable đang ở nhiệm vụ reviewByCoop");

  ok((await act(hoa, code, { action: "approve" })).status === 403, "producer không tự sơ duyệt -> 403");
  ok((await act(ocop, code, { action: "approve" })).status === 403, "ocop-officer không sơ duyệt thay HTX -> 403");
  ok((await act(tuan, code, { action: "result", score: 75, decision_no: "x", decided_at: "2026-08-16" })).status === 409, "ghi kết quả khi chưa sơ duyệt -> 409");
  ok((await api(hoa, "PUT", `/applications/${code}`, { product_name: "Sửa lén" })).status === 409, "không sửa hồ sơ khi đang chờ duyệt -> 409");

  ok((await act(tuan, code, { action: "revise" })).status === 400, "yêu cầu bổ sung mà không ghi lý do -> 400");
  r = await act(tuan, code, { action: "revise", note: "Chụp thêm ảnh bao bì" });
  ok(r.status === 200 && r.json.state === "needs_revision" && r.json.open_task?.key === "reviseByApplicant", "tuan yêu cầu bổ sung -> Flowable chuyển sang reviseByApplicant");
  r = await act(hoa, code, { action: "submit" });
  ok(r.status === 200 && r.json.state === "in_review" && r.json.open_task?.key === "reviewByCoop", "hoa nộp lại -> quay về HTX sơ duyệt");
  r = await act(tuan, code, { action: "approve", note: "Đạt" });
  ok(r.status === 200 && r.json.state === "awaiting_result" && r.json.open_task?.key === "officialResult", "tuan duyệt đạt -> chờ cơ quan có thẩm quyền (officialResult)");
  const good = { action: "result", score: 75, decision_no: "4325/QĐ-UBND (thử)", decided_at: "2026-08-16" };
  ok((await act(tuan, code, good)).status === 403, "HTX không ghi được kết quả chính thức -> 403");
  ok((await act(hoa, code, good)).status === 403, "producer không ghi được kết quả chính thức -> 403");
  ok((await act(ocop, code, { ...good, score: 120 })).status === 400, "điểm ngoài khoảng -> 400");
  ok((await act(ocop, code, { ...good, decided_at: "2999-01-01" })).status === 400, "ngày quyết định ở tương lai -> 400");
  r = await act(ocop, code, good);
  ok(r.status === 200 && r.json.state === "recognized" && r.json.result?.stars === 4 && r.json.result?.valid_until === "2029-08-16", "ocop ghi kết quả: 4 sao, hiệu lực đến 2029-08-16 (36 tháng)");
  ok(r.json.history?.length === 6 && r.json.history.at(-1).actor === "ocop", "lịch sử đủ 6 bước (tạo, nộp, yêu cầu bổ sung, nộp lại, duyệt, kết quả), bước cuối do ocop");
  ok((await act(tuan, code, { action: "approve" })).status === 409, "hồ sơ đã kết thúc không xử lý lại -> 409");

  // Flowable thật sự chạy hết quy trình (xác nhận từ phía Flowable, không chỉ từ cơ sở dữ liệu của ta)
  const fl = await flowableGet(tester, `history/historic-process-instances?businessKey=${code}`);
  ok(fl.data?.length === 1 && Boolean(fl.data[0].endTime), "Flowable: tiến trình của hồ sơ đã kết thúc (có endTime)");
  const tasks = await flowableGet(tester, `history/historic-task-instances?processInstanceId=${fl.data?.[0]?.id}&sort=startTime&order=asc`);
  ok(
    tasks.data?.map((t) => t.taskDefinitionKey).join(",") === "reviewByCoop,reviseByApplicant,reviewByCoop,officialResult",
    "Flowable: chuỗi nhiệm vụ = reviewByCoop, reviseByApplicant, reviewByCoop, officialResult",
  );

  // ---- Đường không đạt ----
  r = await api(hoa, "POST", "/applications", { ...base, documents: DOCS });
  const code2 = r.json.code;
  await act(hoa, code2, { action: "submit" });
  ok((await act(tuan, code2, { action: "reject" })).status === 400, "không đạt mà không ghi lý do -> 400");
  r = await act(tuan, code2, { action: "reject", note: "Thiếu hồ sơ pháp lý hợp lệ" });
  ok(r.status === 200 && r.json.state === "rejected", "tuan không đạt sơ duyệt -> rejected");

  // ---- Cách ly dữ liệu ----
  const hoaList = await api(hoa, "GET", "/applications");
  ok(hoaList.json.applications.length > 0 && hoaList.json.applications.every((a) => a.owner === "hoa"), "producer chỉ thấy hồ sơ của mình");
  const ocopList = await api(ocop, "GET", "/applications");
  ok(ocopList.json.applications.some((a) => a.code === code) && ocopList.json.applications.some((a) => a.code === code2), "ocop-officer thấy mọi hồ sơ");
  const own = await api(tester, "POST", "/applications", { ...base, documents: DOCS });
  ok(own.status === 201 && own.json.owner === "tester", "admin (tester) tạo hồ sơ của mình");
  ok((await api(hoa, "GET", `/applications/${own.json.code}`)).status === 404, "producer xem hồ sơ của người khác -> 404 (không lộ sự tồn tại)");
  ok([403, 404].includes((await api(viewer, "GET", `/applications/${code}`)).status), "viewer không xem được chi tiết hồ sơ");

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
