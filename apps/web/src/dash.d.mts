import type { Snapshot } from "./stats.mjs";
import type { Cost, UsageDay } from "./usage.mjs";
export function passwordMatches(given: unknown, password: string): Promise<boolean>;
export function sessionCookie(password: string, now: number): Promise<string>;
export function signOutCookie(): string;
export function signedIn(cookieHeader: string | null, password: string, now: number): Promise<boolean>;
export function renderLogin(error?: string): string;
export function renderDash(
  snapshot: Snapshot & { usage: { at: number | null; error: string | null; days: UsageDay[]; cost: Cost } | null },
  now: number,
): string;
