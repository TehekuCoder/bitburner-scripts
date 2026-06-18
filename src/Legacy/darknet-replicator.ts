import { NS } from "@ns";

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
  ns.disableLog("ALL");
  //   ns.ui.openTail(); // Öffnet das Log-Fenster automatisch, damit du die Progress Bar siehst

  const currentHost = ns.getHostname();

  // --- FIX 1: FEHLER AUF 'HOME' VERMEIDEN ---
  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation(); // Blockierten RAM nur auf echten Darknet-Servern freischalten
    // Falls du Option 2 nutzt (ohne extra Skript), kannst du hier auch stasis aktivieren:
    // ns.dnet.setStasisLink();
  } else {
    ns.print(
      "Start auf 'home' registriert. Darknet-Optimierungen werden für Targets aufgespart.",
    );
  }

  const scriptRam = ns.getScriptRam(scriptName);

  while (true) {
    await lootServer(ns);
    const nearbyServers = ns.dnet.probe();

    for (const hostname of nearbyServers) {
      if (hostname === "home" || processedServers.has(hostname)) continue;

      const details = ns.dnet.getServerDetails(
        hostname,
      ) as unknown as ServerAuthDetails;
      if (!details.isConnectedToCurrentServer) continue;

      ns.print(
        `Greife Target an: ${hostname} (${details.modelId || "Unbekannt"})`,
      );

      if (await serverSolver(ns, hostname, details)) {
        processedServers.add(hostname);
        ns.print(`[SUCCESS] ${hostname} erfolgreich übernommen!`);

        if (ns.getServerMaxRam(hostname) >= scriptRam) {
          const filesToCopy = [scriptName];
          if (ns.fileExists("dnet-stasis.js", "home"))
            filesToCopy.push("dnet-stasis.js");
          if (ns.fileExists("passwords.txt", "home"))
            filesToCopy.push("passwords.txt");

          ns.scp(filesToCopy, hostname, currentHost);

          // Falls du den Hilfsskript-Trick für Stasis nutzt:
          if (ns.fileExists("dnet-stasis.js", hostname)) {
            ns.exec("dnet-stasis.js", hostname, 1);
            while (ns.scriptRunning("dnet-stasis.js", hostname)) {
              await ns.sleep(100);
            }
          }

          ns.exec(scriptName, hostname, 1);
        }
      }
    }
    await ns.sleep(5000);
  }
}

// --- FIX 2: REUSABLE PROGRESS BAR FUNKTION ---
function drawProgress(
  ns: NS,
  host: string,
  current: number,
  total: number,
  mode: string,
): void {
  const size = 15; // Breite der Bar
  const progress = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(size * progress);
  const empty = size - filled;
  const bar = "■".repeat(filled) + "□".repeat(empty);
  const percent = (progress * 100).toFixed(1);

  // Löscht das alte Log nicht komplett, sondern überschreibt sauber die Ansicht
  ns.print(`[${mode}] ${host} -> ${bar} ${percent}% (${current}/${total})`);
}

async function serverSolver(
  ns: NS,
  hostname: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  if (details.hasSession) return true;
  if (!details.isConnectedToCurrentServer) return false;

  if (await dictionaryAttack(ns, hostname, details)) return true;

  const len = details.passwordLength;

  const files = ns.ls(hostname, ".txt");
  for (const file of files) {
    const content = ns.read(file).trim();
    if (content.length <= (len || 20)) {
      if ((await ns.dnet.authenticate(hostname, content)).success) return true;
    }
  }

  switch (details.modelId) {
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
    case "PHP":
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
      return false;
  }
}
async function solveNumericBruteForce(ns: NS, host: string, len: number) {
  if (!len || len <= 0) return false;
  const max = Math.pow(10, len);

  for (let i = 0; i < max; i++) {
    const guess = i.toString().padStart(len, "0");
    if ((await ns.dnet.authenticate(host, guess)).success) return true;

    // Progress-Update alle 100 Ticks, um Ruckeln zu verhindern
    if (i % 100 === 0) {
      drawProgress(ns, host, i, max, "BruteForce");
      await ns.sleep(1);
    }
  }
  return false;
}
async function solveNIL(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  const len = details.passwordLength || 5;
  const digits = new Array(len).fill(0);
  const locked = new Array(len).fill(false);

  while (locked.includes(false)) {
    const guess = digits.join("");

    // Fortschritt in deiner neuen Progress Bar anzeigen
    const currentLocked = locked.filter((v) => v).length;
    drawProgress(ns, host, currentLocked, len, "NIL-Locking");

    const result = await ns.dnet.authenticate(host, guess);
    if (result.success) return true;

    let logObj = null;

    // TIMING-FIX: Erhöht auf 15 Versuche mit 20ms Sleep (max 300ms),
    // um Verzögerungen durch die vorherige Dictionary-Attacke abzufangen.
    for (let check = 0; check < 15; check++) {
      const bleed = (await ns.dnet.heartbleed(host)) as any;
      if (bleed && bleed.logs && bleed.logs.length > 0) {
        // Wir suchen von hinten (neueste Logs zuerst)
        for (let i = bleed.logs.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(bleed.logs[i]);
            if (parsed && String(parsed.passwordAttempted) === guess) {
              logObj = parsed;
              break;
            }
          } catch (e) {}
        }
      }
      if (logObj) break;
      await ns.sleep(20);
    }

    // Wenn kein Log gefunden wurde, kurz warten und den Versuch wiederholen
    if (!logObj || !logObj.data) {
      await ns.sleep(50);
      continue;
    }

    // --- FORMATIERUNGS-FIX (IMMUN GEGEN LEERZEICHEN & ARRAYS) ---
    // Konvertiert das Feedback sauber in Kleinbuchstaben und entfernt alle Whitespaces.
    // Funktioniert sowohl bei Strings ("yes, no") als auch bei echten Arrays (["yes", "no"])
    const feedback: string[] =
      typeof logObj.data === "string"
        ? logObj.data.split(",").map((v: string) => v.trim().toLowerCase())
        : Array.isArray(logObj.data)
          ? logObj.data.map((v: unknown) => String(v).trim().toLowerCase())
          : [];

    // Ziffern auswerten
    for (let i = 0; i < len; i++) {
      const val = feedback[i];
      // Akzeptiert "yes", "true" oder "1" (falls die dnet-API intern angepasst wurde)
      if (val === "yes" || val === "true" || val === "1") {
        locked[i] = true;
      } else if (!locked[i]) {
        // Nur erhöhen, wenn diese Stelle noch nicht als korrekt eingeloggt gilt
        digits[i] = (digits[i] + 1) % 10;
      }
    }
    await ns.sleep(10);
  }

  // Finaler Login-Versuch mit dem komplett rekonstruierten Passwort
  return (await ns.dnet.authenticate(host, digits.join(""))).success;
}
async function solveDeepGreen(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
): Promise<boolean> {
  const len = details.passwordLength || 3;
  const currentGuess = new Array(len).fill("x");

  for (let pos = len - 1; pos >= 0; pos--) {
    // Fortschritt berechnen (wieviele Stellen von hinten nach vorne gelöst wurden)
    drawProgress(ns, host, len - 1 - pos, len, "DeepGreen");

    const targetCorrectCount = len - pos;

    for (let digit = 0; digit <= 9; digit++) {
      currentGuess[pos] = String(digit);
      const guess = currentGuess.join("");

      const result = await ns.dnet.authenticate(host, guess);
      if (result.success) return true;

      await ns.sleep(100);

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
            } catch (e) {}
          }
        }
        if (logObj) break;
        await ns.sleep(50);
      }

      if (!logObj || !logObj.data) {
        digit--;
        continue;
      }

      const matches = logObj.data.match(/\d+/g);
      if (!matches) continue;

      if (parseInt(matches[0]) === targetCorrectCount) break;
    }
  }
  return (await ns.dnet.authenticate(host, currentGuess.join(""))).success;
}
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
  while (min <= max) {
    if (hint === "Higher") min = guess + 1;
    else if (hint === "Lower") max = guess - 1;

    guess = Math.floor((min + max) / 2);
    const guessStr = guess.toString().padStart(len, "0");

    drawProgress(ns, host, max - (max - min), max, "BinarySearch");

    const result = await ns.dnet.authenticate(host, guessStr);
    if (result.success) return true;

    hint = result.data || "";
    if (!hint) {
      const bleed = await ns.dnet.heartbleed(host);
      const logs = bleed.logs.join(" ");
      if (logs.includes("Higher")) hint = "Higher";
      else if (logs.includes("Lower")) hint = "Lower";
    }
    await ns.sleep(1);
  }
  return false;
}
function updatePasswordFile(ns: NS, newPw: string): void {
  const file = "passwords.txt";
  const pws = new Set<string>();
  if (ns.fileExists(file, "home")) {
    ns.read(file)
      .split(/[\n,]+/)
      .forEach((p) => p.trim() && pws.add(p.trim()));
  }
  if (!pws.has(newPw)) ns.write(file, `\n${newPw}`, "a");
}
async function lootServer(ns: NS): Promise<void> {
  const host = ns.getHostname();
  if (host === "home") return;

  // --- FIX: AWAIT HINZUGEFÜGT ---
  await ns.dnet.phishingAttack();

  // Läuft jetzt erst los, wenn der Phishing-Angriff komplett abgeschlossen ist
  const files = ns.ls(host, ".cache");

  for (const file of files) {
    try {
      const result = ns.dnet.openCache(file) as any;
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
async function solveRoman(ns: NS, host: string, details: ServerAuthDetails) {
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
  return (await ns.dnet.authenticate(host, total.toString())).success;
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
async function solveSniffing(ns: NS, host: string, details: ServerAuthDetails) {
  for (let i = 0; i < 5; i++) {
    const bleed = await ns.dnet.heartbleed(host);
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch && (await ns.dnet.authenticate(host, exactMatch[1])).success)
      return true;

    const allCandidates = bleedStr.match(/\b\w+\b/g) || [];
    for (const candidate of [...new Set(allCandidates)]) {
      if (details.passwordLength && candidate.length !== details.passwordLength)
        continue;
      if ((await ns.dnet.authenticate(host, candidate)).success) return true;
    }
    await ns.sleep(200);
  }
  return false;
}
async function solveDeskMemo(ns: NS, host: string, details: ServerAuthDetails) {
  const hint = details.passwordHint || "";
  const combined = hint.replace(/\D/g, "");
  if (combined && (await ns.dnet.authenticate(host, combined)).success)
    return true;
  for (const seq of hint.match(/\d+/g) || []) {
    if ((await ns.dnet.authenticate(host, seq)).success) return true;
  }
  return false;
}
async function dictionaryAttack(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
) {
  if (!ns.fileExists("passwords.txt", "home")) return false;
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
async function solveDefaults(ns: NS, host: string, details: ServerAuthDetails) {
  for (const pw of [
    "admin",
    "password",
    "root",
    "guest",
    "0000",
    "1234",
    "123456",
  ]) {
    if (details.passwordLength && pw.length > details.passwordLength) continue;
    if ((await ns.dnet.authenticate(host, pw)).success) return true;
  }
  return await dictionaryAttack(ns, host, details);
}
async function solvePr0verFl0(
  ns: NS,
  host: string,
  details: ServerAuthDetails,
) {
  const len = details.passwordLength;
  if (!len) return false;
  return (await ns.dnet.authenticate(host, "A".repeat(len * 2))).success;
}
async function solveSmartNumeric(ns: NS, host: string, len: number) {
  if (!len || len <= 0) return false;
  if (len === 1) return await solveNumericBruteForce(ns, host, len);
  const maxVal = Math.pow(10, len) - 1;
  let min = 0;
  let max = maxVal;
  let guess = Math.floor((min + max) / 2);

  const result = await ns.dnet.authenticate(
    host,
    guess.toString().padStart(len, "0"),
  );
  if (result.success) return true;

  let hint = result.data || "";
  if (!hint) {
    const bleedResult = await ns.dnet.heartbleed(host);
    const logs = bleedResult.logs.join(" ");
    if (logs.includes("Higher")) hint = "Higher";
    else if (logs.includes("Lower")) hint = "Lower";
  }
  if (hint === "Higher" || hint === "Lower")
    return await solveBinarySearch(ns, host, len, min, max, hint, guess);
  return await solveNumericBruteForce(ns, host, len);
}
function getPermutations(str: string): string[] {
  if (str.length <= 1) return [str];
  const perms = new Set<string>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    for (const p of getPermutations(str.slice(0, i) + str.slice(i + 1)))
      perms.add(char + p);
  }
  return Array.from(perms);
}
async function solveAnagram(ns: NS, host: string, details: ServerAuthDetails) {
  if (!details.data) return false;
  for (const guess of getPermutations(details.data)) {
    if ((await ns.dnet.authenticate(host, guess)).success) return true;
  }
  return false;
}
