import { config } from "./config";
import { s3Get, s3ListKeys } from "./s3";
import type { IotEvidence } from "./trace";

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

/** Đọc các tệp NDJSON mới nhất do backend/simulate-iot.js ghi vào MinIO. */
export async function fetchReadings(maxObjects = 30): Promise<{ readings: Reading[]; objects: number }> {
  const keys = (await s3ListKeys(config.iotBucket, "iot/")).sort().slice(-maxObjects);
  const bodies = await Promise.all(keys.map((k) => s3Get(`/${config.iotBucket}/${k}`)));
  const readings: Reading[] = [];
  for (const body of bodies) {
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        readings.push(JSON.parse(line) as Reading);
      } catch {
        // bỏ qua dòng lỗi (tệp đang ghi dở)
      }
    }
  }
  return { readings, objects: keys.length };
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

/** Thời gian tải lên nằm trong tên tệp: iot/2026-11-12/2026-11-12T15-20-28-909Z.ndjson */
function keyTime(key: string): number {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.ndjson$/.exec(key);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

const DAY = 24 * 3600 * 1000;

/**
 * Đọc số liệu của một cảm biến trong khoảng [from, to] từ MinIO và tóm tắt làm bằng chứng cho công đoạn nung.
 * Trả về null nếu không có mẫu nào trong khoảng đó.
 */
export async function fetchEvidence(
  deviceId: string,
  metric: string,
  fromMs: number,
  toMs: number,
): Promise<IotEvidence | null> {
  // Mỗi tệp chứa các mẫu đo trước thời điểm tải lên vài chục giây, nên lấy thêm một đoạn đệm phía sau.
  const slack = 5 * 60 * 1000;
  const prefixes = new Set<string>();
  for (let t = Math.floor(fromMs / DAY) * DAY; t <= toMs + slack; t += DAY) {
    prefixes.add(`iot/${new Date(t).toISOString().slice(0, 10)}/`);
  }
  const lists = await Promise.all([...prefixes].map((p) => s3ListKeys(config.iotBucket, p)));
  const keys = lists
    .flat()
    .filter((k) => {
      const t = keyTime(k);
      return t >= fromMs && t <= toMs + slack;
    })
    .sort();
  const bodies = await Promise.all(keys.map((k) => s3Get(`/${config.iotBucket}/${k}`)));

  const pts: { t: number; v: number; name: string; unit: string }[] = [];
  for (const body of bodies) {
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Reading;
        const t = Date.parse(r.timestamp);
        if (r.deviceId === deviceId && r.metric === metric && t >= fromMs && t <= toMs) {
          pts.push({ t, v: r.value, name: r.deviceName, unit: r.unit });
        }
      } catch {
        // bỏ qua dòng lỗi
      }
    }
  }
  if (!pts.length) return null;
  pts.sort((a, b) => a.t - b.t);

  const values = pts.map((p) => p.v);
  const sum = values.reduce((a, b) => a + b, 0);
  // Rút gọn đường cong còn tối đa 60 điểm bằng cách lấy trung bình theo nhóm liên tiếp.
  const buckets = Math.min(60, pts.length);
  const curve: [number, number][] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = pts.slice(Math.floor((i * pts.length) / buckets), Math.floor(((i + 1) * pts.length) / buckets));
    const t = slice[Math.floor(slice.length / 2)].t;
    curve.push([t, Math.round((slice.reduce((a, p) => a + p.v, 0) / slice.length) * 10) / 10]);
  }
  return {
    deviceId,
    deviceName: pts[0].name,
    metric,
    unit: pts[0].unit,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    count: pts.length,
    min: Math.min(...values),
    avg: Math.round((sum / values.length) * 10) / 10,
    max: Math.max(...values),
    curve,
  };
}
