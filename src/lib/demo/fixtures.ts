import type {
  FantasyTeam,
  LeagueSettings,
  LeagueSnapshot,
  Player,
  RosterSlot,
  ScoringItem,
  Sport,
  StatLine,
} from "@/lib/domain/types";

// Entirely fictional leagues, players and pro teams for demo mode. Values are
// generated from a fixed seed so the demo (and tests) are reproducible.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FIRST = ["Avery", "Blake", "Cass", "Dorian", "Ellis", "Flynn", "Greer", "Hollis", "Indy", "Jules", "Kit", "Lennox", "Marlo", "Noor", "Oakley", "Perrin", "Quill", "Remy", "Sasha", "Tobin", "Umber", "Vale", "Wren", "Xan", "Yael", "Zephyr"];
const LAST = ["Ashgrove", "Brightwater", "Coldbrook", "Dunmore", "Emberly", "Fairhaven", "Glimmer", "Hartwell", "Ironwood", "Juniper", "Kestrel", "Larkspur", "Moonfield", "Northcott", "Oakhurst", "Pinecrest", "Quarry", "Redfern", "Stonebridge", "Thistle", "Underhill", "Vantage", "Westbrook", "Yarrow"];

function nameFor(i: number): string {
  return `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 11) % LAST.length]}`;
}

const DEMO_TEAMS = ["Harbor Lights", "Gravel Road Gang", "Copper Kettles", "Night Owls"];

// ---------------------------------------------------------------- football

const FB_SLOTS: RosterSlot[] = [
  { slotId: 0, name: "QB", count: 1, kind: "starter" },
  { slotId: 2, name: "RB", count: 2, kind: "starter" },
  { slotId: 4, name: "WR", count: 2, kind: "starter" },
  { slotId: 6, name: "TE", count: 1, kind: "starter" },
  { slotId: 16, name: "D/ST", count: 1, kind: "starter" },
  { slotId: 17, name: "K", count: 1, kind: "starter" },
  { slotId: 20, name: "BE", count: 5, kind: "bench" },
  { slotId: 21, name: "IR", count: 1, kind: "ir" },
  { slotId: 23, name: "FLEX", count: 1, kind: "starter" },
];

export const FB_SCORING: ScoringItem[] = [
  { statId: 3, points: 0.04, pointsOverrides: {} }, // passing yards
  { statId: 4, points: 4, pointsOverrides: {} }, // passing TD
  { statId: 20, points: -2, pointsOverrides: {} }, // interception thrown
  { statId: 24, points: 0.1, pointsOverrides: {} }, // rushing yards
  { statId: 25, points: 6, pointsOverrides: {} }, // rushing TD
  { statId: 53, points: 1, pointsOverrides: {} }, // receptions
  { statId: 42, points: 0.1, pointsOverrides: {} }, // receiving yards
  { statId: 43, points: 6, pointsOverrides: {} }, // receiving TD
  { statId: 83, points: 3, pointsOverrides: {} }, // field goal made
  { statId: 86, points: 1, pointsOverrides: {} }, // extra point made
  { statId: 99, points: 1, pointsOverrides: {} }, // sack
  { statId: 95, points: 2, pointsOverrides: {} }, // defensive interception
  { statId: 96, points: 2, pointsOverrides: {} }, // fumble recovered
];

const FB_ELIGIBLE: Record<string, number[]> = {
  QB: [0, 7, 20, 21],
  RB: [2, 3, 23, 7, 20, 21],
  WR: [4, 3, 5, 23, 7, 20, 21],
  TE: [6, 5, 23, 7, 20, 21],
  "D/ST": [16, 20, 21],
  K: [17, 20, 21],
};
const FB_POS_SLOT: Record<string, number> = { QB: 0, RB: 2, WR: 4, TE: 6, "D/ST": 16, K: 17 };

/** Builds a stat line whose league score equals `pts` under FB_SCORING. */
function fbStats(pos: string, pts: number): StatLine {
  switch (pos) {
    case "QB":
      return { "3": pts * 15, "4": (pts * 0.3) / 4, "24": pts * 1 };
    case "RB":
      return { "24": pts * 5, "25": (pts * 0.2) / 6, "53": pts * 0.15, "42": pts * 1.5 };
    case "WR":
    case "TE":
      return { "53": pts * 0.3, "42": pts * 4.5, "43": (pts * 0.25) / 6 };
    case "K":
      return { "83": (pts * 0.8) / 3, "86": pts * 0.2 };
    default:
      return { "99": pts * 0.3, "95": (pts * 0.4) / 2, "96": (pts * 0.3) / 2 };
  }
}

const FB_PRO_TEAMS = ["HBR", "GLC", "SNT", "MTR", "RVN", "BLZ", "CMT", "TDL"];
const FB_WEEK = 9;
const FB_BYE_TEAM = 6; // "CMT" has no game in week 9

const FB_TEMPLATE: [string, number, number][] = [
  // position, base weekly projection, spread
  ["QB", 19, 5], ["QB", 13, 3], ["RB", 14, 4], ["RB", 11, 3], ["RB", 8, 2], ["RB", 6, 2],
  ["WR", 15, 4], ["WR", 12, 3], ["WR", 9, 2], ["WR", 6, 2], ["TE", 9, 3], ["TE", 5, 2], ["D/ST", 7, 2], ["K", 8, 1.5],
];

function buildFootball(): { players: Player[]; teams: FantasyTeam[]; freeAgents: number[] } {
  const r = rng(20261029);
  const players: Player[] = [];
  const teams: FantasyTeam[] = DEMO_TEAMS.map((name, i) => ({ id: i + 1, name, abbrev: name.split(" ").map((w) => w[0]).join(""), roster: [] }));
  let next = 1001;
  let dst = 0;
  const make = (pos: string, base: number, spread: number, opts: { missing?: boolean; injury?: string } = {}) => {
    const id = next++;
    const randomTeam = Math.floor(r() * FB_PRO_TEAMS.length);
    // Each defense belongs to a distinct pro team.
    const proTeamId = pos === "D/ST" ? dst++ : randomTeam;
    const pts = Math.round((base + (r() * 2 - 1) * spread) * 10) / 10;
    const onBye = proTeamId === FB_BYE_TEAM;
    const p: Player = {
      id,
      name: pos === "D/ST" ? `${FB_PRO_TEAMS[proTeamId]} D/ST` : nameFor(id),
      position: pos,
      positionSlotId: FB_POS_SLOT[pos],
      eligibleSlotIds: FB_ELIGIBLE[pos],
      proTeamId: proTeamId + 1,
      proTeamAbbrev: FB_PRO_TEAMS[proTeamId],
      injuryStatus: opts.injury ?? "ACTIVE",
      projections: {
        season: null,
        byScoringPeriod:
          onBye || opts.missing
            ? {}
            : { [String(FB_WEEK)]: { appliedTotal: null, appliedAverage: null, stats: fbStats(pos, pts), averageStats: null } },
      },
    };
    players.push(p);
    return p;
  };

  teams.forEach((team, ti) => {
    for (const [pos, base, spread] of FB_TEMPLATE) {
      if (ti === 2 && pos === "RB" && base === 6) continue; // Copper Kettles: one open roster spot
      const p = make(pos, base + (ti === 0 ? 1 : 0), spread, {
        missing: ti === 3 && pos === "WR" && base === 6, // Night Owls: rookie with no projection
      });
      team.roster.push({ playerId: p.id, lineupSlotId: 20 });
    }
  });
  // Night Owls also carry an injured RB in their IR slot.
  const ir = make("RB", 10, 2, { injury: "INJURY_RESERVE", missing: true });
  teams[3].roster.push({ playerId: ir.id, lineupSlotId: 21 });

  const freeAgents: number[] = [];
  for (const [pos, base] of [["RB", 7], ["RB", 5], ["WR", 7], ["WR", 5], ["TE", 5], ["QB", 11], ["K", 7], ["D/ST", 6]] as const) {
    freeAgents.push(make(pos, base, 1.5).id);
  }
  return { players, teams, freeAgents };
}

// -------------------------------------------------------------- basketball

const BB_SLOTS: RosterSlot[] = [
  { slotId: 0, name: "PG", count: 1, kind: "starter" },
  { slotId: 1, name: "SG", count: 1, kind: "starter" },
  { slotId: 2, name: "SF", count: 1, kind: "starter" },
  { slotId: 3, name: "PF", count: 1, kind: "starter" },
  { slotId: 4, name: "C", count: 1, kind: "starter" },
  { slotId: 5, name: "G", count: 1, kind: "starter" },
  { slotId: 6, name: "F", count: 1, kind: "starter" },
  { slotId: 11, name: "UT", count: 3, kind: "starter" },
  { slotId: 12, name: "BE", count: 3, kind: "bench" },
  { slotId: 13, name: "IR", count: 1, kind: "ir" },
];

export const BB_SCORING: ScoringItem[] = [
  { statId: 0, points: 1, pointsOverrides: {} }, // PTS
  { statId: 6, points: 1, pointsOverrides: {} }, // REB
  { statId: 3, points: 2, pointsOverrides: {} }, // AST
  { statId: 2, points: 4, pointsOverrides: {} }, // STL
  { statId: 1, points: 4, pointsOverrides: {} }, // BLK
  { statId: 11, points: -2, pointsOverrides: {} }, // TO
  { statId: 13, points: 2, pointsOverrides: {} }, // FGM
  { statId: 14, points: -1, pointsOverrides: {} }, // FGA
  { statId: 15, points: 1, pointsOverrides: {} }, // FTM
  { statId: 16, points: -1, pointsOverrides: {} }, // FTA
  { statId: 17, points: 1, pointsOverrides: {} }, // 3PM
];

const BB_POS_ELIGIBLE: Record<string, number[]> = {
  PG: [0, 5, 11], SG: [1, 5, 11], SF: [2, 6, 11], PF: [3, 6, 11], C: [4, 11],
};
const BB_POS_SLOT: Record<string, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

function bbAverages(fp: number): StatLine {
  // Scores to 0.9 × fp under BB_SCORING; scaled so the per-game value equals fp.
  const t = fp / 0.9;
  return {
    "0": 0.45 * t, "6": 0.2 * t, "3": 0.1 * t, "2": 0.02 * t, "1": 0.02 * t, "11": 0.04 * t,
    "13": 0.17 * t, "14": 0.37 * t, "15": 0.06 * t, "16": 0.08 * t, "17": 0.02 * t,
  };
}

const BB_PRO_TEAMS = ["SKY", "TID", "FRG", "LNX", "BRN", "CRS", "VLT", "MSA", "QKS", "ZEN"];
const BB_MATCHUP = 3;
const BB_DAYS = [15, 16, 17, 18, 19, 20, 21];
const BB_CURRENT_DAY = 17;
/** Fictional schedule: days on which each pro team plays during matchup period 3. */
const BB_SCHEDULE: number[][] = [
  [15, 17, 19, 21], [16, 18, 20], [15, 17, 18, 20], [16, 19, 21], [17, 19, 20],
  [15, 16, 18, 21], [17, 18, 20, 21], [16, 19], [15, 17, 19, 20], [18, 21],
];

const BB_TEMPLATE: [string[], number][] = [
  [["PG"], 42], [["PG", "SG"], 34], [["SG"], 30], [["SG", "SF"], 27], [["SF"], 33], [["SF", "PF"], 25],
  [["PF"], 31], [["PF", "C"], 28], [["C"], 36], [["C"], 22], [["PG"], 20], [["SF"], 18], [["PF"], 17],
];

function buildBasketball(): { players: Player[]; teams: FantasyTeam[]; freeAgents: number[] } {
  const r = rng(424242);
  const players: Player[] = [];
  const teams: FantasyTeam[] = DEMO_TEAMS.map((name, i) => ({ id: i + 1, name, abbrev: name.split(" ").map((w) => w[0]).join(""), roster: [] }));
  let next = 2001;
  const make = (positions: string[], base: number, opts: { missing?: boolean; injury?: string } = {}) => {
    const id = next++;
    const proTeamIdx = Math.floor(r() * BB_PRO_TEAMS.length);
    const fp = Math.round((base + (r() * 2 - 1) * 4) * 10) / 10;
    const eligible = [...new Set(positions.flatMap((p) => BB_POS_ELIGIBLE[p])), 12, 13].sort((a, b) => a - b);
    const p: Player = {
      id,
      name: nameFor(id),
      position: positions.join("/"),
      positionSlotId: BB_POS_SLOT[positions[0]],
      eligibleSlotIds: eligible,
      proTeamId: proTeamIdx + 1,
      proTeamAbbrev: BB_PRO_TEAMS[proTeamIdx],
      injuryStatus: opts.injury ?? "ACTIVE",
      projections: {
        byScoringPeriod: {},
        season: opts.missing ? null : { appliedTotal: null, appliedAverage: null, stats: null, averageStats: bbAverages(fp) },
      },
    };
    players.push(p);
    return p;
  };
  teams.forEach((team, ti) => {
    BB_TEMPLATE.forEach(([pos, base], i) => {
      if (ti === 1 && i === 12) return; // Gravel Road Gang: one open roster spot
      const p = make(pos, base + (ti === 2 ? 2 : 0), {
        missing: ti === 3 && i === 12, // Night Owls: two-way player with no projection
        injury: ti === 0 && i === 4 ? "OUT" : undefined, // Harbor Lights: one player listed OUT
      });
      team.roster.push({ playerId: p.id, lineupSlotId: 12 });
    });
  });
  const freeAgents: number[] = [];
  for (const [pos, base] of [[["PG"], 21], [["SG", "SF"], 19], [["PF"], 18], [["C"], 20], [["SF"], 16], [["PG", "SG"], 15]] as const) {
    freeAgents.push(make([...pos], base).id);
  }
  return { players, teams, freeAgents };
}

// ------------------------------------------------------------------ export

export function demoSnapshot(sport: Sport, fetchedAt: Date = new Date()): LeagueSnapshot {
  const built = sport === "football" ? buildFootball() : buildBasketball();
  const slots = sport === "football" ? FB_SLOTS : BB_SLOTS;
  const settings: LeagueSettings = {
    leagueId: sport === "football" ? "900001" : "900002",
    name: sport === "football" ? "Maple Hollow Demo League" : "Lantern Court Demo League",
    sport,
    season: 2026,
    scoringType: "H2H_POINTS",
    scoringLabel: "Head-to-head points",
    teamCount: DEMO_TEAMS.length,
    keeperCount: 0,
    slots,
    scoringItems: sport === "football" ? FB_SCORING : BB_SCORING,
    activeRosterLimit: slots.filter((s) => s.kind !== "ir").reduce((a, s) => a + s.count, 0),
    irSlotCount: slots.filter((s) => s.kind === "ir").reduce((a, s) => a + s.count, 0),
    currentMatchupPeriod: sport === "football" ? FB_WEEK : BB_MATCHUP,
    currentScoringPeriod: sport === "football" ? FB_WEEK : BB_CURRENT_DAY,
    finalScoringPeriod: sport === "football" ? 17 : 150,
    matchupPeriods:
      sport === "football"
        ? Object.fromEntries(Array.from({ length: 17 }, (_, i) => [String(i + 1), [i + 1]]))
        : { [String(BB_MATCHUP)]: BB_DAYS },
  };
  const gamesByTeam: Record<string, Record<string, number>> = {};
  if (sport === "football") {
    FB_PRO_TEAMS.forEach((_, i) => {
      gamesByTeam[String(i + 1)] = i === FB_BYE_TEAM ? {} : { [String(FB_WEEK)]: 1 };
    });
  } else {
    BB_SCHEDULE.forEach((days, i) => {
      gamesByTeam[String(i + 1)] = Object.fromEntries(days.map((d) => [String(d), 1]));
    });
  }
  return {
    source: "demo",
    sourceLabel: "Demo fixture (fictional data)",
    fetchedAt: fetchedAt.toISOString(),
    rosterScoringPeriod: settings.currentScoringPeriod,
    settings,
    format: { supported: true },
    teams: built.teams,
    players: Object.fromEntries(built.players.map((p) => [String(p.id), p])),
    freeAgents: { status: "available", value: built.freeAgents },
    proSchedule: { status: "available", value: { gamesByTeam } },
    warnings: [],
  };
}
