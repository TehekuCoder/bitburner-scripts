import { GymType, BitNodeMultipliers } from "@ns";
import { PATHS } from "../paths";
import { CombatStat } from "../types/game";

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

export const PAYLOADS = {
  hgw: [
    PATHS.payloads.hack,
    PATHS.payloads.grow,
    PATHS.payloads.weaken,
    PATHS.payloads.share,
  ],
  darknet: [
    PATHS.daemons.crawler,
    PATHS.tasks.dnetSolver,
    PATHS.tasks.loot,
    PATHS.tasks.phish,
    PATHS.lib.constants,
    PATHS.lib.logger,
    PATHS.lib.paths,
    PATHS.lib.utils.provision,
  ],
} as const;

export const REFRESH_INTERVALS = {
  MEGACORP_APPLY: 600_000,
  FALLBACK_TARGET: 300_000,
  STRATEGY_COOLDOWN: 60_000,
  NETWORK_SCAN: 20_000,
};

export const AUG_PRICE_MULT = 1.9;

// Gestaffelter RAM-Puffer für Home
export const HOME_RESERVED_RAM_LOW = 8;      // <= 32 GB Home-RAM
export const HOME_RESERVED_RAM_MID = 32;     // <= 128 GB Home-RAM
export const HOME_RESERVED_RAM_HIGH = 80;    // <= 256 GB Home-RAM
export const HOME_RESERVED_RAM_ULTRA = 160;  // > 256 GB Home-RAM (Deckt alle Evaluatoren ab)