import { NS } from "@ns";
// Achte hier auf deinen korrekten Pfad, je nachdem wo deine Library liegt (z.B. "../lib/state.js")
import { DEFAULT_MULTIPLIERS } from "../lib/state.js"; 

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  try {
    ns.print("🔄 Lese BitNode-Konfiguration über Source-File 5 aus...");

    // Wenn SF5 nicht vorhanden ist, springt der Code sofort in den catch-Block
    const mults = ns.getBitNodeMultipliers();

    ns.write("bn-multipliers.txt", JSON.stringify(mults, null, 2), "w");
    ns.print("✅ [SUCCESS] bn-multipliers.txt erfolgreich generiert.");
  } catch (error) {
    ns.print("⚠️ [ENV_WARN] Source-File 5 (Analyse) nicht aktiv.");
    ns.print("📂 Schreibe umfassende Standard-Multiplikatoren aus Shared Library...");

    // Kein Funktionsaufruf nötig, wir schreiben direkt das importierte statische Objekt
    ns.write("bn-multipliers.txt", JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
    ns.print("ℹ️ [INFRA] Standard-Konfiguration erfolgreich hinterlegt.");
  }
}