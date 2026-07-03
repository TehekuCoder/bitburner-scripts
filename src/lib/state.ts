import { NS, BitNodeMultipliers } from "@ns";

// 1. Das globale Fallback-Objekt zentral an einem Ort geparkt
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

// 2. Die Lade-Funktion für Kernel, Dispatcher & Co.
export function loadBnMults(ns: NS): Record<keyof BitNodeMultipliers, number> {
  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        return { ...DEFAULT_MULTIPLIERS, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print("⚠️ [LIB] Fehler beim Parsen der bn-multipliers.txt. Nutze harten FailSafe.");
    }
  }
  return DEFAULT_MULTIPLIERS;
}