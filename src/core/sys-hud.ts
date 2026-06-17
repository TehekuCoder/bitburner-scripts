import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { renderStatusCard } from "../lib/ui.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  // 1. Öffnet das separate Log-Fenster als unser "OS-Widget"
  ns.ui.openTail();
  
  // v3 API Feature: Setzt einen professionellen Fenstertitel
  ns.ui.setTailTitle("📟 BitOS - Core Dashboard v3.0");
  
  // Perfekte Fenstergröße für unsere Render-Card (42 Zeichen Breite)
  ns.ui.resizeTail(390, 260);
  
  ns.print("🖥️ [HUD] Initialisiere BitOS-Anzeige...");

  while (true) {
    // 2. Alten Frame löschen, bevor wir neu zeichnen (verhindert Flackern/Scrollen)
    ns.clearLog();

    // 3. Den aktuellen globalen Status laden
    const state = loadState(ns);

    if (!state) {
      ns.print("╔══════════════════════════════════════════╗");
      ns.print("║ ⏳ WARTE AUF OS-KERNEL...                ║");
      ns.print("╠══════════════════════════════════════════╣");
      ns.print("║ Bitte starte sys-kernel.ts, um das       ║");
      ns.print("║ System vollständig zu initialisieren.    ║");
      ns.print("╚══════════════════════════════════════════╝");
    } else {
      // 4. Die formatierte Karte aus der UI-Bibliothek anzeigen
      ns.print(renderStatusCard(ns, state));
    }

    // 5. Update-Taktung (4-mal pro Sekunde schont die CPU)
    await ns.sleep(250);
  }
}