import { NS } from "@ns";

/**
 * Erweitertes Interface für die Server-Daten basierend auf deinen Definitionen
 */
interface DarknetServer {
  hostname: string;
  blockedRam: number;
  [key: string]: any;
}

/**
 * Offizielles Interface für Authentifizierungs-Details
 */
interface ServerAuthDetails {
  isConnectedToCurrentServer: boolean;
  hasSession: boolean;
  modelId: string;
  passwordHint: string;
  data: string;
  logTrafficInterval: number;
  passwordLength: number;
  passwordFormat:
    | "numeric"
    | "alphabetic"
    | "alphanumeric"
    | "ASCII"
    | "unicode";
}

const processedServers = new Set<string>();

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const scriptRam = ns.getScriptRam(scriptName);
  ns.disableLog("ALL");

  while (true) {
    // 1. Lokalen Server plündern & neue Passwörter in passwords.txt lernen
    await lootServer(ns);

    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (hostname === "home" || processedServers.has(hostname)) continue;

      const details = ns.dnet.getServerDetails(
        hostname,
      ) as unknown as ServerAuthDetails;

      // 2. Versuchen, den Server zu knacken
      if (await serverSolver(ns, hostname, details)) {
        processedServers.add(hostname);

        const srv = ns.dnet.getServerDetails(hostname)
          .blockedRam as unknown as DarknetServer;

        // RAM freischalten (Nutzt jetzt 'blockedRam')
        if (srv.blockedRam && srv.blockedRam > 0) {
          ns.print(
            `🔓 Schalte ${srv.blockedRam}GB RAM auf ${hostname} frei...`,
          );
          await ns.dnet.memoryReallocation(hostname);
        }

        // 3. Replikation: Skript und gelerntes Wissen (passwords.txt) übertragen
        if (ns.getServerMaxRam(hostname) >= scriptRam) {
          const filesToCopy = [scriptName];
          if (ns.fileExists("passwords.txt", "home")) {
            filesToCopy.push("passwords.txt");
          }

          ns.scp(filesToCopy, hostname, ns.getHostname());
          ns.exec(scriptName, hostname, 1);
        }
      }
    }
    await ns.sleep(5000);
  }
}

async function serverSolver(
  ns: NS,
  hostname: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  if (details.hasSession) return true;
  if (!details.isConnectedToCurrentServer) return false;

  const len = details.passwordLength;

  // Strategie 1: Lokale Textdateien prüfen
  const files = ns.ls(hostname, ".txt");
  for (const file of files) {
    const content = ns.read(file).trim();
    if (content.length <= (len || 20)) {
      if ((await ns.dnet.authenticate(hostname, content)).success) return true;
    }
  }

  // Strategie 2: Modell-spezifische Solver
  switch (details.modelId) {
    // case "AccountsManager_4.2":
    //   return await solveBinarySearch(ns, hostname, len);

    case "BellaCuore":
      return await solveRoman(ns, hostname, details);

    case "OctantVoxel":
      return await solveBaseConversion(ns, hostname, details);

    case "Pr0verFl0":
    case "Pr0verFl0_":
      return await solvePr0verFl0(ns, hostname, details);

    case "OpenWebAccessPoint":
      return await solveSniffing(ns, hostname, details);

    case "DeskMemo_3.1":
    case "DeskMemo":
      return await solveDeskMemo(ns, hostname, details);

    case "CloudBlare(tm)":
      const numericOnly = (details.data || "").replace(/\D/g, "");
      return (await ns.dnet.authenticate(hostname, numericOnly)).success;

    case "ZeroLogon":
      return (await ns.dnet.authenticate(hostname, "")).success;

    case "FreshInstall_1.0":
    case "FreshInstall":
      return await solveDefaults(ns, hostname, details);

    case "PHP 5.4":
    case "PHP 5.1":
    case "PHP": // Falls es Varianten ohne Versionsnummer gibt
      return await solveAnagram(ns, hostname, details);

    case "NIL":
      return await solveNIL(ns, hostname, details);

    case "DeepGreen":
      return await solveDeepGreen(ns, hostname, details);

    default:
      if (
        details.passwordFormat === "numeric" ||
        details.modelId === "AccountsManager_4.2"
      ) {
        return await solveSmartNumeric(ns, hostname, len);
      }
      return await dictionaryAttack(ns, hostname, details);
  }
}

// --- SOLVER FUNKTIONEN ---

async function solveBinarySearch(
  ns: NS,
  host: string,
  len: number,
  initialMin: number,
  initialMax: number,
  lastHint: string,
  lastGuess: number,
): Promise<boolean> {
  let min = initialMin;
  let max = initialMax;
  let hint = lastHint;
  let guess = lastGuess;

  // Solange der Suchbereich noch gültig ist
  while (min <= max) {
    // 1. Grenzen anhand des letzten Hinweises anpassen
    if (hint === "Higher") {
      min = guess + 1; // Das Passwort muss größer sein
    } else if (hint === "Lower") {
      max = guess - 1; // Das Passwort muss kleiner sein
    }

    // 2. Neuer Versuch genau in der Mitte der neuen Grenzen
    guess = Math.floor((min + max) / 2);
    const guessStr = guess.toString().padStart(len, "0");

    const result = await ns.dnet.authenticate(host, guessStr);
    if (result.success) {
      ns.tprint(
        `[SUCCESS] Binary Search hat das Passwort für ${host} geknackt: ${guessStr}`,
      );
      return true;
    }

    // 3. Neuen Hinweis für den nächsten Durchlauf holen
    hint = result.data || "";
    if (!hint) {
      const bleed = await ns.dnet.heartbleed(host);
      const logs = bleed.logs.join(" ");
      if (logs.includes("Higher")) hint = "Higher";
      else if (logs.includes("Lower")) hint = "Lower";
    }
  }

  ns.print(
    `[ERROR] Binary Search auf ${host} fehlgeschlagen. Passwort nicht gefunden.`,
  );
  return false;
}
async function solveRoman(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  const vals: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  const roman = (details.data || "").toUpperCase();
  for (let i = 0; i < roman.length; i++) {
    const cur = vals[roman[i]];
    const next = vals[roman[i + 1]];
    if (next > cur) {
      total += next - cur;
      i++;
    } else total += cur;
  }
  return ns.dnet
    .authenticate(host, total.toString())
    .then((res) => res.success);
}

async function solveBaseConversion(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
) {
  const parts = (details.data || "").split(",");
  if (parts.length !== 2) return false;
  const result = parseInt(parts[1], parseInt(parts[0])).toString();
  return (await ns.dnet.authenticate(host, result)).success;
}

// WICHTIG: details in der Parameterliste ergänzen
async function solveSniffing(ns: NS, host: string, details: ServerAuthDetails) {
  for (let i = 0; i < 5; i++) {
    const bleed = await ns.dnet.heartbleed(host);
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);

    // 1. Suche nach dem offensichtlichen Muster (zur Sicherheit behalten)
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch && (await ns.dnet.authenticate(host, exactMatch[1])).success)
      return true;

    // 2. Deine Idee: Wir holen alle Wörter und Zahlen aus dem Text
    // \b\w+\b findet alle isolierten Zahlen- oder Buchstabenketten
    const allCandidates = bleedStr.match(/\b\w+\b/g) || [];

    // Wir entfernen Duplikate, um API-Calls zu sparen
    const uniqueCandidates = [...new Set(allCandidates)];

    for (const candidate of uniqueCandidates) {
      // Filtern: Wir testen nur Dinge, die exakt die gesuchte Länge haben
      if (details.passwordLength && candidate.length !== details.passwordLength)
        continue;

      if ((await ns.dnet.authenticate(host, candidate)).success) {
        ns.print(`[DNET] Sniffing-Treffer auf ${host}: ${candidate}`);
        return true;
      }
    }

    await ns.sleep(1000); // Warten, bis der Server neue Logs generiert hat
  }
  return false;
}

async function solveDeskMemo(ns: NS, host: string, details: ServerAuthDetails) {
  const hint = details.passwordHint || "";
  const combined = hint.replace(/\D/g, "");
  if (combined && (await ns.dnet.authenticate(host, combined)).success)
    return true;
  const sequences = hint.match(/\d+/g) || [];
  for (const seq of sequences) {
    if ((await ns.dnet.authenticate(host, seq)).success) return true;
  }
  return false;
}

async function solveNumericBruteForce(ns: NS, host: string, len: number) {
  if (!len || len <= 0) return false;
  const max = Math.pow(10, len);
  for (let i = 0; i < max; i++) {
    const guess = i.toString().padStart(len, "0");
    if ((await ns.dnet.authenticate(host, guess)).success) return true;
    if (i % 200 === 0) await ns.sleep(1);
  }
  return false;
}

async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
) {
  if (!ns.fileExists("passwords.txt")) return false;
  const list = ns
    .read("passwords.txt")
    .split(/[\r\n,]+/)
    .map((p) => p.trim())
    .filter((p) => p);
  for (const pw of list) {
    if (details.passwordLength && pw.length > details.passwordLength) continue;
    if ((await ns.dnet.authenticate(host, pw)).success) return true;
  }
  return false;
}

async function lootServer(ns: NS): Promise<void> {
  const host = ns.getHostname();
  const files = ns.ls(host, ".cache");
  for (const file of files) {
    try {
      const result = (await ns.dnet.openCache(file)) as any;
      if (result && result.success) {
        const potentialPw = result.data || result.message;
        if (typeof potentialPw === "string") {
          const cleanPw = potentialPw.includes(":")
            ? potentialPw.split(":").pop()?.trim()
            : potentialPw.trim();
          if (cleanPw) updatePasswordFile(ns, cleanPw);
        }
        ns.rm(file, host);
      }
    } catch (e) {}
  }
}

function updatePasswordFile(ns: NS, newPw: string): void {
  const file = "passwords.txt";
  const pws = new Set<string>();

  if (ns.fileExists(file, "home")) {
    ns.read(file)
      .split(/[\n,]+/)
      .forEach((p) => {
        const trimmed = p.trim();
        if (trimmed) pws.add(trimmed);
      });
  }

  if (!pws.has(newPw)) {
    ns.write(file, `\n${newPw}`, "a"); // Synchroner Schreibvorgang, kein await nötig!
  }
}

async function solveDefaults(ns: NS, host: string, details: ServerAuthDetails) {
  // Liste der typischen Werks-Passwörter
  const defaultPws = [
    "admin",
    "password",
    "root",
    "guest",
    "0000",
    "1234",
    "12345",
    "123456",
    "qwerty",
    "1111",
  ];

  for (const pw of defaultPws) {
    // Wir filtern nur Passwörter raus, die zu lang sind
    if (details.passwordLength && pw.length > details.passwordLength) continue;

    if ((await ns.dnet.authenticate(host, pw)).success) {
      ns.print(`[DNET] Standard-Passwort erfolgreich: ${pw}`);
      return true;
    }
  }

  // Falls der Admin das Passwort doch geändert hat, werfen wir das Wörterbuch hinterher
  return await dictionaryAttack(ns, host, details);
}

async function solvePr0verFl0(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
) {
  const len = details.passwordLength;
  if (!len) return false;

  // Der Puffer-Überlauf: Wir nehmen die geforderte Länge mal 2
  const overflowString = "A".repeat(len * 2);

  ns.print(
    `[DNET] Führe Buffer-Overflow auf ${host} aus (Puffer: ${len}, Payload: ${len * 2})...`,
  );

  const result = await ns.dnet.authenticate(host, overflowString);
  if (result.success) {
    ns.print(`[DNET] Pr0verFl0 Exploit erfolgreich auf ${host}!`);
    return true;
  }

  return false;
}

async function solveSmartNumeric(ns: NS, host: string, len: number) {
  if (!len || len <= 0) return false;

  // 1. Dynamischer Längen-Check (Wie von dir vorgeschlagen)
  // Bei einer Länge von 1 (also 0-9 bzw. 0-10) ist Brute-Force völlig ausreichend.
  if (len === 1) {
    ns.print(
      `[DNET] Nutze gewöhnlichen Brute-Force für kurze Zahl (Länge: ${len}) auf ${host}`,
    );
    return await solveNumericBruteForce(ns, host, len);
  }

  // 2. Erster Test für Binary Search
  const maxVal = Math.pow(10, len) - 1; // z.B. bei len=2 ist maxVal 99
  let min = 0;
  let max = maxVal;

  // Wir raten genau in der Mitte
  let guess = Math.floor((min + max) / 2);
  let testGuess = guess.toString().padStart(len, "0");

  const result = await ns.dnet.authenticate(host, testGuess);
  if (result.success) return true; // Volltreffer beim ersten Versuch!

  // 3. Den Hinweis extrahieren (Der Trick mit dem data-Feld oder heartbleed)
  let hint = result.data || "";

  // Falls der Server den Hint doch nicht im data-Feld mitschickt, kratzen wir die Logs ab
  if (!hint) {
    const bleedResult = await ns.dnet.heartbleed(host);
    const logs = bleedResult.logs.join(" ");
    if (logs.includes("Higher")) hint = "Higher";
    else if (logs.includes("Lower")) hint = "Lower";
  }

  // 4. Entscheidung: Binary Search oder Notfall-Brute-Force
  if (hint === "Higher" || hint === "Lower") {
    ns.print(
      `[DNET] Server gibt Hinweise (${hint}). Starte Binary Search auf ${host}...`,
    );
    return await solveBinarySearch(ns, host, len, min, max, hint, guess);
  } else {
    ns.print(
      `[DNET] Keine Hinweise vom Server. Starte harten Brute-Force auf ${host}`,
    );
    return await solveNumericBruteForce(ns, host, len);
  }
}
function getPermutations(str: string): string[] {
  if (str.length <= 1) return [str];

  const perms = new Set<string>(); // Set verhindert doppelte Einträge bei gleichen Ziffern (z.B. "112")

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const remaining = str.slice(0, i) + str.slice(i + 1);

    for (const p of getPermutations(remaining)) {
      perms.add(char + p);
    }
  }

  return Array.from(perms);
}

async function solveAnagram(ns: NS, host: string, details: ServerAuthDetails) {
  const sortedPassword = details.data;

  // Sicherheitscheck: Haben wir überhaupt Daten zum Kombinieren?
  if (!sortedPassword) return false;

  const combinations = getPermutations(sortedPassword);
  ns.print(`[DNET] Teste ${combinations.length} Kombinationen für ${host}...`);

  for (const guess of combinations) {
    if ((await ns.dnet.authenticate(host, guess)).success) {
      ns.print(`[DNET] Anagramm geknackt auf ${host}: ${guess}`);
      return true;
    }
  }

  return false;
}

async function solveNIL(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  // 1. Dynamische Länge auslesen (Fallback auf 5, falls mal nicht definiert)
  const len = details.passwordLength || 5;

  // Arrays dynamisch basierend auf der erkannten Länge erstellen
  const digits = new Array(len).fill(0);
  const locked = new Array(len).fill(false);

  ns.print(
    `[DNET] Starte dynamischen NIL-Solver (${len} Stellen) auf ${host}...`,
  );

  while (locked.includes(false)) {
    const guess = digits.join("");

    // 2. Authentifizierung senden
    const result = await ns.dnet.authenticate(host, guess);
    if (result.success) return true;

    // 3. Synchron auf das exakt passende Log warten (Verhindert Race Conditions)
    let logObj = null;
    for (let check = 0; check < 10; check++) {
      const bleed = (await ns.dnet.heartbleed(host)) as any;

      if (bleed && bleed.logs && bleed.logs.length > 0) {
        for (let i = bleed.logs.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(bleed.logs[i]);
            // Prüfen, ob dieses Log exakt zu unserem aktuellen Rateversuch gehört
            if (parsed && String(parsed.passwordAttempted) === guess) {
              logObj = parsed;
              break;
            }
          } catch (e) {
            // Ignoriere defektes JSON im Log
          }
        }
      }
      if (logObj) break;
      await ns.sleep(20);
    }

    if (!logObj || !logObj.data) {
      ns.print(
        `[WARN] Log für ${guess} nicht rechtzeitig empfangen. Wiederhole Schritt...`,
      );
      await ns.sleep(50);
      continue;
    }

    // 4. Feedback auswerten
    const feedback = logObj.data.split(",");

    // 5. Kernlogik: Läuft jetzt dynamisch bis 'len'
    for (let i = 0; i < len; i++) {
      if (feedback[i] === "yes") {
        locked[i] = true; // Stelle einfrieren
      } else if (!locked[i]) {
        digits[i] = (digits[i] + 1) % 10; // Nur ungelockte Stellen hochzählen
      }
    }

    // Kurze Pause für die Engine
    await ns.sleep(20);
  }

  // Letzter Kontrollversuch mit dem fertig zusammengesetzten Passwort
  return (await ns.dnet.authenticate(host, digits.join(""))).success;
}
async function solveDeepGreen(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  // 1. Dynamische Länge (Fallback auf 3)
  const len = details.passwordLength || 3;
  ns.print(
    `[DNET] Starte dynamischen DeepGreen-Solver (${len} Stellen) auf ${host}...`,
  );

  // Start-Maske dynamisch aufbauen, z.B. ["x", "x", "x"]
  const currentGuess = new Array(len).fill("x");

  // Wir arbeiten uns von hinten nach vorne durch
  for (let pos = len - 1; pos >= 0; pos--) {
    // Bei pos=2 erwarten wir 1 Treffer, bei pos=1 erwarten wir 2, etc.
    const targetCorrectCount = len - pos;

    for (let digit = 0; digit <= 9; digit++) {
      currentGuess[pos] = String(digit);
      const guess = currentGuess.join("");

      // Authentifizierung senden
      const result = await ns.dnet.authenticate(host, guess);
      if (result.success) return true;

      // WICHTIG: Wir geben der Game-Engine 500ms Vorsprung, um das Log zu schreiben!
      await ns.sleep(500);

      let logObj = null;
      for (let check = 0; check < 10; check++) {
        const bleed = (await ns.dnet.heartbleed(host)) as any;

        if (bleed && bleed.logs && bleed.logs.length > 0) {
          for (let i = bleed.logs.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(bleed.logs[i]);
              if (parsed && String(parsed.passwordAttempted) === guess) {
                logObj = parsed;
                break;
              }
            } catch (e) {
              // Ignoriere defektes JSON im Log
            }
          }
        }
        if (logObj) break;
        await ns.sleep(100); // Insgesamt bis zu 1 Sekunde warten, falls der Server stark laggt
      }

      // Falls das Log nach 1 Sekunde immer noch nicht da ist
      if (!logObj || !logObj.data) {
        ns.print(
          `[WARN] Timeout: Kein Log für ${guess}. Wiederhole Schritt...`,
        );
        digit--; // Erst JETZT wiederholen wir, da wir sicher sind, dass kein altes Log stört
        continue;
      }

      // Zahlen aus dem "data"-Feld extrahieren (z.B. "0,0")
      const matches = logObj.data.match(/\d+/g);
      if (!matches) continue;

      // Die erste Zahl im String gibt die korrekten Positionen an
      const correctPos = parseInt(matches[0]);

      if (correctPos === targetCorrectCount) {
        ns.print(`[DNET] Position ${pos} gelöst: ${digit}`);
        break; // Diese Ziffer stimmt! Schleife abbrechen und zur nächsten Position vorrücken
      }
    }
  }

  // Letzter Sicherheits-Check mit der finalen Kombination
  return (await ns.dnet.authenticate(host, currentGuess.join(""))).success;
}
