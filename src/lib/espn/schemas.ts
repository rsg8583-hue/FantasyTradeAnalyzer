import { z } from "zod";

// Schemas for the subset of ESPN's (unofficial) responses this app reads.
// Unknown keys are stripped; fields not verified against community clients are
// treated as optional so that their absence becomes "unavailable", never a
// silently-assumed default.

const numRecord = z.record(z.string(), z.number());

export const rawStatSplitSchema = z.object({
  id: z.string().optional(),
  seasonId: z.number().optional(),
  scoringPeriodId: z.number().optional(),
  statSourceId: z.number().optional(),
  statSplitTypeId: z.number().optional(),
  appliedTotal: z.number().optional(),
  appliedAverage: z.number().optional(),
  stats: numRecord.optional(),
  averageStats: numRecord.optional(),
});
export type RawStatSplit = z.infer<typeof rawStatSplitSchema>;

export const rawPlayerSchema = z.object({
  id: z.number(),
  fullName: z.string().optional(),
  defaultPositionId: z.number().optional(),
  eligibleSlots: z.array(z.number()).optional(),
  proTeamId: z.number().optional(),
  injuryStatus: z.string().optional(),
  stats: z.array(rawStatSplitSchema).optional(),
});
export type RawPlayer = z.infer<typeof rawPlayerSchema>;

const rawPlayerPoolEntrySchema = z.object({
  id: z.number().optional(),
  onTeamId: z.number().optional(),
  player: rawPlayerSchema,
});

export const rawRosterEntrySchema = z.object({
  playerId: z.number().optional(),
  lineupSlotId: z.number().optional(),
  injuryStatus: z.string().optional(),
  playerPoolEntry: rawPlayerPoolEntrySchema.optional(),
});

export const rawTeamSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  location: z.string().optional(),
  nickname: z.string().optional(),
  abbrev: z.string().optional(),
  roster: z
    .object({ entries: z.array(rawRosterEntrySchema).optional() })
    .optional(),
});

const rawScoringItemSchema = z.object({
  statId: z.number(),
  points: z.number().optional(),
  pointsOverrides: numRecord.optional(),
});

export const rawSettingsSchema = z.object({
  name: z.string().optional(),
  size: z.number().optional(),
  draftSettings: z.object({ keeperCount: z.number().optional() }).optional(),
  rosterSettings: z
    .object({ lineupSlotCounts: numRecord.optional() })
    .optional(),
  scoringSettings: z
    .object({
      scoringType: z.string().optional(),
      scoringItems: z.array(rawScoringItemSchema).optional(),
    })
    .optional(),
  scheduleSettings: z
    .object({
      matchupPeriodCount: z.number().optional(),
      matchupPeriods: z.record(z.string(), z.array(z.number())).optional(),
    })
    .optional(),
});

export const rawStatusSchema = z.object({
  currentMatchupPeriod: z.number().optional(),
  firstScoringPeriod: z.number().optional(),
  finalScoringPeriod: z.number().optional(),
  latestScoringPeriod: z.number().optional(),
});

/** League response for view=mSettings. `settings` is required to count as a league. */
export const rawLeagueSettingsResponseSchema = z.object({
  id: z.number(),
  seasonId: z.number().optional(),
  scoringPeriodId: z.number().optional(),
  settings: rawSettingsSchema,
  status: rawStatusSchema.optional(),
});
export type RawLeagueSettingsResponse = z.infer<typeof rawLeagueSettingsResponseSchema>;

/** League response for view=mTeam&view=mRoster. */
export const rawLeagueTeamsResponseSchema = z.object({
  id: z.number(),
  teams: z.array(rawTeamSchema),
});
export type RawLeagueTeamsResponse = z.infer<typeof rawLeagueTeamsResponseSchema>;

/** Response for view=kona_player_info with a free-agent filter. */
export const rawPlayerPoolResponseSchema = z.object({
  players: z.array(
    z.object({
      id: z.number().optional(),
      onTeamId: z.number().optional(),
      status: z.string().optional(),
      player: rawPlayerSchema,
    }),
  ),
});
export type RawPlayerPoolResponse = z.infer<typeof rawPlayerPoolResponseSchema>;

const rawProGameSchema = z.object({
  homeProTeamId: z.number().optional(),
  awayProTeamId: z.number().optional(),
  date: z.number().optional(),
});

/** Response for /seasons/{season}?view=proTeamSchedules_wl. */
export const rawProScheduleResponseSchema = z.object({
  settings: z.object({
    proTeams: z.array(
      z.object({
        id: z.number(),
        abbrev: z.string().optional(),
        proGamesByScoringPeriod: z
          .record(z.string(), z.array(rawProGameSchema))
          .optional(),
      }),
    ),
  }),
});
export type RawProScheduleResponse = z.infer<typeof rawProScheduleResponseSchema>;
