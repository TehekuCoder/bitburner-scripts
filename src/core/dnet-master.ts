import { NS } from "@ns";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const PORT_ID = 5;

  const jsonDbFile = "/dnet-master-db.json";
  const textDbFile = "/passwords.txt";

  const logger = new Logger(ns, "DNET-MASTER", "INFO", "/logs/dnet_system.txt");
  logger.info("🖥️ Darknet-Master gestartet. Lausche auf Port " + PORT_ID);

  let passwordDb: Record<string, string> = {};

  if (ns.fileExists(jsonDbFile, "home")) {
    try {
      passwordDb = JSON.parse(ns.read(jsonDbFile));
    } catch {
      passwordDb = {};
    }
  }

  while (true) {
    const port = ns.getPortHandle(PORT_ID);

    while (!port.empty()) {
      const dataString = port.read() as string;
      const [host, password] = dataString.split(":");

      if (host && password !== undefined && passwordDb[host] !== password) {
        passwordDb[host] = password;

        logger.success(`🔑 Neues Passwort registriert: ${host} -> "${password}"`);

        // 🟢 FIX: Aktualisierte JSON-Datenbank direkt auf Disk schreiben
        await ns.write(jsonDbFile, JSON.stringify(passwordDb, null, 2), "w");

        const uniquePasswords = [...new Set(Object.values(passwordDb))].filter(
          (pw) =>
            pw &&
            !pw.includes("You have discovered") &&
            !pw.includes("shares of") &&
            pw.length < 30,
        );

        await ns.write(textDbFile, uniquePasswords.join("\n"), "w");
      }
    }
    await ns.asleep(100);
  }
}