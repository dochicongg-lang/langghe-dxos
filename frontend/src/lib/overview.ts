// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
export interface OverviewWaiting {
  code: string;
  name: string;
  coop: string | null;
  state: string;
  level: "late" | "soon" | "waiting";
  days: number;
  unit: string;
  text: string;
}
export interface VerdictCounts {
  ok: number;
  warn: number;
  alert: number;
  insufficient: number;
}
export interface OverviewRenewal {
  code: string;
  name: string;
  coop: string | null;
  valid_until: string;
  daysLeft: number;
}
export interface OverviewCoop {
  coop: string | null;
  apps: number;
  recognized: number;
  late: number;
  runs: number;
  attention: number;
}
export interface Overview {
  scope: "all" | "coop";
  funnel: Record<string, number>;
  totalApps: number;
  waiting: OverviewWaiting[];
  waitingTotal: number;
  quality: { days: number; total: number; byVerdict: VerdictCounts; bySector: Record<string, VerdictCounts & { total: number }> };
  renewals: OverviewRenewal[];
  coops: OverviewCoop[] | null;
  limits: { reviewWorkingDays: number; reviewWarnWorkingDays: number; renewalWindowDays: number };
}
