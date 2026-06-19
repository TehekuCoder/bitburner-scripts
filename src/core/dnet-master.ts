import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  //   ns.disableLog("ALL");
  const PORT_ID = 5;

  // Pfade absolut im VFS anlegen, um Verwirrung zu vermeiden
  const jsonDbFile = "/dnet-master-db.json"; // Deine strukturierte Übersicht
  const textDbFile = "/passwords.txt"; // Die reine Payload-Liste für die Würmer

  // Zentrale Passwort-Datenbank im RAM
  let passwordDb: Record<string, string> = {};

  // Falls vorhanden, alte JSON-Datenbank laden
  if (ns.fileExists(jsonDbFile, "home")) {
    try {
      passwordDb = JSON.parse(ns.read(jsonDbFile));
    } catch {
      passwordDb = {};
    }
  }

  ns.tprint("🖥️ Darknet-Master gestartet. Lausche auf Port " + PORT_ID);

  while (true) {
    const port = ns.getPortHandle(PORT_ID);

    // 🔥 FIX: 'while' statt 'if' verarbeitet die gesamte Queue sofort,
    // falls mehrere Würmer im selben Moment Erfolge melden!
    while (!port.empty()) {
      const dataString = port.read() as string; // Format: "hostname:passwort"
      const [host, password] = dataString.split(":");

      // Wenn wir den Host oder das Passwort noch nicht kennen, eintragen
      if (host && password !== undefined && passwordDb[host] !== password) {
        passwordDb[host] = password;
        ns.print(`💾 Neues Passwort registriert: ${host} -> "${password}"`);

        // 🔥 FIX: ns.clear() entfernt!
        // Das "w"-Argument überschreibt die Datei komplett oder erstellt sie, falls sie fehlt.
        await ns.write(jsonDbFile, JSON.stringify(passwordDb, null, 2), "w");

        // Extrahiere alle einzigartigen Passwörter als reine Klartext-Liste
        const uniquePasswords = [...new Set(Object.values(passwordDb))];

        // 🔥 FIX: Auch hier ns.clear() entfernt!
        await ns.write(textDbFile, uniquePasswords.join("\n"), "w");
      }
    }
    // Kurze Pause, um die CPU auf 'home' zu schonen
    await ns.asleep(100);
  }
}
