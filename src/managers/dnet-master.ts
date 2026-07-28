import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { PATHS } from "/lib/paths";

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const PASS_PORT = 5;
  const CRACK_PORT = 6;

  const jsonDbFile = "/dnet-master-db.json";
  const textDbFile = "/passwords.txt";

  const logger = new Logger(ns, "DNET-MASTER");
  logger.info(
    `🖥️ Darknet-Master gestartet. Lausche auf Port ${PASS_PORT} (Passwörter) & Port ${CRACK_PORT} (Crack-Anfragen)...`,
  );

  let passwordDb: Record<string, string> = {};

  if (ns.fileExists(jsonDbFile, "home")) {
    try {
      passwordDb = JSON.parse(ns.read(jsonDbFile));
    } catch {
      passwordDb = {};
    }
  }

  while (true) {
    // ==========================================
    // 1. PORT 5: Passwörter in DB eintragen
    // ==========================================
    const passHandle = ns.getPortHandle(PASS_PORT);
    let hasChanges = false;

    while (!passHandle.empty()) {
      const rawData = passHandle.read() as string;
      let host = "";
      let password = "";

      try {
        const parsed = JSON.parse(rawData);
        host = parsed.host;
        password = parsed.password;
      } catch {
        const firstColon = rawData.indexOf(":");
        if (firstColon !== -1) {
          host = rawData.substring(0, firstColon);
          password = rawData.substring(firstColon + 1);
        }
      }

      if (
        host &&
        typeof password === "string" &&
        password.trim().length > 0 &&
        passwordDb[host] !== password
      ) {
        passwordDb[host] = password;
        hasChanges = true;

        logger.success(
          `🔑 Neues Passwort registriert: ${host} -> "${password}"`,
        );
      }
    }

    if (hasChanges) {
      await ns.write(jsonDbFile, JSON.stringify(passwordDb, null, 2), "w");

      const uniquePasswords = [...new Set(Object.values(passwordDb))]
        .map((pw) => (typeof pw === "string" ? pw.trim() : ""))
        .filter(
          (pw) =>
            pw.length > 0 &&
            !pw.includes("You have discovered") &&
            !pw.includes("shares of") &&
            pw.length < 30,
        );

      await ns.write(textDbFile, uniquePasswords.join("\n"), "w");
    }

    // ==========================================
    // 2. PORT 6: Crack-Anfragen verarbeiten
    // ==========================================
    const crackHandle = ns.getPortHandle(CRACK_PORT);

    while (!crackHandle.empty()) {
      const rawData = crackHandle.read() as string;
      let targetHost = "";

      try {
        const parsed = JSON.parse(rawData);
        targetHost = parsed.host;
      } catch {
        targetHost = rawData.trim();
      }

      if (!targetHost || !ns.serverExists(targetHost)) continue;

      const solverScript = PATHS.tasks.solver;
      const targetSolverPath = normalizePath(solverScript);

      // Prüfen, ob für diesen Host bereits ein Solver läuft (Pfad-Normalisierung)
      const isAlreadyRunning = ns.ps("home").some(
        (proc) =>
          normalizePath(proc.filename) === targetSolverPath &&
          proc.args[0] === targetHost,
      );

      if (!isAlreadyRunning) {
        const solverRam = ns.getScriptRam(solverScript, "home");
        const freeHomeRam =
          ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

        if (freeHomeRam >= solverRam) {
          logger.info(`⚡ Starte zentralen Solver für '${targetHost}' auf home...`);
          ns.exec(solverScript, "home", 1, targetHost);
        } else {
          logger.warn(
            `⚠️ Zu wenig RAM auf 'home' für '${targetHost}'! Schiebe Anfrage zurück in Queue...`,
          );
          // Zurück in den Port schreiben, um den Request nicht zu verlieren
          ns.writePort(CRACK_PORT, JSON.stringify({ host: targetHost }));
          await ns.asleep(500);
          break; // Schleife abbrechen und auf freie Kapazitäten warten
        }
      }
    }

    await ns.asleep(200);
  }
}