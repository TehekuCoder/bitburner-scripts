import { NS, BitNodeMultipliers } from "@ns";

interface MultiplierMeta {
  key: keyof BitNodeMultipliers;
  label: string;
  category: string;
  lowerIsBetter?: boolean;
  baseline?: number;
}

const MULTIPLIER_DEFINITIONS: MultiplierMeta[] = [
  // 💻 HACKING & SERVEREINSTELLUNGEN
  { key: "ScriptHackMoney", label: "Script Hack-Ertrag (Server)", category: "Hacking & Server" },
  { key: "ScriptHackMoneyGain", label: "Script Hack-Gewinn (Spieler)", category: "Hacking & Server" },
  { key: "ManualHackMoney", label: "Manuelles Hacken Geld", category: "Hacking & Server" },
  { key: "ServerMaxMoney", label: "Maximales Server-Geld", category: "Hacking & Server" },
  { key: "ServerStartingMoney", label: "Start-Geld der Server", category: "Hacking & Server" },
  { key: "ServerGrowthRate", label: "Server-Wachstumsrate (Grow)", category: "Hacking & Server" },
  { key: "ServerWeakenRate", label: "Server-Schwächungsrate (Weaken)", category: "Hacking & Server" },
  { key: "ServerStartingSecurity", label: "Start-Sicherheit der Server", category: "Hacking & Server", lowerIsBetter: true },
  { key: "HackingLevelMultiplier", label: "Hacking-Level Skalierung", category: "Hacking & Server" },
  { key: "HackingSpeedMultiplier", label: "Hacking-Geschwindigkeit (H/G/W)", category: "Hacking & Server" },
  { key: "HackExpGain", label: "Hacking-XP Gewinn", category: "Hacking & Server" },
  { key: "WorldDaemonDifficulty", label: "WorldDaemon Anforderung", category: "Hacking & Server", lowerIsBetter: true },

  // 📜 FRAKTIONEN & AUGMENTATIONS
  { key: "AugmentationMoneyCost", label: "Augmentation Geld-Kosten", category: "Fraktionen & Augs", lowerIsBetter: true },
  { key: "AugmentationRepCost", label: "Augmentation Rep-Kosten", category: "Fraktionen & Augs", lowerIsBetter: true },
  { key: "FactionWorkRepGain", label: "Fraktionsarbeit Rep-Gewinn", category: "Fraktionen & Augs" },
  { key: "FactionPassiveRepGain", label: "Passiver Fraktions-Rep Gewinn", category: "Fraktionen & Augs" },
  { key: "FactionWorkExpGain", label: "Fraktionsarbeit XP-Gewinn", category: "Fraktionen & Augs" },
  { key: "FavorToDonateToFaction", label: "Favor-Schwelle für Spenden", category: "Fraktionen & Augs", lowerIsBetter: true },
  { key: "DaedalusAugsRequirement", label: "Daedalus Aug-Anforderung", category: "Fraktionen & Augs", lowerIsBetter: true },

  // 🧬 STATS, GYM & KAMPF
  { key: "StrengthLevelMultiplier", label: "Stärke-Level Skalierung", category: "Stats & Training" },
  { key: "DefenseLevelMultiplier", label: "Verteidigung-Level Skalierung", category: "Stats & Training" },
  { key: "DexterityLevelMultiplier", label: "Geschicklichkeit-Level Skalierung", category: "Stats & Training" },
  { key: "AgilityLevelMultiplier", label: "Beweglichkeit-Level Skalierung", category: "Stats & Training" },
  { key: "CharismaLevelMultiplier", label: "Charisma-Level Skalierung", category: "Stats & Training" },
  { key: "ClassGymExpGain", label: "Gym & Uni XP-Gewinn", category: "Stats & Training" },

  // 🏢 WIRTSCHAFT, JOBS & VERBRECHEN
  { key: "CompanyWorkMoney", label: "Firmenjob Gehalt", category: "Wirtschaft & Jobs" },
  { key: "CompanyWorkRepGain", label: "Firmenjob Rep-Gewinn", category: "Wirtschaft & Jobs" },
  { key: "CompanyWorkExpGain", label: "Firmenjob XP-Gewinn", category: "Wirtschaft & Jobs" },
  { key: "CrimeMoney", label: "Verbrechen Geld-Gewinn", category: "Wirtschaft & Jobs" },
  { key: "CrimeSuccessRate", label: "Verbrechen Erfolgschance", category: "Wirtschaft & Jobs" },
  { key: "CrimeExpGain", label: "Verbrechen XP-Gewinn", category: "Wirtschaft & Jobs" },
  { key: "InfiltrationMoney", label: "Infiltration Geld", category: "Wirtschaft & Jobs" },
  { key: "InfiltrationRep", label: "Infiltration Rep", category: "Wirtschaft & Jobs" },
  { key: "CodingContractMoney", label: "Coding Contract Belohnung", category: "Wirtschaft & Jobs" },

  // 🖥️ HARDWARE, CLOUD & HACKNET
  { key: "HomeComputerRamCost", label: "Home RAM Upgrade-Kosten", category: "Hardware & Cloud", lowerIsBetter: true },
  { key: "CloudServerCost", label: "Cloud Server Kauf-Kosten", category: "Hardware & Cloud", lowerIsBetter: true },
  { key: "CloudServerSoftcap", label: "Cloud Server Softcap", category: "Hardware & Cloud" },
  { key: "CloudServerLimit", label: "Max. Cloud Server Anzahl", category: "Hardware & Cloud" },
  { key: "CloudServerMaxRam", label: "Max. Cloud Server RAM", category: "Hardware & Cloud" },
  { key: "HacknetNodeMoney", label: "Hacknet Ertrag / Hashrate", category: "Hardware & Cloud" },

  // 📈 MECHANIKEN & SPEZIALSYSTEME
  { key: "CorporationValuation", label: "Corporation Bewertung", category: "Spezial-Systeme" },
  { key: "CorporationDivisions", label: "Max. Corporation Divisions", category: "Spezial-Systeme" },
  { key: "CorporationSoftcap", label: "Corporation Dividenden Softcap", category: "Spezial-Systeme" },
  { key: "GangSoftcap", label: "Gang Respekt/Geld Softcap", category: "Spezial-Systeme" },
  { key: "GangUniqueAugs", label: "Gang Eindeutige Augs %", category: "Spezial-Systeme" },
  { key: "BladeburnerRank", label: "Bladeburner Rang-Gewinn", category: "Spezial-Systeme" },
  { key: "BladeburnerSkillCost", label: "Bladeburner Skill-Kosten", category: "Spezial-Systeme", lowerIsBetter: true },
  { key: "StaneksGiftPowerMultiplier", label: "Stanek's Gift Macht", category: "Spezial-Systeme" },
  { key: "StaneksGiftExtraSize", label: "Stanek's Gift Extra-Größe", category: "Spezial-Systeme", baseline: 0 },
  { key: "GoPower", label: "IPvGO Belohnungs-Effekt", category: "Spezial-Systeme" },
  { key: "FourSigmaMarketDataCost", label: "4S Markt-Daten Kosten", category: "Spezial-Systeme", lowerIsBetter: true },
  { key: "FourSigmaMarketDataApiCost", label: "4S Market API Kosten", category: "Spezial-Systeme", lowerIsBetter: true },
];

export async function main(ns: NS): Promise<void> {
  const showAll = ns.args.includes("--all") || ns.args.includes("-a");

  let mults: BitNodeMultipliers;
  try {
    mults = ns.getBitNodeMultipliers();
  } catch {
    ns.tprint("❌ Dieses Skript benötigt Zugriff auf 'getBitNodeMultipliers' (Source-File 5 / BN5).");
    return;
  }

  const buffs: string[] = [];
  const debuffs: string[] = [];
  const neutrals: string[] = [];

  for (const def of MULTIPLIER_DEFINITIONS) {
    const rawVal = mults[def.key];
    if (typeof rawVal !== "number") continue;

    const base = def.baseline ?? 1.0;
    const diff = rawVal - base;

    // Keine Abweichung
    if (Math.abs(diff) < 0.0001) {
      neutrals.push(formatEntry(def, rawVal, "⚪"));
      continue;
    }

    const isBuff = def.lowerIsBetter ? rawVal < base : rawVal > base;

    if (isBuff) {
      buffs.push(formatEntry(def, rawVal, "🟢", true, def.lowerIsBetter));
    } else {
      debuffs.push(formatEntry(def, rawVal, "🔴", false, def.lowerIsBetter));
    }
  }

  ns.tprint(`\n========================================================================================`);
  ns.tprint(`📊 BITNODE MULTIPLIKATOREN ANALYSE`);
  ns.tprint(`========================================================================================\n`);

  // 1. BUFFS
  ns.tprint(`🟢 BUFFS (${buffs.length} Vorteile aktiv):`);
  ns.tprint(`----------------------------------------------------------------------------------------`);
  if (buffs.length === 0) {
    ns.tprint("  Keine Buffs in diesem BitNode vorhanden.");
  } else {
    buffs.forEach((entry) => ns.tprint(entry));
  }
  ns.tprint("");

  // 2. DEBUFFS
  ns.tprint(`🔴 DEBUFFS (${debuffs.length} Einschränkungen aktiv):`);
  ns.tprint(`----------------------------------------------------------------------------------------`);
  if (debuffs.length === 0) {
    ns.tprint("  Keine Debuffs in diesem BitNode vorhanden.");
  } else {
    debuffs.forEach((entry) => ns.tprint(entry));
  }
  ns.tprint("");

  // 3. NEUTRALE / STANDARD (Nur wenn requested)
  if (showAll) {
    ns.tprint(`⚪ UNVERÄNDERT (${neutrals.length} Standard-Multiplikatoren):`);
    ns.tprint(`----------------------------------------------------------------------------------------`);
    neutrals.forEach((entry) => ns.tprint(entry));
    ns.tprint("");
  } else {
    ns.tprint(`💡 Hinweis: ${neutrals.length} unveränderte Standard-Werte (1.0x) ausgeblendet.`);
    ns.tprint(`   Nutze 'run tools/bitnode-analyzer.js --all' um alle Werte anzuzeigen.\n`);
  }
}

function formatEntry(
  def: MultiplierMeta,
  value: number,
  icon: string,
  isBuff?: boolean,
  lowerIsBetter?: boolean
): string {
  const categoryStr = `[${def.category}]`.padEnd(20);
  const labelStr = def.label.padEnd(32);

  let valStr = "";
  if (def.baseline === 0) {
    valStr = `${value >= 0 ? "+" : ""}${value}`;
  } else {
    valStr = `x${value.toFixed(2)}`;
  }

  valStr = valStr.padEnd(8);

  let pctStr = "";
  if (def.baseline !== 0) {
    const pctChange = (value - 1.0) * 100;
    const sign = pctChange > 0 ? "+" : "";
    pctStr = `(${sign}${pctChange.toFixed(0)}%)`;
  }

  return ` ${icon} ${categoryStr} ${labelStr}: ${valStr} ${pctStr}`;
}