import { FactionName } from "@ns";

export interface GangState {
  hasGang: boolean;
  gangFaction?: FactionName;
  isHackingGang?: boolean;
  gangMembersCount?: number;
  gangRespect?: number;
  gangWantedPenalty?: number;
  gangPhase?: string;
  gangProgress?: string;
  isBN2GangMode?: boolean;
}