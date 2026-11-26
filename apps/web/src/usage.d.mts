export const FREE_GB_PER_MONTH: number;
export const USD_PER_GB: number;
export const USAGE_QUERY: string;
export interface UsageDay {
  date: string;
  bytes: number;
  turnBytes: number;
}
export interface Cost {
  months: { month: string; gb: number; billableGb: number; cost: number; freeLeftGb: number }[];
  totalGb: number;
  totalCost: number;
}
export function costOf(days: { date: string; bytes: number }[], prices?: { freeGb?: number; perGb?: number }): Cost;
export function daysFrom(answer: unknown): UsageDay[];
export interface Forecast {
  month: string;
  dayOfMonth: number;
  daysInMonth: number;
  perDay: number;
  basedOnDays: number;
  sent: number[];
  soFarGb: number;
  projectedGb: number;
  projectedCost: number;
  monthAtPaceCost: number;
  freeRunsOutOn: string | null;
}
export function forecastOf(
  days: { date: string; bytes: number }[],
  today: string,
  options?: { freeGb?: number; perGb?: number; windowDays?: number },
): Forecast;
