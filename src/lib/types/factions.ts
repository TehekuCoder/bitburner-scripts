// lib/types/factions.ts

import { FactionName } from "@ns";
import { BotStrategy } from "./strategy";

export interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

export interface AugmentRoadmapItem {
  faction: FactionName | string;
  augmentation: string;
  repRequired: number;
  cost: number;
}

export interface AugmentTarget {
  name: string;
  repReq: number;
  basePrice: number;
  prereqs: string[];
  factions: FactionName[];
  bestFaction: FactionName;
}

export interface TargetFactionResult {
  name: FactionName;
  targetRep: number;
  augName: string;
  isNFG?: boolean;
  isCompany: boolean;
  companyName?: string;
}

export interface AugShoppingItem {
  faction: FactionName;
  name: string;
  price: number;
  repReq: number;
}

export interface AugmentState {
  augRoadMap?: AugmentTarget[];
  isBN2GangMode?: boolean;
}

export interface NFGFactionWhitelist {
  hackingGangDefault: FactionName;
  combatGangDefault: FactionName;
  fallbackWhitelist: FactionName[];
}

/**
 * Zustand des Faction-Subsystems
 */
export interface FactionState {
  targetFaction?: string | FactionName | null;
  factionCurrentReps?: Partial<Record<FactionName, number>>;
  strategy: BotStrategy;
  /** Gibt an, ob aktuell gezielt NFG gefarmt wird */
  isGrindingNFG?: boolean;
}

export const NFG_WHITELIST_CONFIG: NFGFactionWhitelist = {
  hackingGangDefault: "NiteSec" as FactionName,      // Oder CyberSec
  combatGangDefault: "Slum Snakes" as FactionName,
  fallbackWhitelist: [
    "CyberSec",
    "Slum Snakes",
    "Tian Di Hui",
    "NiteSec",
    "Netburners",
  ] as FactionName[],
};