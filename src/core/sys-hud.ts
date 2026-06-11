import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { renderStatusCard } from "../lib/ui.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  // Öffnet das separate Log-Fenster als unser "OS-Widget"
  ns.ui.openTail();
  
  // Perfekte Fenstergröße für unsere Render-Card (42 Zeichen Breite)
  ns.ui.resizeTail(390, 260);
  
  ns.print("🖥️ [HUD] Initialisiere BitOS-Anzeige...");

  while (true) {
    // 1. Alten Frame löschen, bevor wir neu zeichnen (verhindert Flackern/Scrollen)
    ns.clearLog();

    // 2. Den aktuellen globalen Status laden
    const state = loadState(ns);

    if (!state) {
      ns.print("╔══════════════════════════════════════════╗");
      ns.print("║ ⏳ WARTE AUF OS-KERNEL...                ║");
      ns.print("╠══════════════════════════════════════════╣");
      ns.print("║ Bitte starte sys-kernel.ts, um das       ║");
      ns.print("║ System vollständig zu initialisieren.    ║");
      ns.print("╚══════════════════════════════════════════╝");
    } else {
      // 3. Die formatierte Karte aus der UI-Bibliothek anzeigen
      ns.print(renderStatusCard(ns, state));
    }

    // 4. Update-Taktung (4-mal pro Sekunde reicht für ein HUD völlig aus
    // und spart massive CPU-Ressourcen im Vergleich zu den Batcher-Zyklen)
    await ns.sleep(250);
  }
}