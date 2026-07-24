import { NS } from "@ns";
import { TARGET_PROGRAMS } from "/lib/constants";

export function printDashboard(
  ns: NS,
  isHomePrioritized: boolean,
  currentState: any,
): void {
  ns.clearLog();

  const homeMaxRam = ns.getServerMaxRam("home");
  const homeUsedRam = ns.getServerUsedRam("home");
  const homeCores = currentState?.homeCores ?? 1;

  ns.print(`============================================================`);
  ns.print(` ⚙️  BIT-OS INFRASTRUCTURE MONITOR`);
  ns.print(`============================================================`);
  ns.print(`🏠 HOME COMPUTER`);
  ns.print(
    `   RAM:   ${ns.format.ram(homeMaxRam).padEnd(9)} (Genutzt: ${ns.format.ram(homeUsedRam)})`,
  );
  ns.print(`   CORES: ${homeCores} Kerne`);

  const pServers = ns.cloud.getServerNames();
  const isRushMode = currentState?.isRushModeActive ?? false;

  if (isRushMode) {
    ns.print(
      `   🚦 STRATEGIE: 🚀 BATCHER-RUSH (Fokus auf ein einzelnes 64GB P-Serv)`,
    );
  } else if (isHomePrioritized) {
    ns.print(`   🚦 STRATEGIE: 👑 HOME-PRIORITÄT AKTIV (P-Serv eingefroren)`);
  } else {
    ns.print(`   🚦 STRATEGIE: 💸 Normalbetrieb (Netzwerk-Expansion)`);
  }

  ns.print("------------------------------------------------------------");
  ns.print(`🖥️  CLOUD-NETZWERK (PURCHASED SERVERS)`);

  const currentServers = ns.cloud.getServerNames();
  const maxServers = ns.cloud.getServerLimit();

  if (currentServers.length === 0) {
    ns.print(`   [Keine kaufbaren Server im aktuellen BitNode registriert]`);
  } else {
    currentServers.sort().forEach((server) => {
      const ram = ns.getServerMaxRam(server);
      const used = ns.getServerUsedRam(server);
      const bar =
        "█".repeat(Math.round((used / ram) * 10)) +
        "░".repeat(10 - Math.round((used / ram) * 10));
      ns.print(
        `   • ${server.padEnd(12)} : ${ns.format.ram(ram).padStart(9)}  [${bar}]`,
      );
    });
  }
  ns.print(
    `   Kapazität: ${currentServers.length} / ${maxServers} Server slots genutzt.`,
  );
  ns.print("------------------------------------------------------------");

  ns.print(`💾 SOFTWARE-INVENTAR`);
  let gridLine = "   ";
  for (let i = 0; i < TARGET_PROGRAMS.length; i++) {
    const progName = TARGET_PROGRAMS[i];
    const status = ns.fileExists(progName, "home") ? "✅" : "❌";
    gridLine += `[${status}] ${progName.padEnd(22)}`;

    if ((i + 1) % 2 === 0 || i === TARGET_PROGRAMS.length - 1) {
      ns.print(gridLine);
      gridLine = "   ";
    }
  }
  ns.print(`============================================================`);
}