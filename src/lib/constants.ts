import {
  FactionName,
  CompanyName,
  Player,
  GymType,
  BitNodeMultipliers,
} from "@ns";

import { SolverFunction } from "/core/types";

// --- INTERFACES ---
export interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

// --- REFRESH INTERVALLS ---
export const REFRESH_INTERVALS = {
  MEGACORP_APPLY: 600_000, // 10 Min.
  FALLBACK_TARGET: 300_000, // 5 Min.
  STRATEGY_COOLDOWN: 60_000, // 1 Min. Schonfrist für Oszillation
  NETWORK_SCAN: 20_000, // Nur alle 20 Sek. das Netzwerk scannen/infizieren
};

// --- CONFIGURATION CONSTANTS ---
export const BATCHER_MIN_RAM = 1024;

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
  { name: "Slum Snakes", minStat: 30, priority: 4 },
  { name: "Sector-12", minStat: 0, priority: 5 },
  { name: "Aevum", minStat: 0, priority: 6 },
  { name: "NiteSec", minStat: 0, priority: 7 },
  { name: "Chongqing", minStat: 0, priority: 8 },
  { name: "Ishima", minStat: 0, priority: 9 },
  { name: "New Tokyo", minStat: 0, priority: 10 },
  { name: "Volhaven", minStat: 0, priority: 11 },
  { name: "Tetrads", minStat: 75, priority: 12 },
  { name: "The Black Hand", minStat: 0, priority: 13 },
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

export const COMBAT_KEYS = [
  "strength",
  "defense",
  "dexterity",
  "agility",
] as const;

export const GYM_STAT_MAP: Record<string, GymType> = {
  strength: "str" as GymType,
  defense: "def" as GymType,
  dexterity: "dex" as GymType,
  agility: "agi" as GymType,
};

export const TARGET_PROGRAMS = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "DarkscapeNavigator.exe",
  "SQLInject.exe",
  "Formulas.exe",
] as const;

export const DEFAULT_MULTIPLIERS: Record<keyof BitNodeMultipliers, number> = {
  HackingLevelMultiplier: 1.0,
  StrengthLevelMultiplier: 1.0,
  DefenseLevelMultiplier: 1.0,
  DexterityLevelMultiplier: 1.0,
  AgilityLevelMultiplier: 1.0,
  CharismaLevelMultiplier: 1.0,
  ServerMaxMoney: 1.0,
  ServerStartingMoney: 1.0,
  ServerGrowthRate: 1.0,
  ServerWeakenRate: 1.0,
  HackingSpeedMultiplier: 1.0,
  CrimeMoney: 1.0,
  CrimeSuccessRate: 1.0,
  CompanyWorkMoney: 1.0,
  CompanyWorkRepGain: 1.0,
  FactionWorkRepGain: 1.0,
  FourSigmaMarketDataCost: 1.0,
  FourSigmaMarketDataApiCost: 1.0,
  CorporationValuation: 1.0,
  CorporationSoftcap: 1.0,
  BladeburnerRank: 1.0,
  BladeburnerSkillCost: 1.0,
  GangSoftcap: 1.0,
  DaedalusAugsRequirement: 1.0,
  StaneksGiftPowerMultiplier: 1.0,
  AugmentationMoneyCost: 1.0,
  AugmentationRepCost: 1.0,
  ClassGymExpGain: 1.0,
  CodingContractMoney: 1.0,
  CompanyWorkExpGain: 1.0,
  CorporationDivisions: 1.0,
  CrimeExpGain: 1.0,
  FactionPassiveRepGain: 1.0,
  FactionWorkExpGain: 1.0,
  GangUniqueAugs: 1.0,
  GoPower: 1.0,
  HackExpGain: 1.0,
  HacknetNodeMoney: 1.0,
  HomeComputerRamCost: 1.0,
  InfiltrationMoney: 1.0,
  InfiltrationRep: 1.0,
  ManualHackMoney: 1.0,
  CloudServerCost: 1.0,
  CloudServerSoftcap: 1.0,
  CloudServerLimit: 1.0,
  CloudServerMaxRam: 1.0,
  FavorToDonateToFaction: 1.0,
  ScriptHackMoney: 1.0,
  ServerStartingSecurity: 1.0,
  StaneksGiftExtraSize: 1.0,
  WorldDaemonDifficulty: 1.0,
  ScriptHackMoneyGain: 1.0,
};

//systems/finance.ts
export const TRANSACTION_FEE = 100_000;
export const MIN_INVESTMENT = 5_000_000;
export const CASH_BUFFER = 2_000_000;

//tasks/dnet-crawler.ts
export const processedServers = new Set<string>();
export const COOLDOWN_FILE = "/dnet-cooldowns.txt";
export const COOLDOWN_MS = 5 * 60 * 1000;
export const LOOT_INTERVAL_MS = 3 * 60 * 1000;

export const PATH_GROW = "/tasks/grow.js";
export const PATH_HACK = "/tasks/hack.js";
export const PATH_WEAKEN = "/tasks/weaken.js";

// 📦 DEFINITION DER KERN-WORKER (utils/provision.ts)
export const PAYLOADS = [
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  "tasks/share.js",
  "tasks/work.js", // WICHTIG: Haupt-Worker hinzugefügt!
  "tasks/xp-grind.js", // WICHTIG: XP-Farmer hinzugefügt!
];

// "as const" macht daraus ein Readonly-Tuple aus exakten Literalen statt string[]
export const COMBAT_STATS = [
  "strength",
  "defense",
  "dexterity",
  "agility",
] as const;

// Erstellt den Union-Type: "strength" | "defense" | "dexterity" | "agility"
export type CombatStat = (typeof COMBAT_STATS)[number];

export const STAT_MAP: Record<CombatStat, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

export const DISPLAY_MAP: Record<CombatStat, string> = {
  strength: "Str",
  defense: "Def",
  dexterity: "Dex",
  agility: "Agi",
};

// Konfigurationen sys-jit-batchter.ts
export const SPACER = 125;
export const BATCH_GAP = 4 * SPACER;
export const HOME_RAM_RESERVE = 64;
export const SCRIPT_RAM_BASE = 1.75;
export const DYNAMIC_MAX_WEAKEN_TIME = 60 * 60 * 1000; // 60 Minuten
export const BLACKLIST_DURATION = 30000; // 30 Sekunden Sperre nach Kollaps

export const SWITCH_THRESHOLD = 1.25;
