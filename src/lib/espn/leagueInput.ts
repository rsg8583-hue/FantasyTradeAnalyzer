import type { Sport } from "@/lib/domain/types";

export interface ParsedLeagueInput {
  leagueId: string;
  sportHint: Sport | null;
  seasonHint: number | null;
}

const ESPN_LINK_HOSTS = new Set(["fantasy.espn.com", "www.espn.com", "espn.com"]);

/**
 * Extracts a league id from a raw id or an ESPN league URL. The URL is only
 * parsed, never fetched.
 */
export function parseLeagueInput(input: string): ParsedLeagueInput | { error: string } {
  const value = input.trim();
  if (/^\d{1,12}$/.test(value)) return { leagueId: value, sportHint: null, seasonHint: null };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "Enter a numeric league id or an ESPN fantasy league URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "League URL must be an ESPN web address." };
  }
  if (!ESPN_LINK_HOSTS.has(url.hostname.toLowerCase())) {
    return { error: "League URL must be on fantasy.espn.com." };
  }
  const leagueId = url.searchParams.get("leagueId");
  if (!leagueId || !/^\d{1,12}$/.test(leagueId)) {
    return { error: "Could not find a numeric leagueId in that URL." };
  }
  const path = url.pathname.toLowerCase();
  const sportHint: Sport | null = path.includes("/football/")
    ? "football"
    : path.includes("/basketball/")
      ? "basketball"
      : null;
  const seasonParam = url.searchParams.get("seasonId");
  const seasonHint = seasonParam && /^\d{4}$/.test(seasonParam) ? Number(seasonParam) : null;
  return { leagueId, sportHint, seasonHint };
}
