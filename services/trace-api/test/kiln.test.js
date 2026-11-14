// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const kiln = require("../kiln");

const CFG = kiln.loadProfiles(path.join(__dirname, "..", "..", "..", "config", "kiln-profiles.json"));
const P = kiln.pickProfile(CFG, "Gốm sứ");
const T0 = Date.parse("2026-10-20T08:00:00Z");
const H = 3600000;

/** Dựng đường cong từ các đoạn { hours, to } xuất phát ở 25 °C, lấy mẫu mỗi 15 phút (như đường cong đã giảm mẫu của máy chủ). */
function curve(segments, stepMin = 15) {
  const pts = [[T0, 25]];
  let t = T0;
  let v = 25;
  for (const seg of segments) {
    const n = Math.max(1, Math.round((seg.hours * 60) / stepMin));
    const dv = (seg.to - v) / n;
    for (let i = 0; i < n; i++) {
      t += stepMin * 60000;
      v += dv;
      pts.push([t, Math.round(v * 10) / 10]);
    }
  }
  return pts;
}
function evidence(pts, extra = {}) {
  const vs = pts.map((p) => p[1]);
  return { deviceId: "kiln-01", curve: pts, min: Math.min(...vs), max: Math.max(...vs), avg: vs.reduce((a, b) => a + b, 0) / vs.length, count: pts.length * 15, from: new Date(pts[0][0]).toISOString(), to: new Date(pts.at(-1)[0]).toISOString(), quality: { flags: [] }, ...extra };
}
const GOOD = [{ hours: 8, to: 1150 }, { hours: 2, to: 1150 }, { hours: 5, to: 200 }];
const codes = (r) => r.findings.map((f) => f.code);

test("cấu hình hồ sơ nung của repo hợp lệ, đánh dấu là số liệu minh họa", () => {
  assert.equal(P.id, "gom-men-rach");
  assert.equal(P.verified, false);
  assert.equal(kiln.pickProfile(CFG, "Mây tre đan").id, CFG.defaultProfile); // danh mục lạ dùng hồ sơ mặc định
});

test("ngành lụa dùng hồ sơ nhuộm riêng, chọn theo từ khóa danh mục, câu chữ theo nghề nhuộm", () => {
  for (const cat of ["Dệt may", "Lụa và dệt", "Lụa tơ tằm", "Thổ cẩm"]) assert.equal(kiln.pickProfile(CFG, cat).id, "lua-nhuom", cat);
  assert.equal(kiln.pickProfile(CFG, "Gốm sứ").id, "gom-men-rach");
  const dye = kiln.pickProfile(CFG, "Lụa và dệt");
  assert.equal(dye.verified, false); // ngưỡng tham khảo, chưa được nghệ nhân xác nhận
  const curve = []; // nâng nhiệt 1 °C/phút lên 88 °C, giữ 40 phút, hạ từ từ: mẻ nhuộm chuẩn
  const t0 = 0;
  for (let m = 0; m <= 60; m++) curve.push([t0 + m * 60000, 28 + m]);
  for (let m = 61; m <= 100; m++) curve.push([t0 + m * 60000, 88]);
  for (let m = 101; m <= 190; m++) curve.push([t0 + m * 60000, 88 - (m - 100) * 0.5]);
  const mk = (peakOverride) => ({ curve: peakOverride ? curve.map(([t, v]) => [t, v > 80 ? peakOverride : v]) : curve, max: peakOverride ?? 88, min: 28, avg: 70, count: curve.length, from: "x", to: "y", quality: { flags: [] } });
  const ok = kiln.analyze(mk(), dye);
  assert.equal(ok.verdict, "ok");
  assert.match(ok.summary, /Đường cong nhuộm/);
  const boil = kiln.analyze(mk(101), dye);
  assert.equal(boil.verdict, "alert");
  assert.match(boil.findings.find((f) => f.code === "over-critical").text, /hồ sơ nhuộm.*nước sôi/);
  assert.equal(kiln.analyze(mk(), kiln.pickProfile(CFG, "Gốm sứ")).profile.terms.batch, "mẻ nung");
});

test("terms không hợp lệ bị từ chối khi nạp hồ sơ", () => {
  const bad = JSON.parse(JSON.stringify(CFG));
  bad.profiles["lua-nhuom"].terms = { khongco: "x" };
  assert.throws(() => kiln.validateProfiles(bad), /terms/);
});

test("chính sách hiện kết luận ở trang công khai: all / ok-only / none", () => {
  assert.equal(CFG.publicInsight, "all");
  const mode = (m) => ({ ...CFG, publicInsight: m });
  assert.deepEqual(["ok", "warn", "alert", "insufficient"].map((v) => kiln.publicAllows(mode("all"), v)), [true, true, true, true]);
  assert.deepEqual(["ok", "warn", "alert", "insufficient"].map((v) => kiln.publicAllows(mode("ok-only"), v)), [true, false, false, false]);
  assert.deepEqual(["ok", "warn", "alert", "insufficient"].map((v) => kiln.publicAllows(mode("none"), v)), [false, false, false, false]);
  assert.equal(kiln.publicAllows({ ...CFG, publicInsight: undefined }, "warn"), true); // mặc định
  assert.throws(() => kiln.validateProfiles(mode("tat-ca")), /publicInsight/);
});

test("cấu hình sai bị từ chối", () => {
  const mut = (fn) => {
    const c = JSON.parse(JSON.stringify(CFG));
    fn(c.profiles["gom-men-rach"]);
    return c;
  };
  assert.throws(() => kiln.validateProfiles(mut((p) => (p.criticalMax = 1200))), /criticalMax/);
  assert.throws(() => kiln.validateProfiles(mut((p) => (p.peak.min = 1300))), /peak\.min/);
  assert.throws(() => kiln.validateProfiles(mut((p) => (p.cooling.toC = 1100))), /cooling\.toC/);
  assert.throws(() => kiln.validateProfiles(mut((p) => (p.ramp.maxPerHour = -5))), /ramp\.maxPerHour/);
  assert.throws(() => kiln.validateProfiles({ defaultProfile: "x", profiles: {} }), /defaultProfile/);
  const bad = JSON.parse(JSON.stringify(CFG));
  bad.byCategory = { "Gốm sứ": "khong-co" };
  assert.throws(() => kiln.validateProfiles(bad), /không có/);
});

test("tính thời gian trên ngưỡng có nội suy khi cắt ngưỡng", () => {
  assert.equal(kiln.minutesAbove([[0, 1000], [H, 1200]], 1100), 30); // cắt ở giữa đoạn
  assert.equal(kiln.minutesAbove([[0, 1200], [H, 1200]], 1100), 60);
  assert.equal(kiln.minutesAbove([[0, 1000], [H, 1050]], 1100), 0);
  assert.equal(kiln.minutesAbove([[0, 1200], [H, 1000]], 1100), 30); // đoạn đi xuống
  assert.equal(kiln.minutesAbove([], 1100), 0);
});

test("tốc độ đổi lớn nhất theo cửa sổ, bỏ qua vùng ngoài quan tâm, null khi quá ngắn", () => {
  const up = [[0, 400], [H, 700], [2 * H, 1000]]; // 300 °C/giờ
  assert.equal(kiln.maxRatePerHour(up, 30, "up", 300), 300);
  assert.equal(kiln.maxRatePerHour([[0, 100], [H, 400]], 30, "up", 300), null); // đầu cửa sổ dưới vùng quan tâm
  assert.equal(kiln.maxRatePerHour([[0, 1000], [10 * 60000, 1100]], 30, "up", 300), null); // ngắn hơn cửa sổ
  const down = [[0, 900], [H, 600]];
  assert.equal(kiln.maxRatePerHour(down, 30, "down", 400, 1000), 300);
  assert.equal(kiln.maxRatePerHour(down, 30, "up", 300), null); // đi xuống không tính là gia nhiệt
});

test("mẻ nung chuẩn: đạt, kèm số đo đúng", () => {
  const r = kiln.analyze(evidence(curve(GOOD)), P);
  assert.equal(r.verdict, "ok", JSON.stringify(r.findings));
  assert.equal(r.metrics.peak, 1150);
  assert.ok(r.metrics.holdMin >= 150 && r.metrics.holdMin <= 165, `giữ ${r.metrics.holdMin}`);
  assert.ok(r.metrics.maxRampPerHour > 100 && r.metrics.maxRampPerHour <= 250);
  assert.ok(r.metrics.maxCoolPerHour > 100 && r.metrics.maxCoolPerHour <= 300);
  assert.deepEqual(codes(r).filter((c) => c.endsWith("-ok")).sort(), ["cool-ok", "hold-ok", "peak-ok", "ramp-ok"]);
  assert.match(r.summary, /phù hợp hồ sơ/);
  assert.equal(r.profile.verified, false);
});

test("quá nhiệt vượt ngưỡng nguy hiểm: alert", () => {
  const r = kiln.analyze(evidence(curve([{ hours: 8, to: 1320 }, { hours: 2, to: 1320 }, { hours: 5, to: 200 }])), P);
  assert.equal(r.verdict, "alert");
  assert.ok(codes(r).includes("over-critical"));
  assert.match(r.summary, /Cần xử lý ngay/);
});

test("đỉnh cao hơn chuẩn nhưng chưa nguy hiểm, và đỉnh thấp: warn", () => {
  const hi = kiln.analyze(evidence(curve([{ hours: 8, to: 1250 }, { hours: 2, to: 1250 }, { hours: 5, to: 200 }])), P);
  assert.equal(hi.verdict, "warn");
  assert.ok(codes(hi).includes("peak-high") && !codes(hi).includes("over-critical"));
  const lo = kiln.analyze(evidence(curve([{ hours: 8, to: 980 }, { hours: 2, to: 980 }, { hours: 5, to: 200 }])), P);
  assert.equal(lo.verdict, "warn");
  assert.ok(codes(lo).includes("peak-low"));
  assert.ok(!codes(lo).includes("hold-short") && !codes(lo).includes("hold-ok")); // không đạt ngưỡng giữ thì không xét thời gian giữ
});

test("gia nhiệt quá nhanh, giữ quá ngắn, làm nguội quá nhanh: warn đúng luật", () => {
  const fast = kiln.analyze(evidence(curve([{ hours: 3, to: 1150 }, { hours: 2, to: 1150 }, { hours: 5, to: 200 }])), P);
  assert.equal(fast.verdict, "warn");
  assert.deepEqual(codes(fast).filter((c) => !c.endsWith("-ok")), ["ramp-fast"]);
  const short = kiln.analyze(evidence(curve([{ hours: 8, to: 1150 }, { hours: 5, to: 200 }])), P);
  assert.deepEqual(codes(short).filter((c) => !c.endsWith("-ok")), ["hold-short"]);
  const cool = kiln.analyze(evidence(curve([{ hours: 8, to: 1150 }, { hours: 2, to: 1150 }, { hours: 2, to: 200 }])), P);
  assert.deepEqual(codes(cool).filter((c) => !c.endsWith("-ok")), ["cool-fast"]);
});

test("quá ít mẫu: chưa đủ dữ liệu, không kết luận bừa", () => {
  const pts = [[T0, 800], [T0 + 60000, 1000], [T0 + 120000, 1150]]; // đỉnh nằm trong chuẩn, chỉ thiếu mẫu
  const r = kiln.analyze({ ...evidence(pts), count: 3 }, P);
  assert.equal(r.verdict, "insufficient");
  assert.ok(codes(r).includes("insufficient"));
  assert.equal(r.metrics.holdMin, undefined);
  // thiếu đường cong hoặc không có số liệu: không ném lỗi
  assert.equal(kiln.analyze({}, P).verdict, "insufficient");
  assert.equal(kiln.analyze(null, P).verdict, "insufficient");
});

test("dấu hiệu bị ghi đè/xóa dữ liệu: alert; chất lượng kém: warn (kể cả khi đường cong đẹp)", () => {
  const good = evidence(curve(GOOD));
  const tampered = kiln.analyze({ ...good, quality: { flags: ["object-overwritten"] } }, P);
  assert.equal(tampered.verdict, "alert");
  assert.ok(codes(tampered).includes("integrity"));
  assert.equal(kiln.analyze({ ...good, quality: { flags: ["object-deleted"] } }, P).verdict, "alert");
  const poor = kiln.analyze({ ...good, quality: { flags: ["low-coverage"] } }, P);
  assert.equal(poor.verdict, "warn");
  assert.ok(codes(poor).includes("data-quality"));
});

test("so với các mẻ trước của cùng lò: chỉ so khi đủ số mẻ; lệch quá ngưỡng thì warn", () => {
  const run = evidence(curve([{ hours: 8, to: 1190 }, { hours: 2, to: 1190 }, { hours: 5, to: 200 }])); // đỉnh 1190, vẫn trong 1100-1220
  const few = kiln.analyze(run, P, { baselinePeaks: [1100, 1105] });
  assert.equal(few.baseline, null);
  assert.equal(few.verdict, "ok");
  const dev = kiln.analyze(run, P, { baselinePeaks: [1100, 1105, 1100] });
  assert.equal(dev.baseline.runs, 3);
  assert.equal(dev.baseline.medianPeak, 1100);
  assert.equal(dev.baseline.deviationPct, 8.2);
  assert.equal(dev.verdict, "warn");
  assert.ok(codes(dev).includes("baseline-deviation"));
  const same = kiln.analyze(run, P, { baselinePeaks: [1185, 1190, 1195, NaN, null] });
  assert.equal(same.baseline.runs, 3); // giá trị không hợp lệ bị bỏ
  assert.equal(same.verdict, "ok");
});

test("ưu tiên mức nghiêm trọng: alert thắng warn, warn thắng insufficient", () => {
  const r = kiln.analyze({ ...evidence(curve([{ hours: 3, to: 1320 }, { hours: 2, to: 1320 }, { hours: 5, to: 200 }])), quality: { flags: ["low-coverage"] } }, P);
  assert.equal(r.verdict, "alert"); // quá nhiệt + gia nhiệt nhanh + dữ liệu kém
  assert.ok(["over-critical", "ramp-fast", "data-quality"].every((c) => codes(r).includes(c)));
});
