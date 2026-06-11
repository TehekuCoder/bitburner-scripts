import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  try {
    ns.print("🔄 Lese BitNode-Konfiguration über Source-File 5 aus...");
    
    // Wenn SF5 nicht vorhanden ist, wirft diese Zeile einen Fehler und springt in den catch-Block
    const mults = ns.getBitNodeMultipliers();
    
    await ns.write("bn-multipliers.txt", JSON.stringify(mults), "w");
    ns.print("✅ [SUCCESS] bn-multipliers.txt erfolgreich generiert.");
  } catch (error) {
    ns.print("⚠️ [ENV_WARN] Source-File 5 (Analyse) nicht aktiv.");
    ns.print("📂 Generiere Standard-Multiplikatoren (Failsafe Mode)...");
    
    // Kompatibilitäts-Fallback, damit JSON.parse() in den anderen Modulen valide Objekte erhält
    const defaultMults = {
      HacknetProduction: 1.0,
      CrimeMoney: 1.0,
      FactionWorkRepGain: 1.0,
      ServerMaxMoney: 1.0,
      HackingLevelMultiplier: 1.0
    };
    
    await ns.write("bn-multipliers.txt", JSON.stringify(defaultMults), "w");
  }
}