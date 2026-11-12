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
