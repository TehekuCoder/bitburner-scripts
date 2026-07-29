import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const PASS_PORT = 5;

  const jsonDbFile = "/dnet-master-db.json";
  const textDbFile = "/passwords.txt";

  const logger = new Logger(ns, "DNET-MASTER");
  logger.info(
    `🖥️ Darknet-Master gestartet. Synchronisiere Passwörter über Port ${PASS_PORT}...`,
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
    // PORT 5: Passwörter in DB eintragen
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

    await ns.asleep(500);
  }
}