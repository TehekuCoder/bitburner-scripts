import { PAYLOADS } from "../constants/game.js";

export const COMBAT_STATS = [
  "strength",
  "defense",
  "dexterity",
  "agility",
] as const;

export type CombatStat = (typeof COMBAT_STATS)[number];
export type ProvisionProfile = keyof typeof PAYLOADS;