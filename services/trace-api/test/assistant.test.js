// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ocop = require("../ocop");
const kiln = require("../kiln");
const access = require("../access");
const assistant = require("../assistant");

const CFG = path.join(__dirname, "..", "..", "..", "config");
const profile = ocop.getProfile(ocop.loadProfiles(path.join(CFG, "ocop-profiles.json")));
const kilnCfg = kiln.loadProfiles(path.join(CFG, "kiln-profiles.json"));
const accessCfg = access.load(path.join(CFG, "access.json"));
const faq = assistant.loadFaq(path.join(CFG, "assistant-faq.json"));
const chunks = assistant.buildKnowledge({ profile, kilnCfg, accessCfg, faq });
const index = assistant.buildIndex(chunks);
const ask = (q) => assistant.ask(index, q);

test("bỏ dấu tiếng Việt khi so khớp, từ chức năng bị loại", () => {
  assert.equal(assistant.fold("Đồ uống ĐẠT chuẩn"), "do uong dat chuan");
  assert.deepEqual(assistant.tokens("Hồ sơ OCOP cần giấy tờ gì?"), ["ho", "so", "ocop", "can", "giay", "to"]);
});

test("kho tri thức: có đủ loại đoạn, id không trùng, mọi đoạn có nguồn", () => {
  const ids = chunks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(chunks.every((c) => c.title && c.text && c.ref));
  for (const g of profile.groups) assert.ok(ids.includes(`giay-to-${g.key}`), `thiếu đoạn giấy tờ nhóm ${g.key}`);
  assert.ok(ids.includes("diem-sao") && ids.includes("hieu-luc") && ids.includes("han-xu-ly") && ids.some((i) => i.startsWith("nung-")) && ids.some((i) => i.startsWith("vai-tro-")));
  assert.ok(!ids.includes("vai-tro-editor")); // bí danh tạm không có đoạn riêng
});

test("giấy tờ cần có theo nhóm: đúng nhóm, đúng danh mục theo cấu hình", () => {
  const r = ask("Hồ sơ OCOP nhóm hàng thủ công mỹ nghệ cần giấy tờ gì?");
  assert.equal(r.matched, true);
  assert.match(r.sources[0].title, /Hàng thủ công mỹ nghệ/);
  assert.match(r.answer, /Phiếu đăng ký tham gia/);
  assert.equal(r.sources[0].ref, "quy định OCOP");
  assert.doesNotMatch(JSON.stringify(r.sources), /config\//); // không lộ tên tệp cấu hình cho người dùng
});

test("số liệu trả lời lấy từ cấu hình: hạng sao, hiệu lực, hạn sơ duyệt, ngưỡng nung", () => {
  assert.match(ask("bao nhieu diem thi duoc 4 sao").answer, /4 sao từ 70 đến 89/); // gõ không dấu vẫn đúng
  assert.match(ask("Kết quả OCOP có hiệu lực bao lâu?").answer, /36 tháng/);
  assert.match(ask("Hạn sơ duyệt hồ sơ của hợp tác xã là bao nhiêu ngày làm việc?").answer, /15 ngày làm việc/);
  const kn = ask("ngưỡng nhiệt độ đỉnh khi nung gốm men rạn");
  assert.match(kn.answer, /1100/);
  assert.match(kn.answer, /1300/);
  assert.ok(kn.answer.includes(String(Object.values(kilnCfg.profiles)[0].criticalMax)));
});

test("vai trò và hướng dẫn: câu hỏi về cán bộ HTX, thông báo, mã OTP, khác biệt xác nhận", () => {
  assert.match(ask("Cán bộ HTX làm được những việc gì").sources.map((s) => s.title).join(" "), /Cán bộ HTX/);
  assert.match(ask("Chuông thông báo nhắc những gì").answer, /chuông/i);
  assert.match(ask("Mã OTP là gì, cài ở đâu").answer, /ứng dụng xác thực/);
  assert.match(ask("Xác nhận của nền tảng khác gì kết quả OCOP chính thức").answer, /chưa phải giấy chứng nhận/);
});

test("không tìm thấy thì chỉ đường tới người có thẩm quyền (referral), câu hỏi trống thì không", () => {
  const lost = ask("xyzzy quux foobar");
  assert.equal(lost.matched, false);
  assert.equal(lost.referral, true);
  assert.deepEqual(lost.sources, []);
  assert.notEqual(ask("").referral, true);
});

test("không tìm thấy thì nói rõ là chưa có, không đoán và không trích nguồn", () => {
  for (const q of ["Thời tiết ngày mai ở Hà Nội thế nào?", "giá vàng hôm nay", "cách nấu phở bò", "???", "", "   "]) {
    const r = ask(q);
    assert.equal(r.matched, false, q);
    assert.deepEqual(r.sources, [], q);
    assert.ok(r.answer.length > 10);
  }
});

test("đầu vào bất thường: rất dài, ký tự lạ, mã độc dạng chuỗi đều an toàn", () => {
  assert.doesNotThrow(() => ask("giấy tờ ".repeat(5000)));
  assert.doesNotThrow(() => ask("<script>alert(1)</script> '; DROP TABLE users; --"));
  assert.equal(ask(null).matched, false);
  assert.equal(ask(undefined).matched, false);
  assert.equal(ask({ toString: () => "hiệu lực" }).matched, true); // ép sang chuỗi, không lỗi
});

test("luôn có nguồn khi tìm thấy; đoạn liên quan chỉ khi đủ gần điểm cao nhất", () => {
  const r = ask("Hồ sơ OCOP gồm những giấy tờ nào");
  assert.equal(r.matched, true);
  assert.ok(r.sources.length >= 1 && r.sources.length <= 3);
  assert.equal(r.sources.length, 1 + (r.related?.length ?? 0));
});

test("loadFaq từ chối tệp thiếu trường hoặc trùng id", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const f = path.join(os.tmpdir(), `faq-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify({ entries: [{ id: "a", title: "t" }] }));
  assert.throws(() => assistant.loadFaq(f), /id, title, text/);
  fs.writeFileSync(f, JSON.stringify({ entries: [{ id: "a", title: "t", text: "x" }, { id: "a", title: "u", text: "y" }] }));
  assert.throws(() => assistant.loadFaq(f), /trùng/);
  fs.rmSync(f, { force: true });
});
