import { FactionName, CompanyName, GymType, BitNodeMultipliers } from "@ns";
import { PATHS } from "./paths.js";
import { FactionConfig } from "./types/factions.js";
import { LogLevel } from "./types/logger.js";

// --- REFRESH INTERVALS ---
export const REFRESH_INTERVALS = {
  MEGACORP_APPLY: 600_000, // 10 Min.
  FALLBACK_TARGET: 300_000, // 5 Min.
  STRATEGY_COOLDOWN: 60_000, // 1 Min.
  NETWORK_SCAN: 20_000, // 20 Sek.
};

// --- CONFIGURATION CONSTANTS ---
export const BATCHER_MIN_RAM = 1024;

// --- MEGACORPS DEFINITION ---
export const MEGACORPS: Record<string, CompanyName> = {
  "Fulcrum Technologies": "Fulcrum Technologies" as CompanyName,
  ECorp: "ECorp" as CompanyName,
  MegaCorp: "MegaCorp" as CompanyName,
  "Four Sigma": "Four Sigma" as CompanyName,
  "KuaiGong International": "KuaiGong International" as CompanyName,
  NWO: "NWO" as CompanyName,
  "Blade Industries": "Blade Industries" as CompanyName,
  "OmniTek Incorporated": "OmniTek Incorporated" as CompanyName,
  "Bachman & Associates": "Bachman & Associates" as CompanyName,
  "Clarke Incorporated": "Clarke Incorporated" as CompanyName,
};

// --- COMBAT STATS & FACTION REQS ---
export const COMBAT_FACTION_REQUIREMENTS: Partial<Record<FactionName, number>> =
  {
    "Slum Snakes": 30,
    Tetrads: 75,
    "The Syndicate": 200,
    "The Dark Army": 300,
    "Speakers for the Dead": 300,
    "The Covenant": 850,
    Illuminati: 1200,
  };

// --- ROADMAP LISTS ---
export const FACTION_ROADMAP: FactionConfig[] = [
  // Early Hacking Factions
  { name: "CyberSec", minStat: 0, priority: 1 },
  { name: "Tian Di Hui", minStat: 0, priority: 2 },
  { name: "Netburners", minStat: 0, priority: 3 },
  { name: "NiteSec", minStat: 0, priority: 4 },
  { name: "The Black Hand", minStat: 0, priority: 5 },
  { name: "BitRunners", minStat: 0, priority: 6 },

  // Crime & Combat Factions (Requirements synchronisiert mit COMBAT_FACTION_REQUIREMENTS)
  {
    name: "Slum Snakes",
    minStat: COMBAT_FACTION_REQUIREMENTS["Slum Snakes"]!,
    priority: 7,
  },
  {
    name: "Tetrads",
    minStat: COMBAT_FACTION_REQUIREMENTS["Tetrads"]!,
    priority: 8,
  },
  {
    name: "The Syndicate",
    minStat: COMBAT_FACTION_REQUIREMENTS["The Syndicate"]!,
    priority: 9,
  },
  {
    name: "The Dark Army",
    minStat: COMBAT_FACTION_REQUIREMENTS["The Dark Army"]!,
    priority: 10,
  },
  {
    name: "Speakers for the Dead",
    minStat: COMBAT_FACTION_REQUIREMENTS["Speakers for the Dead"]!,
    priority: 11,
  },

  // City Factions (Hinweis: Schließen sich pro Reset gegenseitig aus)
  { name: "Sector-12", minStat: 0, priority: 12 },
  { name: "Aevum", minStat: 0, priority: 13 },
  { name: "Volhaven", minStat: 0, priority: 14 },
  { name: "Chongqing", minStat: 0, priority: 15 },
  { name: "Ishima", minStat: 0, priority: 16 },
  { name: "New Tokyo", minStat: 0, priority: 17 },

  // Megacorps
  { name: "Fulcrum Secret Technologies", minStat: 0, priority: 18 },
  { name: "ECorp", minStat: 0, priority: 19 },
  { name: "MegaCorp", minStat: 0, priority: 20 },
  { name: "Four Sigma", minStat: 0, priority: 21 },
  { name: "KuaiGong International", minStat: 0, priority: 22 },
  { name: "NWO", minStat: 0, priority: 23 },
  { name: "Blade Industries", minStat: 0, priority: 24 },
  { name: "OmniTek Incorporated", minStat: 0, priority: 25 },
  { name: "Bachman & Associates", minStat: 0, priority: 26 },
  { name: "Clarke Incorporated", minStat: 0, priority: 27 },
  { name: "Silhouette", minStat: 0, priority: 28 },

  // Endgame Factions
  { name: "Daedalus", minStat: 1500, priority: 29 }, // 2500 Hack oder 1500 Combat
  {
    name: "The Covenant",
    minStat: COMBAT_FACTION_REQUIREMENTS["The Covenant"]!,
    priority: 30,
  },
  {
    name: "Illuminati",
    minStat: COMBAT_FACTION_REQUIREMENTS["Illuminati"]!,
    priority: 31,
  },
];

export const CITY_FACTIONS: FactionName[] = [
  "Sector-12",
  "Aevum",
  "Chongqing",
  "New Tokyo",
  "Ishima",
  "Volhaven",
] as FactionName[];

export const COMBAT_STATS = [
  "strength",
  "defense",
  "dexterity",
  "agility",
] as const;

export type CombatStat = (typeof COMBAT_STATS)[number];

export const GYM_STAT_MAP: Record<CombatStat, GymType> = {
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

// Finance Constants
export const TRANSACTION_FEE = 100_000;
export const MIN_INVESTMENT = 5_000_000;
export const CASH_BUFFER = 2_000_000;

// DNet Crawler Constants
export const COOLDOWN_FILE = "/dnet-cooldowns.txt";
export const COOLDOWN_MS = 5 * 60 * 1000;
export const LOOT_INTERVAL_MS = 3 * 60 * 1000;

// Payload Paths (Verwendet zentrales PATHS-Objekt)
export const PATH_GROW = PATHS.payloads?.grow ?? "payloads/grow.js";
export const PATH_HACK = PATHS.payloads?.hack ?? "payloads/hack.js";
export const PATH_WEAKEN = PATHS.payloads?.weaken ?? "payloads/weaken.js";

// Provisioning Payload List
export const PAYLOADS: string[] = [
  PATHS.daemons.crawler,
  PATHS.tasks.dnetSolver,
  PATHS.tasks.loot,
  PATHS.tasks.phish,
  PATHS.payloads.work,

  PATHS.lib.constants,
  PATHS.lib.logger,
  PATHS.lib.paths,

  PATHS.lib.types.batcher,
  PATHS.lib.types.common,
  PATHS.lib.types.factions,
  PATHS.lib.types.finance,
  PATHS.lib.types.gang,
  PATHS.lib.types.logger,
  PATHS.lib.types.network,
  PATHS.lib.types.sleeves,
  PATHS.lib.types.strategy,

  PATHS.lib.utils.provision,

  PATHS.tools.allocateDarkRam,
  PATHS.tools.findDarknetPath,
  PATHS.tools.lootDarknetServer,
  PATHS.tools.manDnetCrawler,

  ...Object.values(PATHS.solvers),
];

// Batcher Constants
export const SPACER = 125;
export const BATCH_GAP = 4 * SPACER;
export const HOME_RAM_RESERVE = 64;
export const SCRIPT_RAM_BASE = 1.75;
export const DYNAMIC_MAX_WEAKEN_TIME = 60 * 60 * 1000;
export const BLACKLIST_DURATION = 30000;
export const SWITCH_THRESHOLD = 1.25;

export const MAX_WAIT_TIME_SECONDS = 6000;
export const AUG_PRICE_MULT = 1.9;

export const LOG_PORT = 1;
export const STATE_PORT = 2;

export const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  SUCCESS: 1,
  WARN: 2,
  ERROR: 3,
};

export type DispatchResult = "SUCCESS" | "NO_RAM" | "EXEC_FAIL";
