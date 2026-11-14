// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import { config } from "./config";
import { s3Get, s3ListKeys } from "./s3";

export interface Reading {
  deviceId: string;
  deviceName: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: string;
}

export interface Series {
  id: string; // deviceId/metric
  deviceName: string;
  metric: string;
  unit: string;
  points: { t: number; v: number }[]; // sắp xếp theo thời gian
}

// Các thư mục ngày đã qua không đổi nữa, nên giữ lại để không đọc lại mỗi lần làm mới (mỗi mẻ nung hoặc nhuộm nằm gọn trong một ngày).
const pastDays = new Map<string, Reading[]>();

/**
 * Đọc các tệp NDJSON do cảm biến ghi vào MinIO, theo từng thư mục ngày từ mới đến cũ, cho tới khi đã thấy đủ các thiết bị cần theo dõi
 * (lò nung, bể nhuộm) hoặc hết `maxDays` ngày. Nhờ vậy mỗi thiết bị đều có dữ liệu gần nhất, dù thiết bị khác ghi mới hơn.
 */
export async function fetchReadings(maxDays = 6, need: string[] = ["kiln-01", "dye-01"]): Promise<{ readings: Reading[]; objects: number }> {
  const keys = await s3ListKeys(config.iotBucket, "iot/");
  const day = (k: string) => k.split("/")[2] ?? "";
  const byDay = new Map<string, string[]>();
  for (const k of keys) byDay.set(day(k), [...(byDay.get(day(k)) ?? []), k]);
  const days = [...byDay.keys()].sort().reverse().slice(0, maxDays);
  const today = new Date().toISOString().slice(0, 10);
  const readings: Reading[] = [];
  const seen = new Set<string>();
  let objects = 0;
  for (const d of days) {
    let part = pastDays.get(d);
    const dayKeys = (byDay.get(d) ?? []).sort((x, y) => x.localeCompare(y));
    if (!part) {
      part = [];
      const bodies = await Promise.all(dayKeys.map((k) => s3Get(`/${config.iotBucket}/${k}`)));
      for (const body of bodies) {
        for (const line of body.split("\n")) {
          if (!line.trim()) continue;
          try {
            part.push(JSON.parse(line) as Reading);
          } catch {
            // bỏ qua dòng lỗi (tệp đang ghi dở)
          }
        }
      }
      if (d < today) pastDays.set(d, part);
    }
    objects += dayKeys.length;
    for (const r of part) {
      readings.push(r);
      seen.add(r.deviceId);
    }
    if (need.every((n) => seen.has(n))) break;
  }
  return { readings, objects };
}

export function toSeries(readings: Reading[]): Series[] {
  const map = new Map<string, Series>();
  for (const r of readings) {
    const id = `${r.deviceId}/${r.metric}`;
    let s = map.get(id);
    if (!s) {
      s = { id, deviceName: r.deviceName, metric: r.metric, unit: r.unit, points: [] };
      map.set(id, s);
    }
    s.points.push({ t: Date.parse(r.timestamp), v: r.value });
  }
  for (const s of map.values()) s.points.sort((a, b) => a.t - b.t);
  return Array.from(map.values());
}

/** Giữ lại đợt đo gần nhất của một chuỗi: tách đợt khi hai điểm liền nhau cách quá `gapMs` (mặc định 3 giờ). */
export function latestBatch(s: Series, gapMs = 3 * 3600_000): Series {
  let start = 0;
  for (let i = 1; i < s.points.length; i++) if (s.points[i].t - s.points[i - 1].t > gapMs) start = i;
  return start === 0 ? s : { ...s, points: s.points.slice(start) };
}
