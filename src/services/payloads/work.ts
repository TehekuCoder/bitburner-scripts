import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;

  if (!target || !ns.serverExists(target)) {
    ns.print(`ERROR: Ungültiges Ziel [${target}]. Nutzung: run work.ts [target]`);
    return;
  }

  // Deaktiviere den unübersichtlichen Standard-Log von Bitburner
  ns.disableLog("ALL");

  const maxMoney = ns.getServerMaxMoney(target);
  const minSecurity = ns.getServerMinSecurityLevel(target);

  if (maxMoney === 0) {
    ns.print(`ABORT: ${target} hat kein Geld und kann nicht gehackt werden.`);
    return;
  }

  // Schwellenwerte für optimale Ausbeute im Early/Mid-Game
  const moneyThresh = maxMoney * 0.90;
  const securityThresh = minSecurity + 2;

  ns.print(`=== WORKER START: ${target} ===`);
  ns.print(`Ziel-Security: <= ${minSecurity + 2} (Min: ${minSecurity})`);
  ns.print(`Ziel-Geld:     >= $${ns.format.number(moneyThresh, 2)} (Max: $${ns.format.number(maxMoney, 2)})`);
  ns.print(`--------------------------------------------------`);

  while (true) {
    try {
      if (!ns.hasRootAccess(target)) {
        ns.print(`[WARN] Kein Root-Zugriff auf ${target}. Warte 5s...`);
        await ns.sleep(5000);
        continue;
      }

      const currentSecurity = ns.getServerSecurityLevel(target);
      const currentMoney = ns.getServerMoneyAvailable(target);

      // Kompakte Status-Strings für saubere Logs
      const secStr = `${currentSecurity.toFixed(2)}/${minSecurity}`;
      const moneyPct = ((currentMoney / maxMoney) * 100).toFixed(1);
      const moneyStr = `$${ns.format.number(currentMoney, 2)} (${moneyPct}%)`;

      if (currentSecurity > securityThresh) {
        ns.print(`[WEAKEN] Sec: ${secStr} | Money: ${moneyStr}`);
        await ns.weaken(target);
      } else if (currentMoney < moneyThresh) {
        ns.print(`[GROW]   Sec: ${secStr} | Money: ${moneyStr}`);
        await ns.grow(target);
      } else {
        ns.print(`[HACK]   Sec: ${secStr} | Money: ${moneyStr}`);
        await ns.hack(target);
      }
    } catch (e: unknown) {
      ns.print(`[ERROR] Unerwarteter Fehler: ${String(e)}`);
      await ns.sleep(5000);
    }
    await ns.sleep(1);
  }
}