// Mocked ESPN responses shaped after the fields read by community clients
// (cwendt94/espn-api, ffscrapr). Values are fictional.

export const settingsResponse = (overrides: { scoringType?: string; keeperCount?: number } = {}) => ({
  id: 12345,
  seasonId: 2026,
  scoringPeriodId: 9,
  status: { currentMatchupPeriod: 9, firstScoringPeriod: 1, finalScoringPeriod: 17 },
  settings: {
    name: "Mock League",
    size: 2,
    draftSettings: { keeperCount: overrides.keeperCount ?? 0 },
    rosterSettings: { lineupSlotCounts: { "0": 1, "2": 1, "4": 1, "23": 1, "20": 2, "21": 1, "24": 0, "99": 0 } },
    scoringSettings: {
      scoringType: overrides.scoringType ?? "H2H_POINTS",
      scoringItems: [
        { statId: 53, points: 1, pointsOverrides: {} },
        { statId: 42, points: 0.1 },
      ],
    },
    scheduleSettings: { matchupPeriodCount: 17, matchupPeriods: { "9": [9] } },
  },
});

const player = (id: number, name: string, slots: number[], proTeamId: number, week9: number | null) => ({
  id,
  fullName: name,
  defaultPositionId: 2,
  eligibleSlots: slots,
  proTeamId,
  injuryStatus: "ACTIVE",
  stats: [
    { id: "002026", seasonId: 2026, scoringPeriodId: 0, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 80, stats: { "53": 40 } },
    { id: "102026", seasonId: 2026, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 200, stats: { "53": 90 } },
    ...(week9 === null
      ? []
      : [{ id: "1120269", seasonId: 2026, scoringPeriodId: 9, statSourceId: 1, statSplitTypeId: 1, appliedTotal: week9, stats: { "53": 5 } }]),
    { id: "0120269", seasonId: 2026, scoringPeriodId: 9, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 3, stats: {} },
    { id: "102025", seasonId: 2025, scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 999 },
  ],
});

export const teamsResponse = () => ({
  id: 12345,
  teams: [
    {
      id: 1,
      name: "Team One",
      abbrev: "ONE",
      roster: {
        entries: [
          { playerId: 11, lineupSlotId: 0, playerPoolEntry: { id: 11, onTeamId: 1, player: player(11, "Quinn Arbor", [0, 7, 20, 21], 1, 18.4) } },
          { playerId: 12, lineupSlotId: 2, playerPoolEntry: { id: 12, onTeamId: 1, player: player(12, "Rory Bell", [2, 3, 23, 20, 21], 2, 12.1) } },
        ],
      },
    },
    {
      id: 2,
      location: "Team",
      nickname: "Two",
      abbrev: "TWO",
      roster: {
        entries: [
          { playerId: 21, lineupSlotId: 4, playerPoolEntry: { id: 21, onTeamId: 2, player: player(21, "Sky Cole", [4, 3, 5, 23, 20, 21], 3, null) } },
        ],
      },
    },
  ],
});

export const freeAgentsResponse = () => ({
  players: [
    { id: 31, onTeamId: 0, status: "FREEAGENT", player: player(31, "Tate Dune", [2, 23, 20], 4, 6.5) },
    { id: 11, onTeamId: 1, status: "ONTEAM", player: player(11, "Quinn Arbor", [0], 1, 18.4) },
  ],
});

export const proScheduleResponse = () => ({
  settings: {
    proTeams: [
      { id: 1, abbrev: "ATL", proGamesByScoringPeriod: { "9": [{ homeProTeamId: 1, awayProTeamId: 2, date: 1 }] } },
      { id: 2, abbrev: "BUF", proGamesByScoringPeriod: { "9": [{ homeProTeamId: 1, awayProTeamId: 2, date: 1 }] } },
      { id: 3, abbrev: "CHI", proGamesByScoringPeriod: {} },
    ],
  },
});
