import { NS, BitNodeMultipliers } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  try {
    ns.print("🔄 Lese BitNode-Konfiguration über Source-File 5 aus...");

    // Wenn SF5 nicht vorhanden ist, wirft diese Zeile einen Fehler
    const mults = ns.getBitNodeMultipliers();

    // ns.write ist synchron, kein await nötig
    ns.write("bn-multipliers.txt", JSON.stringify(mults, null, 2), "w");
    ns.print("✅ [SUCCESS] bn-multipliers.txt erfolgreich generiert.");
  } catch (error) {
    ns.print("⚠️ [ENV_WARN] Source-File 5 (Analyse) nicht aktiv.");
    ns.print(
      "📂 Generiere umfassende Standard-Multiplikatoren (Failsafe Mode)...",
    );

    // Ein vollständigeres Fallback-Objekt, um NaN-Fehler in Modulen zu verhindern
    const defaultMults: Record<keyof BitNodeMultipliers, number> = {
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

    ns.write("bn-multipliers.txt", JSON.stringify(defaultMults, null, 2), "w");
    ns.print("ℹ️ [INFRA] Standard-Konfiguration geschrieben.");
  }
}
