import { NS } from "@ns";
import { loadState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const SHARE_SCRIPT = "payloads/share.js";
  const GLOBAL_SHARE_POWER_CAP = 1.42;

  const maxRam = ns.getServerMaxRam(target);
  const scriptRam = ns.getScriptRam(SHARE_SCRIPT, target);

  // Abbruch, wenn der Server zu klein für mindestens 1 Thread ist
  if (maxRam < scriptRam || scriptRam === 0) return;

  while (true) {
    const state = loadState(ns);

    // 🛡️ 1. DYNAMISCHES RESERVE-RAM (Sicherheitspuffer)
    // Home braucht etwas Puffer für Orchestrator/Dispatcher/JIT-Batcher,
    // um neue Prozesse ohne "Out of RAM"-Fehler zu starten.
    let systemReserve = 0;
    if (target === "home") {
      // Zwischen 32 GB und 128 GB (max 5% des Home-RAMs)
      systemReserve = Math.min(128, Math.max(32, maxRam * 0.05));
    } else {
      // Externe Nodes benötigen kaum Puffer (max 2% oder 4 GB)
      systemReserve = Math.min(4, maxRam * 0.02);
    }

    // 📊 2. PROZENTUALES CAP ERMITTELN
    const currentSharePower = ns.getSharePower();
    let maxAllowedPercent = 0.95; // Standard: Nutze bis zu 95% des freien RAMs

    if (state?.fillerConfig?.shareMaxRamPercent !== undefined) {
      maxAllowedPercent = state.fillerConfig.shareMaxRamPercent;
    } else if (state?.strategy === "REP") {
      maxAllowedPercent = 0.98; // Im REP-Grind maximal aggressiv
    } else if (currentSharePower >= GLOBAL_SHARE_POWER_CAP) {
      // Soft-Cap erreicht: RAM/CPU schonen, außer wir grindet Reputitation
      maxAllowedPercent = 0.20;
    }

    // 💡 3. ECHTES FREIES RAM BERECHNEN (Schwamm-Logik)
    const totalUsedRam = ns.getServerUsedRam(target);

    // Threads und RAM-Verbrauch von laufenden share.js-Instanzen ermitteln
    const currentShareThreads = ns
      .ps(target)
      .filter((proc) => proc.filename.replace(/^\//, "") === SHARE_SCRIPT)
      .reduce((acc, proc) => acc + proc.threads, 0);

    const currentShareRam = currentShareThreads * scriptRam;
    
    // RAM, das von ALLEN ANDEREN Skripten belegt wird (Batcher, Prepper, etc.)
    const nonShareUsedRam = totalUsedRam - currentShareRam;

    // Für Share verfügbar = Gesamt-RAM - Fremd-RAM - Reserve
    const realFreeRamForShare = maxRam - nonShareUsedRam - systemReserve;

    // Auf das max. prozentuale Limit des Gesamtsystems deckeln
    const maxShareRamByCap = maxRam * maxAllowedPercent;
    const targetShareRam = Math.max(0, Math.min(realFreeRamForShare, maxShareRamByCap));

    const targetThreads = Math.floor(targetShareRam / scriptRam);

    // 🚀 4. PROZESS-ANPASSUNG
    // Nur neu starten, wenn sich die Thread-Anzahl um >5% unterscheidet oder von/auf 0 fällt
    const threadDiff = Math.abs(targetThreads - currentShareThreads);
    const shouldUpdate =
      targetThreads !== currentShareThreads &&
      (threadDiff > currentShareThreads * 0.05 || currentShareThreads === 0 || targetThreads === 0);

    if (shouldUpdate) {
      if (currentShareThreads > 0) {
        ns.scriptKill(SHARE_SCRIPT, target);
      }
      if (targetThreads > 0) {
        ns.exec(SHARE_SCRIPT, target, targetThreads);
      }
    }

    await ns.sleep(1000); // 1 Sekunde Intervall für schnelle Reaktion auf den Batcher
  }
}