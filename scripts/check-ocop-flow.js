// Kiểm tra THẬT quy trình hồ sơ OCOP qua cổng gác APISIX + Keycloak + trace-api + Flowable (không giả lập).
// Chạy: node scripts/check-ocop-flow.js   (sau bash scripts/upgrade.sh). Tạo hồ sơ thử mới mỗi lần (mã OCOP-...).
const fs = require("fs");
const crypto = require("crypto");
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
// Tải tệp đính kèm: gửi nội dung thô (trace-api tự kiểm quyền, loại thật, cỡ, băm)
const upload = (tok, code, doc, name, buf, type) =>
  fetch(`${GW}/api/trace/applications/${code}/attachments?doc=${doc}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": type }, body: buf }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) }));
const download = async (tok, code, id) => {
  const x = await fetch(`${GW}/api/trace/applications/${code}/attachments/${id}/file`, { headers: { authorization: `Bearer ${tok}` } });
  return { status: x.status, headers: x.headers, body: Buffer.from(await x.arrayBuffer()) };
};
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
  // ---- Tệp đính kèm (G2.4) ----
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(3000)]); // ngẫu nhiên: mỗi lần chạy là tệp mới
  const sha = crypto.createHash("sha256").update(JPEG).digest("hex");
  r = await upload(hoa, code, "anh-san-pham", "Ảnh bình gốm.jpg", JPEG, "image/jpeg");
  ok(r.status === 201 && r.json.sha256 === sha && r.json.content_type === "image/jpeg" && r.json.size === JPEG.length, "hoa tải ảnh JPEG lên giấy tờ 'ảnh sản phẩm' (băm SHA-256 khớp)");
  const attId = r.json?.id;
  r = await api(hoa, "GET", `/applications/${code}`);
  ok(r.json.attachments?.length === 1 && r.json.missing_documents.length === 3 && r.json.attachment_rules?.enabled === true, "chi tiết hồ sơ liệt kê tệp; có tệp minh chứng thì giấy tờ được coi là đã có (còn thiếu 3)");
  ok((await upload(hoa, code, "anh-san-pham", "lai.jpg", JPEG, "image/jpeg")).status === 409, "tải lại đúng tệp đó -> 409 (trùng)");
  ok((await upload(hoa, code, "khong-co-trong-danh-muc", "a.jpg", JPEG, "image/jpeg")).status === 400, "giấy tờ không có trong danh mục -> 400");
  ok((await upload(hoa, code, "anh-san-pham", "virus.png", Buffer.from("MZ".padEnd(64, "x")), "image/png")).status === 415, "tệp thực thi đổi đuôi .png -> 415 (đọc chữ ký nội dung)");
  ok((await upload(hoa, code, "anh-san-pham", "x.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml")).status === 415, "SVG (có thể chứa mã chạy) -> 415");
  const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(500)]);
  ok((await upload(hoa, code, "anh-san-pham", "a.png", PDF, "image/png")).status === 415, "khai là PNG nhưng nội dung là PDF -> 415");
  ok((await upload(hoa, code, "anh-san-pham", "to.jpg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024)]), "image/jpeg")).status === 413, "tệp lớn hơn 5 MB -> 413");
  ok((await upload(ocop, code, "anh-san-pham", "x.jpg", crypto.randomBytes(10).fill(0xff, 0, 3), "image/jpeg")).status === 403, "cán bộ đầu mối OCOP không tải tệp lên hồ sơ của người nộp -> 403");
  r = await upload(hoa, code, "minh-chung-khac", "giay-khen.pdf", PDF, "application/pdf");
  ok(r.status === 201 && r.json.content_type === "application/pdf", "tải PDF lên mục 'minh chứng khác'");
  const pdfId = r.json?.id;

  let d = await download(hoa, code, attId);
  ok(d.status === 200 && d.body.equals(JPEG) && d.headers.get("x-sha256") === sha && d.headers.get("content-type") === "image/jpeg" && d.headers.get("x-content-type-options") === "nosniff", "hoa xem lại ảnh: đúng từng byte, kèm băm, nosniff");
  ok((await download(tuan, code, attId)).status === 200, "cán bộ HTX cùng HTX xem được tệp");
  ok((await download(ocop, code, attId)).status === 200, "cán bộ đầu mối OCOP xem được tệp");
  ok((await download(tester, code, attId)).status === 200, "quản trị xem được tệp");
  ok([403, 404].includes((await download(viewer, code, attId)).status), "viewer không xem được tệp");
  const other = await api(tester, "POST", "/applications", { ...base, documents: [] });
  const otherUp = await upload(tester, other.json.code, "anh-san-pham", "cua-tester.jpg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(500)]), "image/jpeg");
  ok(otherUp.status === 201 && (await download(hoa, other.json.code, otherUp.json.id)).status === 404, "hoa không xem được tệp của hồ sơ người khác (404)");
  ok((await download(hoa, code, attId + 100000)).status === 404, "mã tệp không có -> 404");
  r = await fetch(`${GW}/api/trace/applications/${code}/attachments/${pdfId}`, { method: "DELETE", headers: { authorization: `Bearer ${hoa}` } });
  ok(r.status === 200 && (await download(hoa, code, pdfId)).status === 404, "gỡ tệp: tệp biến mất khỏi hồ sơ");
  r = await api(hoa, "GET", `/applications/${code}`);
  ok(r.json.attachments.length === 1 && r.json.history.some((h) => h.action === "attach") && r.json.history.some((h) => h.action === "detach"), "lịch sử ghi lại việc đính kèm và gỡ tệp");

  // Kho tệp không truy cập trực tiếp được qua cổng S3 của cổng gác (chỉ qua API); đối chứng: bucket dữ liệu thường vẫn do MinIO trả lời
  // fetch của Node không cho đổi tiêu đề Host nên dùng http.request để vào đúng route s3.localhost
  const s3gw = (path) => new Promise((resolve, reject) => {
    const port = Number(env.APISIX_GATEWAY_PORT ?? 9080);
    const rq = require("http").request({ host: "localhost", port, path, method: "GET", headers: { host: `s3.localhost:${port}` } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t })); });
    rq.on("error", reject);
    rq.end();
  });
  const docsB = env.DOCS_BUCKET ?? "dxos-docs";
  const blocked = await s3gw(`/${docsB}/applications/${code}/anh-san-pham/x.jpg`);
  const control = await s3gw(`/${env.MINIO_BUCKET ?? "dxos-data"}/khong-co.txt`);
  ok(blocked.status === 403 && /Kho tep/.test(blocked.text) && !/Kho tep/.test(control.text), "cổng S3 chặn bucket tệp (đối chứng: bucket khác do MinIO trả lời, không phải bộ chặn)");

  r = await act(hoa, code, { action: "submit" });
  ok(r.status === 400 && /thiếu giấy tờ/.test(r.json.error), "nộp khi thiếu giấy tờ -> 400");
  r = await api(hoa, "PUT", `/applications/${code}`, { documents: DOCS });
  ok(r.status === 200 && r.json.missing_documents.length === 0, "hoa bổ sung đủ giấy tờ");
  r = await act(hoa, code, { action: "submit" });
  ok(r.status === 200 && r.json.state === "in_review" && r.json.open_task?.key === "reviewByCoop", "hoa nộp -> chờ HTX sơ duyệt; Flowable đang ở nhiệm vụ reviewByCoop");

  ok((await upload(hoa, code, "anh-san-pham", "sau-khi-nop.jpg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]), "image/jpeg")).status === 409, "đã nộp (chờ duyệt) thì không tải thêm tệp -> 409");
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
  ok(r.json.history?.filter((h) => !["attach", "detach"].includes(h.action)).length === 6 && r.json.history.at(-1).actor === "ocop", "lịch sử đủ 6 bước (tạo, nộp, yêu cầu bổ sung, nộp lại, duyệt, kết quả), bước cuối do ocop");
  ok((await act(tuan, code, { action: "approve" })).status === 409, "hồ sơ đã kết thúc không xử lý lại -> 409");

  // Trang công khai /verify: tách bạch "kết quả OCOP chính thức" và "xác nhận của nền tảng", không lộ thông tin nội bộ (G2.6)
  const pubRes = await fetch(`${GW}/api/public/trace/GOM-BT-0001`);
  const pubText = await pubRes.text();
  const pub = JSON.parse(pubText);
  ok(pub.ocop?.official?.stars === 4 && pub.ocop.official.valid_until === "2029-08-16" && pub.ocop.official.active === true && /UBND/.test(pub.ocop.official.authority), "công khai: kết quả OCOP chính thức (4 sao, hiệu lực đến 2029-08-16, còn hiệu lực)");
  ok(pub.ocop?.platform?.confirmed_at && /chưa phải giấy chứng nhận/.test(pub.ocop.platform.note), "công khai: xác nhận của nền tảng, ghi rõ chưa phải giấy chứng nhận OCOP");
  ok(!/"owner"|"actor"|created_by|OCOP-\d{8}|:"hoa"|:"tuan"|:"ocop"/.test(pubText), "công khai không lộ tên người dùng hay mã hồ sơ nội bộ");

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
