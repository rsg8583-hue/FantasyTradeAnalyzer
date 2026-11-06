import type { TradeRequest } from "@/lib/domain/apiSchemas";
import type { LeagueSnapshot } from "@/lib/domain/types";
import { rosterCounts } from "@/lib/engine/trade";

export interface SideDraft {
  teamId: number | null;
  sends: number[];
  drops: number[];
  adds: number[];
}

export interface TradeDraft {
  a: SideDraft;
  b: SideDraft;
}

export const emptySide = (): SideDraft => ({ teamId: null, sends: [], drops: [], adds: [] });
export const emptyDraft = (): TradeDraft => ({ a: emptySide(), b: emptySide() });

const nameOf = (s: LeagueSnapshot, id: number) => s.players[String(id)]?.name ?? `Player ${id}`;

/** Roster math for one side of a draft, using the same function the server validates with. */
export function sideCounts(snapshot: LeagueSnapshot, own: SideDraft, other: SideDraft) {
  const team = snapshot.teams.find((t) => t.id === own.teamId);
  if (!team) return null;
  const c = rosterCounts(snapshot, team, own.sends, other.sends);
  const afterDrops = c.postTrade.length - own.drops.length;
  return { ...c, team, openSpots: Math.max(0, c.effectiveLimit - afterDrops) };
}

/**
 * Re-validates a draft against a (possibly refreshed) snapshot. Players who
 * left a team, drops that are no longer needed or possible, and replacements
 * who are no longer free agents are removed, with a note for each.
 */
export function reconcileDraft(draft: TradeDraft, snapshot: LeagueSnapshot): { draft: TradeDraft; notes: string[] } {
  const notes: string[] = [];
  const fa = snapshot.freeAgents.status === "available" ? new Set(snapshot.freeAgents.value) : new Set<number>();
  const fixSide = (side: SideDraft): SideDraft => {
    if (side.teamId === null) return side;
    const team = snapshot.teams.find((t) => t.id === side.teamId);
    if (!team) {
      notes.push("A selected team is no longer in the league data; its selections were cleared.");
      return emptySide();
    }
    const owned = new Set(team.roster.map((r) => r.playerId));
    const gone = side.sends.filter((id) => !owned.has(id));
    for (const id of gone) notes.push(`${nameOf(snapshot, id)} is no longer on ${team.name} and was removed from the trade.`);
    const lostFa = side.adds.filter((id) => !fa.has(id));
    for (const id of lostFa) notes.push(`${nameOf(snapshot, id)} is no longer an available free agent and was removed.`);
    return { ...side, sends: side.sends.filter((id) => owned.has(id)), adds: side.adds.filter((id) => fa.has(id)) };
  };
  const a = fixSide(draft.a);
  const b = fixSide(draft.b);
  // Drops depend on both sides; trim after ownership is fixed.
  const fixDrops = (own: SideDraft, other: SideDraft): SideDraft => {
    const c = sideCounts(snapshot, { ...own, drops: [] }, other);
    if (!c) return own;
    const allowed = new Set(c.postTrade);
    let drops = own.drops.filter((id) => allowed.has(id));
    if (drops.length > c.requiredDrops) drops = drops.slice(0, c.requiredDrops);
    if (drops.length !== own.drops.length) notes.push(`Drop selections for ${c.team.name} were updated to match the new roster.`);
    const open = Math.max(0, c.effectiveLimit - (c.postTrade.length - drops.length));
    const adds = own.adds.slice(0, open);
    if (adds.length !== own.adds.length) notes.push(`Replacement selections for ${c.team.name} were trimmed to the open roster spots.`);
    return { ...own, drops, adds };
  };
  return { draft: { a: fixDrops(a, b), b: fixDrops(b, a) }, notes };
}

export function toRequest(draft: TradeDraft, snapshot: LeagueSnapshot): TradeRequest | null {
  if (draft.a.teamId === null || draft.b.teamId === null) return null;
  return {
    snapshotFetchedAt: snapshot.fetchedAt,
    teamA: { teamId: draft.a.teamId, sends: draft.a.sends, drops: draft.a.drops, adds: draft.a.adds },
    teamB: { teamId: draft.b.teamId, sends: draft.b.sends, drops: draft.b.drops, adds: draft.b.adds },
  };
}
