// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Phân tích thông minh đường cong nhiệt độ lò nung ([I] của H-P-D-I). Bộ luật thuần, không đụng mạng hay cơ sở dữ liệu.
 *
 * Đầu vào là bằng chứng IoT đã được MÁY CHỦ đối chiếu với dữ liệu cảm biến trong kho Object Lock (không phải số liệu client gửi),
 * nên kết luận dựa trên dữ liệu đã kiểm chứng. Hồ sơ nung (config/kiln-profiles.json) quy định ngưỡng; hiện là số liệu minh họa.
 * Kết quả chỉ hỗ trợ ra quyết định: KHÔNG thay thế kiểm định chất lượng sản phẩm.
 *
 * Verdict: alert (nguy hiểm hoặc nghi can thiệp dữ liệu) > warn (lệch chuẩn hoặc dữ liệu kém tin cậy) > insufficient (chưa đủ dữ liệu
 * để kết luận) > ok.
 */
const fs = require("node:fs");

const LEVEL_RANK = { alert: 3, warn: 2, info: 1, ok: 0 };
const INTEGRITY_FLAGS = ["object-overwritten", "object-deleted"];
const PUBLIC_MODES = ["all", "ok-only", "none"];
const QUALITY_FLAGS = ["low-coverage", "out-of-range", "rapid-change", "few-samples"];
// Câu chữ mặc định (nung gốm). Hồ sơ khác (ví dụ nhuộm lụa) đặt "terms" để dùng đúng từ của nghề đó.
const DEFAULT_TERMS = { profile: "hồ sơ nung", curve: "Đường cong nung", batch: "mẻ nung", batchCap: "Mẻ nung", equipment: "lò", criticalNote: "có thể hỏng sản phẩm hoặc lò", peakLowNote: "có thể chưa chín men", rampNote: "nguy cơ nứt do sốc nhiệt", coolNote: "nguy cơ nứt" };

function loadProfiles(file) {
  return validateProfiles(JSON.parse(fs.readFileSync(file, "utf8")));
}

function validateProfiles(cfg) {
  if (!cfg || typeof cfg.profiles !== "object" || !cfg.profiles[cfg.defaultProfile]) throw new Error("kiln-profiles.json: thiếu profiles hoặc defaultProfile không có thật");
  for (const [id, p] of Object.entries(cfg.profiles)) {
    const w = `kiln-profiles.json[${id}]`;
    const num = (v, what) => {
      if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) throw new Error(`${w}: ${what} phải là số dương`);
    };
    num(p.minSamples, "minSamples");
    num(p.peak?.min, "peak.min");
    num(p.peak?.max, "peak.max");
    if (p.peak.min >= p.peak.max) throw new Error(`${w}: peak.min phải nhỏ hơn peak.max`);
    num(p.criticalMax, "criticalMax");
    if (p.criticalMax <= p.peak.max) throw new Error(`${w}: criticalMax phải lớn hơn peak.max`);
    num(p.hold?.aboveC, "hold.aboveC");
    num(p.hold?.minMinutes, "hold.minMinutes");
    num(p.ramp?.fromC, "ramp.fromC");
    num(p.ramp?.maxPerHour, "ramp.maxPerHour");
    num(p.ramp?.windowMin, "ramp.windowMin");
    num(p.cooling?.fromC, "cooling.fromC");
    num(p.cooling?.toC, "cooling.toC");
    if (p.cooling.toC >= p.cooling.fromC) throw new Error(`${w}: cooling.toC phải nhỏ hơn cooling.fromC`);
    num(p.cooling?.maxPerHour, "cooling.maxPerHour");
    num(p.cooling?.windowMin, "cooling.windowMin");
    num(p.baseline?.minRuns, "baseline.minRuns");
    num(p.baseline?.maxDeviationPct, "baseline.maxDeviationPct");
    if (p.terms !== undefined) {
      const bad = typeof p.terms !== "object" || p.terms === null || Object.entries(p.terms).some(([k, v]) => !(k in DEFAULT_TERMS) || typeof v !== "string" || !v);
      if (bad) throw new Error(`${w}: terms chỉ nhận các khóa ${Object.keys(DEFAULT_TERMS).join(", ")} với giá trị là chuỗi không rỗng`);
    }
  }
  for (const k of cfg.byKeyword ?? []) {
    if (!Array.isArray(k.match) || k.match.length === 0 || !cfg.profiles[k.profile]) throw new Error("kiln-profiles.json: byKeyword cần match (danh sách) và profile có thật");
  }
  if (cfg.publicInsight !== undefined && !PUBLIC_MODES.includes(cfg.publicInsight)) throw new Error(`kiln-profiles.json: publicInsight phải là một trong ${PUBLIC_MODES.join(", ")}`);
  for (const [cat, id] of Object.entries(cfg.byCategory ?? {})) if (!cfg.profiles[id]) throw new Error(`kiln-profiles.json: danh mục "${cat}" trỏ tới hồ sơ không có: ${id}`);
  return cfg;
}

/** Kết luận này có được hiện ở trang công khai không (theo publicInsight; mặc định "all"). */
function publicAllows(cfg, verdict) {
  const mode = cfg.publicInsight ?? "all";
  return mode === "all" || (mode === "ok-only" && verdict === "ok");
}

/** Chọn hồ sơ nung theo danh mục sản phẩm; không khớp thì dùng mặc định. */
function pickProfile(cfg, category) {
  let id = cfg.byCategory?.[category];
  if (!id && category) {
    const c = String(category).normalize("NFC").toLowerCase();
    id = cfg.byKeyword?.find((k) => k.match.some((m) => c.includes(String(m).normalize("NFC").toLowerCase())))?.profile;
  }
  id = id ?? cfg.defaultProfile;
  return { id, ...cfg.profiles[id] };
}

/** Số phút đường cong nằm TRÊN ngưỡng (nội suy tuyến tính khi cắt ngưỡng giữa hai điểm). pts: [[ms, độ C]] đã sắp theo thời gian. */
function minutesAbove(pts, thr) {
  let ms = 0;
  for (let i = 1; i < pts.length; i++) {
    const [t0, v0] = pts[i - 1];
    const [t1, v1] = pts[i];
    const dt = t1 - t0;
    if (dt <= 0) continue;
    if (v0 >= thr && v1 >= thr) ms += dt;
    else if (v0 < thr && v1 < thr) continue;
    else {
      const frac = (thr - v0) / (v1 - v0); // vị trí cắt ngưỡng trong đoạn
      ms += v0 >= thr ? dt * frac : dt * (1 - frac);
    }
  }
  return Math.round((ms / 60000) * 10) / 10;
}

/**
 * Tốc độ đổi lớn nhất (°C/giờ) tính trên các cửa sổ dài ít nhất windowMin phút, chỉ xét cửa sổ nằm trong vùng quan tâm.
 * dir "up": gia nhiệt, cả hai đầu cửa sổ >= lo. dir "down": làm nguội, đầu cửa sổ <= hi và cuối >= lo.
 * Trả về null nếu không có cửa sổ nào đủ dài (chưa đủ dữ liệu để kết luận).
 */
function maxRatePerHour(pts, windowMin, dir, lo, hi = Infinity) {
  let best = null;
  const need = windowMin * 60000;
  for (let i = 0; i < pts.length; i++) {
    let j = i + 1;
    while (j < pts.length && pts[j][0] - pts[i][0] < need) j++;
    if (j >= pts.length) break;
    const [t0, v0] = pts[i];
    const [t1, v1] = pts[j];
    const hours = (t1 - t0) / 3600000;
    let rate = null;
    if (dir === "up" && v0 >= lo && v1 > v0) rate = (v1 - v0) / hours;
    if (dir === "down" && v0 <= hi && v1 >= lo && v1 < v0) rate = (v0 - v1) / hours;
    if (rate !== null && (best === null || rate > best)) best = rate;
  }
  return best === null ? null : Math.round(best);
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Phân tích một bằng chứng nung. iot: bằng chứng do buildEvidence tạo (curve, min, avg, max, count, from, to, quality).
 * opts.baselinePeaks: đỉnh nhiệt của CÁC MẺ KHÁC trên cùng lò (mọi mẻ đã có bằng chứng, không chỉ mẻ trước đó) để so sánh.
 * Trả về { verdict, summary, findings: [{code, level, text}], metrics, baseline, profile }.
 */
function analyze(iot, profile, { baselinePeaks = [] } = {}) {
  const findings = [];
  const T = { ...DEFAULT_TERMS, ...(profile.terms ?? {}) };
  const add = (level, code, text) => findings.push({ code, level, text });
  const pts = (Array.isArray(iot?.curve) ? iot.curve : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  const flags = iot?.quality?.flags ?? [];
  const peak = Number(iot?.max);
  const metrics = { peak: Number.isFinite(peak) ? peak : null, samples: iot?.count ?? 0 };

  // 1. Toàn vẹn và độ tin cậy của chính dữ liệu
  const integrity = flags.filter((f) => INTEGRITY_FLAGS.includes(f));
  if (integrity.length) add("alert", "integrity", "Dữ liệu nguồn có dấu hiệu bị ghi đè hoặc xóa sau khi ghi. Hệ thống đã dùng bản ghi gốc, nhưng cần kiểm tra lại nguồn gốc số liệu.");
  const quality = flags.filter((f) => QUALITY_FLAGS.includes(f));
  if (quality.length) add("warn", "data-quality", "Chất lượng số liệu cảm biến thấp (khoảng trống, mẫu ngoài khoảng, đổi nhanh bất thường hoặc quá ít mẫu), kết luận có độ tin cậy thấp.");

  // 2. Đỉnh nhiệt
  if (metrics.peak === null) {
    add("info", "no-data", "Không có số liệu nhiệt độ để phân tích.");
  } else if (peak >= profile.criticalMax) {
    add("alert", "over-critical", `Đỉnh nhiệt ${peak} °C vượt ngưỡng nguy hiểm ${profile.criticalMax} °C của ${T.profile} (${T.criticalNote}).`);
  } else if (peak > profile.peak.max) {
    add("warn", "peak-high", `Đỉnh nhiệt ${peak} °C cao hơn khoảng chuẩn ${profile.peak.min}–${profile.peak.max} °C.`);
  } else if (peak < profile.peak.min) {
    add("warn", "peak-low", `Đỉnh nhiệt ${peak} °C thấp hơn khoảng chuẩn ${profile.peak.min}–${profile.peak.max} °C (${T.peakLowNote}).`);
  } else {
    add("ok", "peak-ok", `Đỉnh nhiệt ${peak} °C nằm trong khoảng chuẩn ${profile.peak.min}–${profile.peak.max} °C.`);
  }

  // 3. Hình dạng đường cong: chỉ đánh giá khi đủ mẫu và đủ dài
  const enough = metrics.samples >= profile.minSamples && pts.length >= 5;
  if (!enough) {
    add("info", "insufficient", `Chưa đủ số liệu (${metrics.samples} mẫu, cần ít nhất ${profile.minSamples}) để đánh giá hình dạng đường cong.`);
  } else {
    metrics.durationMin = Math.round((pts[pts.length - 1][0] - pts[0][0]) / 60000);
    metrics.holdMin = minutesAbove(pts, profile.hold.aboveC);
    if (metrics.peak >= profile.hold.aboveC) {
      if (metrics.holdMin < profile.hold.minMinutes) add("warn", "hold-short", `Chỉ giữ trên ${profile.hold.aboveC} °C khoảng ${metrics.holdMin} phút, ngắn hơn mức tối thiểu ${profile.hold.minMinutes} phút.`);
      else add("ok", "hold-ok", `Giữ trên ${profile.hold.aboveC} °C khoảng ${metrics.holdMin} phút (đủ mức tối thiểu ${profile.hold.minMinutes} phút).`);
    }
    metrics.maxRampPerHour = maxRatePerHour(pts, profile.ramp.windowMin, "up", profile.ramp.fromC);
    if (metrics.maxRampPerHour === null) add("info", "ramp-unknown", `${T.batchCap} quá ngắn để đo tốc độ gia nhiệt.`);
    else if (metrics.maxRampPerHour > profile.ramp.maxPerHour) add("warn", "ramp-fast", `Gia nhiệt tối đa ${metrics.maxRampPerHour} °C/giờ, nhanh hơn mức ${profile.ramp.maxPerHour} °C/giờ (${T.rampNote}).`);
    else add("ok", "ramp-ok", `Tốc độ gia nhiệt tối đa ${metrics.maxRampPerHour} °C/giờ (trong mức ${profile.ramp.maxPerHour} °C/giờ).`);
    metrics.maxCoolPerHour = maxRatePerHour(pts, profile.cooling.windowMin, "down", profile.cooling.toC, profile.cooling.fromC);
    if (metrics.maxCoolPerHour !== null) {
      if (metrics.maxCoolPerHour > profile.cooling.maxPerHour) add("warn", "cool-fast", `Làm nguội tối đa ${metrics.maxCoolPerHour} °C/giờ trong vùng ${profile.cooling.fromC}→${profile.cooling.toC} °C, nhanh hơn mức ${profile.cooling.maxPerHour} °C/giờ (${T.coolNote}).`);
      else add("ok", "cool-ok", `Tốc độ làm nguội tối đa ${metrics.maxCoolPerHour} °C/giờ (trong mức ${profile.cooling.maxPerHour} °C/giờ).`);
    }
  }

  // 4. So với các mẻ trước của cùng lò
  let baseline = null;
  const peers = baselinePeaks.filter((v) => Number.isFinite(v));
  if (metrics.peak !== null && peers.length >= profile.baseline.minRuns) {
    const med = median(peers);
    const dev = Math.round((Math.abs(metrics.peak - med) / med) * 1000) / 10;
    baseline = { runs: peers.length, medianPeak: Math.round(med), deviationPct: dev };
    if (dev > profile.baseline.maxDeviationPct) add("warn", "baseline-deviation", `Đỉnh nhiệt lệch ${dev}% so với trung vị ${Math.round(med)} °C của ${peers.length} ${T.batch} khác trên cùng ${T.equipment} (ngưỡng ${profile.baseline.maxDeviationPct}%).`);
    else add("ok", "baseline-ok", `Đỉnh nhiệt lệch ${dev}% so với ${peers.length} ${T.batch} khác trên cùng ${T.equipment} (trong ngưỡng ${profile.baseline.maxDeviationPct}%).`);
  }

  const worst = findings.reduce((m, f) => Math.max(m, LEVEL_RANK[f.level]), 0);
  let verdict = worst >= 3 ? "alert" : worst === 2 ? "warn" : !enough || metrics.peak === null ? "insufficient" : "ok";
  const bad = findings.filter((f) => f.level === "alert" || f.level === "warn");
  const summary =
    verdict === "ok"
      ? `${T.curve} phù hợp hồ sơ "${profile.name}".`
      : verdict === "insufficient"
        ? "Chưa đủ số liệu để kết luận."
        : `${verdict === "alert" ? "Cần xử lý ngay" : "Cần xem lại"}: ${bad.length} điểm bất thường so với hồ sơ "${profile.name}".`;
  return { verdict, summary, findings, metrics, baseline, profile: { id: profile.id, name: profile.name, verified: profile.verified === true, terms: T } };
}


// ---------- Đường cong chuẩn: so sánh cả đường cong với các mẻ ĐẠT khác trên cùng thiết bị ----------
const REF_POINTS = 60;
const REF_MIN_PEERS = 3;

/** Lấy lại đường cong [thời điểm, giá trị] thành n điểm cách đều theo tỉ lệ thời gian từ đầu đến cuối mẻ (nội suy tuyến tính). */
function resampleCurve(curve, n = REF_POINTS) {
  const pts = (Array.isArray(curve) ? curve : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2 || pts[pts.length - 1][0] <= pts[0][0]) return null;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    while (j < pts.length - 2 && pts[j + 1][0] < t) j++;
    const [ta, va] = pts[j];
    const [tb, vb] = pts[j + 1];
    out.push(tb === ta ? va : va + ((vb - va) * (Math.min(Math.max(t, ta), tb) - ta)) / (tb - ta));
  }
  return out;
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Đường chuẩn từ các đường cong của những mẻ ĐẠT khác: trung vị và dải giữa (phân vị 25 đến 75) tại từng điểm.
 * Cần ít nhất `minPeers` mẻ; ít hơn thì trả enough=false (không vẽ đường chuẩn để khỏi gây hiểu lầm).
 */
function referenceCurve(curves, { minPeers = REF_MIN_PEERS, n = REF_POINTS } = {}) {
  const rs = curves.map((c) => resampleCurve(c, n)).filter(Boolean);
  if (rs.length < minPeers) return { n: rs.length, enough: false, points: [] };
  const points = [];
  for (let i = 0; i < n; i++) {
    const vals = rs.map((r) => r[i]).sort((a, b) => a - b);
    points.push([Math.round((i / (n - 1)) * 1000) / 1000, r1(quantile(vals, 0.5)), r1(quantile(vals, 0.25)), r1(quantile(vals, 0.75))]);
  }
  return { n: rs.length, enough: true, points };
}

/** Một câu bằng lời: mẻ này lệch khỏi dải thường gặp ở đoạn nào (đoạn liên tiếp dài nhất nằm ngoài dải, cùng một phía). */
function compareToReference(curve, ref, terms = {}) {
  if (!ref?.enough) return null;
  const T = { ...DEFAULT_TERMS, ...terms };
  const pts = (Array.isArray(curve) ? curve : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0])).sort((a, b) => a[0] - b[0]);
  const r = resampleCurve(curve, ref.points.length);
  if (!r || pts.length < 2) return null;
  const spanMin = (pts[pts.length - 1][0] - pts[0][0]) / 60000;
  const meds = ref.points.map((p) => p[1]);
  const tol = Math.max(2, 0.01 * (Math.max(...meds) - Math.min(...meds)));
  let best = null;
  let cur = null;
  r.forEach((v, i) => {
    const [, , lo, hi] = ref.points[i];
    const side = v < lo - tol ? -1 : v > hi + tol ? 1 : 0;
    if (side !== 0 && cur && cur.side === side) {
      cur.end = i;
      cur.sum += v - ref.points[i][1];
    } else if (side !== 0) {
      cur = { side, start: i, end: i, sum: v - ref.points[i][1] };
    } else cur = null;
    if (cur && (!best || cur.end - cur.start > best.end - best.start)) best = { ...cur };
  });
  if (!best || best.end - best.start + 1 < 3) return { level: "ok", text: `${T.curve} nằm trong dải thường gặp của các ${T.batch} đạt trước đó.` };
  const len = best.end - best.start + 1;
  const hour = (i) => Math.round(((i / (r.length - 1)) * spanMin) / 6) / 10;
  const diff = Math.round(Math.abs(best.sum / len));
  return { level: "warn", text: `Từ khoảng giờ thứ ${hour(best.start)} đến giờ thứ ${hour(best.end)}, ${T.batch} này ${best.side > 0 ? "cao hơn" : "thấp hơn"} dải thường gặp của các ${T.batch} đạt khoảng ${diff} °C.` };
}

module.exports = { loadProfiles, validateProfiles, pickProfile, publicAllows, minutesAbove, maxRatePerHour, analyze, resampleCurve, referenceCurve, compareToReference };
