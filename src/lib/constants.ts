import { FactionName, CompanyName, Player, GymType } from "@ns";

// --- INTERFACES ---
export interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

// --- REFRESH INTERVALLS ---
export const REFRESH_INTERVALS = {
  MEGACORP_APPLY: 600_000,    // 10 Min.
  FALLBACK_TARGET: 300_000,   // 5 Min.
  STRATEGY_COOLDOWN: 60_000,  // 1 Min. Schonfrist für Oszillation
  NETWORK_SCAN: 20_000,       // Nur alle 20 Sek. das Netzwerk scannen/infizieren
};

// --- CONFIGURATION CONSTANTS ---
export const BATCHER_MIN_RAM = 256;

export const COMBAT_STATS: (keyof Player["skills"])[] = [
  "strength",
  "defense",
  "dexterity",
  "agility",
];

// --- MEGACORPS DEFINITION ---
export const MEGACORPS: Record<string, CompanyName> = {
  ECorp: "ECorp",
  MegaCorp: "MegaCorp",
  "KuaiGong International": "KuaiGong International",
  "Four Sigma": "Four Sigma",
  NWO: "NWO",
  "Blade Industries": "Blade Industries",
  "OmniTek Incorporated": "OmniTek Incorporated",
  "Bachman & Associates": "Bachman & Associates",
  "Clarke Incorporated": "Clarke Incorporated",
  "Fulcrum Secret Technologies": "Fulcrum Technologies",
};

// --- ROADMAP LISTS ---
export const HACKING_FACTIONS: FactionConfig[] = [
  { name: "CyberSec", minStat: 0, priority: 1 },
  { name: "Tian Di Hui", minStat: 0, priority: 2 },
  { name: "Netburners", minStat: 0, priority: 3 },
  { name: "NiteSec", minStat: 0, priority: 4 },
  { name: "Slum Snakes", minStat: 30, priority: 5 },
  { name: "Sector-12", minStat: 0, priority: 6 },
  { name: "Chongqing", minStat: 0, priority: 7 },
  { name: "Ishima", minStat: 0, priority: 8 },
  { name: "New Tokyo", minStat: 0, priority: 9 },
  { name: "Tetrads", minStat: 75, priority: 10 },
  { name: "The Black Hand", minStat: 0, priority: 11 },
  { name: "Aevum", minStat: 0, priority: 12 },
  { name: "Volhaven", minStat: 0, priority: 13 },
  { name: "The Syndicate", minStat: 200, priority: 14 },
  { name: "BitRunners", minStat: 0, priority: 15 },
  { name: "ECorp", minStat: 0, priority: 16 },
  { name: "MegaCorp", minStat: 0, priority: 17 },
  { name: "KuaiGong International", minStat: 0, priority: 18 },
  { name: "Four Sigma", minStat: 0, priority: 19 },
  { name: "NWO", minStat: 0, priority: 20 },
  { name: "Blade Industries", minStat: 0, priority: 21 },
  { name: "OmniTek Incorporated", minStat: 0, priority: 22 },
  { name: "Bachman & Associates", minStat: 0, priority: 23 },
  { name: "Clarke Incorporated", minStat: 0, priority: 24 },
  { name: "Fulcrum Secret Technologies", minStat: 0, priority: 25 },
  { name: "Silhouette", minStat: 0, priority: 26 },
  { name: "The Dark Army", minStat: 300, priority: 27 },
  { name: "Speakers for the Dead", minStat: 300, priority: 28 },
  { name: "The Covenant", minStat: 850, priority: 29 },
  { name: "Illuminati", minStat: 1200, priority: 30 },
  { name: "Daedalus", minStat: 1500, priority: 31 },
];

export const CITY_FACTIONS: FactionName[] = [
  "Sector-12" as FactionName,
  "Aevum" as FactionName,
  "Chongqing" as FactionName,
  "New Tokyo" as FactionName,
  "Ishima" as FactionName,
  "Volhaven" as FactionName,
];

export const COMBAT_KEYS = ["strength", "defense", "dexterity", "agility"] as const;
export const GYM_STAT_MAP: Record<string, GymType> = {
  strength: "str" as GymType,
  defense: "def" as GymType,
  dexterity: "dex" as GymType,
  agility: "agi" as GymType,
};