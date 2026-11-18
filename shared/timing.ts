export interface Timing {
  botMinMs: number;
  botMaxMs: number;
  /** Minimum bot delay while a HUMAN owes a JAKK call. */
  jakkBotMinMs: number;
  /** A disconnected player's turn is played by the bot logic after this long. */
  awayTurnMs: number;
  /** Room with no connected human for this long is deleted. */
  emptyRoomTtlMs: number;
  /** Room with no activity for this long is deleted. */
  idleRoomTtlMs: number;
  sweepIntervalMs: number;
  heartbeatIntervalMs: number;
}

export const DEFAULT_TIMING: Timing = {
  botMinMs: 900,
  botMaxMs: 1600,
  jakkBotMinMs: 3000,
  awayTurnMs: 15_000,
  emptyRoomTtlMs: 5 * 60_000,
  idleRoomTtlMs: 30 * 60_000,
  sweepIntervalMs: 30_000,
  heartbeatIntervalMs: 30_000,
};
