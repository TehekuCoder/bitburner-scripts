import {
  NS,
  Player,
  FactionName,
  CityName,
  ProgramName,
  FactionWorkType,
  GymType,
  CompanyName,
  JobField,
  CrimeType,
} from "@ns";

// --- TYPEN & INTERFACES ---
type GymLocationName = "Powerhouse Gym" | "Iron Gym" | "Millenium Fitness Gym";
type GymStat = "strength" | "defense" | "dexterity" | "agility";
type AugmentName = string;

interface AugmentItem {
  faction: FactionName;
  name: AugmentName;
  price: number;
}

interface TargetFaction {
  name: FactionName;
  minStat: number;
}

interface BotState {
  strategy: string;
  faction: FactionName | null;
  targetStat: number;
  progressBar: string;
}

const STAT_MAP: Record<string, string> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

const MEGACORPS: Record<string, CompanyName> = {
  ECorp: "ECorp",
  MegaCorp: "MegaCorp",
  "KuaiGong International": "KuaiGong International",
  "Four Sigma": "Four Sigma",
  NWO: "NWO",
  "Blade Industries": "Blade Industries",
  "OmniTek Incorporated": "OmniTek Incorporated",
  "Bachman & Associates": "Bachman & Associates",
  "Clarke Incorporated": "Clarke Incorporated",
  "Fulcrum Secret Technologies": "Fulcrum Technologies",
};

export async function main(ns: NS): Promise<void> {
  const sing = ns.singularity;
  ns.disableLog("ALL");

  const COMBAT_STATS: GymStat[] = [
    "strength",
    "defense",
    "dexterity",
    "agility",
  ];
  const MILESTONES = [0, 100, 200, 300, 850, 1200, 1500];

  const HACKING_FACTIONS: TargetFaction[] = [
    { name: "CyberSec" as FactionName, minStat: 0 },
    { name: "Tian Di Hui" as FactionName, minStat: 0 },
    { name: "Slum Snakes" as FactionName, minStat: 30 },
    { name: "Ishima" as FactionName, minStat: 0 },
    { name: "Tetrads" as FactionName, minStat: 75 },
    { name: "Netburners" as FactionName, minStat: 0 },
    { name: "Sector-12" as FactionName, minStat: 0 },
    { name: "New Tokyo" as FactionName, minStat: 0 },
    { name: "Volhaven" as FactionName, minStat: 0 },
    { name: "Chongqing" as FactionName, minStat: 0 },
    { name: "Aevum" as FactionName, minStat: 0 },
    { name: "NiteSec" as FactionName, minStat: 0 },
    { name: "The Black Hand" as FactionName, minStat: 0 },
    { name: "The Dark Army" as FactionName, minStat: 300 },
    { name: "The Syndicate" as FactionName, minStat: 200 },
    { name: "Speakers for the Dead" as FactionName, minStat: 300 },
    { name: "BitRunners" as FactionName, minStat: 0 },
    { name: "ECorp" as FactionName, minStat: 0 },
    { name: "MegaCorp" as FactionName, minStat: 0 },
    { name: "KuaiGong International" as FactionName, minStat: 0 },
    { name: "Four Sigma" as FactionName, minStat: 0 },
    { name: "NWO" as FactionName, minStat: 0 },
    { name: "BitRunners" as FactionName, minStat: 0 },
    { name: "Blade Industries" as FactionName, minStat: 0 },
    { name: "OmniTek Incorporated" as FactionName, minStat: 0 },
    { name: "Bachman & Associates" as FactionName, minStat: 0 },
    { name: "Clarke Incorporated" as FactionName, minStat: 0 },
    { name: "Fulcrum Secret Technologies" as FactionName, minStat: 0 },
    { name: "Silhouette" as FactionName, minStat: 0 },
    { name: "BitRunners" as FactionName, minStat: 0 },
    { name: "The Covenant" as FactionName, minStat: 850 },
    { name: "Illuminati" as FactionName, minStat: 1200 },
    { name: "Daedalus" as FactionName, minStat: 1500 },
  ];

  while (true) {
    const p: Player = ns.getPlayer();
    const work = sing.getCurrentWork();

    // 1. Bestimme den aktuell ERREICHTEN Meilenstein
    let reachedM = 0;
    for (const m of MILESTONES) {
      if (COMBAT_STATS.every((s) => p.skills[s] >= m)) reachedM = m;
      else break;
    }

    // 2. Prüfen, ob wir für diesen Level oder darunter noch Ruf brauchen
    const factionToWorkFor = findNextFaction(ns, HACKING_FACTIONS, p, reachedM);

    let mode = "MONEY";
    let targetStat = reachedM;
    let targetCompany: string | null = null;

    if (factionToWorkFor) {
      // Wir haben den Stat-Level, aber brauchen noch Ruf bei einer offenen Fraktion
      mode = "REP";
    } else {
      // Herausfinden, welche Fraktion für diesen Meilenstein noch komplett fehlt
      const missingFaction = HACKING_FACTIONS.find(
        (f) =>
          f.minStat <= reachedM &&
          !p.factions.includes(f.name) &&
          getHighestRepNeeded(ns, f.name) > 0,
      );

      if (missingFaction) {
        // Wir holen den Firmennamen. Da missingFaction.name ein FactionName (Typ string) ist,
        // akzeptiert der Record das problemlos als Key.
        const companyName = MEGACORPS[missingFaction.name];

        // 400.000 ist das Hardcap, um die Fraktionen freizuschalten
        if (companyName && sing.getCompanyRep(companyName) < 400_000) {
          mode = "COMPANY";
          targetCompany = companyName; // Passt perfekt, da beide nun CompanyName sind
        } else {
          mode = "MONEY"; // Wir warten auf den Invite oder brauchen Geld -> Verbrechen
        }
      } else {
        // Erst wenn WIRKLICH alle Fraktionen bis zu diesem Meilenstein leergekauft sind, trainieren wir weiter
        const nextM = MILESTONES.find((m) => m > reachedM);
        if (nextM) {
          mode = "TRAIN";
          targetStat = nextM;
        }
      }
    }

    // State für Overlord schreiben
    const state: BotState = {
      strategy: mode,
      faction: factionToWorkFor,
      targetStat: targetStat,
      progressBar:
        mode === "COMPANY" && targetCompany
          ? `Corp: ${targetCompany}`
          : factionToWorkFor
            ? createBar(ns, factionToWorkFor, HACKING_FACTIONS)
            : `Stats: ${reachedM}/${targetStat}`,
    };
    ns.write("bitos_state.txt", JSON.stringify(state), "w");
    // LOGIK AUSFÜHREN
    const useFocus = !sing
      .getOwnedAugmentations(false)
      .includes("Neuroreceptor Management Implant");

    if (mode === "TRAIN") {
      const lowStat = COMBAT_STATS.find((s) => p.skills[s] < targetStat);
      if (lowStat) {
        if (p.city !== "Sector-12") sing.travelToCity("Sector-12" as CityName);
        const shortStat = STAT_MAP[lowStat] as GymType;
        if (!isWorkingOn(work, "CLASS", lowStat)) {
          sing.gymWorkout(
            "Powerhouse Gym" as GymLocationName,
            shortStat,
            useFocus,
          );
        }
      }
    } else if (mode === "REP" && factionToWorkFor) {
      if (!isWorkingOn(work, "FACTION", null, factionToWorkFor)) {
        if (
          !sing.workForFaction(
            factionToWorkFor,
            "hacking" as FactionWorkType,
            useFocus,
          )
        ) {
          sing.workForFaction(
            factionToWorkFor,
            "field" as FactionWorkType,
            useFocus,
          );
        }
      }
    } else if (mode === "COMPANY" && targetCompany) {
      // Felder als JobField-Array definieren, damit TypeScript Bescheid weiß
      const fields: JobField[] = [
        "Software" as JobField,
        "IT" as JobField,
        "Business" as JobField,
        "Security" as JobField,
      ];

      // Sicheren Type-Cast für das Unternehmen vorbereiten
      const compName = targetCompany as CompanyName;

      for (const field of fields) {
        sing.applyToCompany(compName, field);
      }

      // Wenn wir noch nicht für die Firma arbeiten, starten wir die Arbeit
      if (!isWorkingOn(work, "COMPANY", null, null, targetCompany)) {
        sing.workForCompany(compName, useFocus);
      }
    } else {
      // 1. Fallback: Standardmäßig Homicide, Typ ist strikt CrimeType
      let bestCrime: CrimeType = ns.enums.CrimeType.homicide;

      if (ns.fileExists("Formulas.exe", "home")) {
        let maxMoneyPerSecond = 0;

        // TypeScript weiß bei Object.values nur, dass es Strings sind.
        // Wir müssen sie explizit als CrimeType[] casten.
        const crimes = Object.values(ns.enums.CrimeType) as CrimeType[];

        for (const crime of crimes) {
          // FIX 1: Basisdaten kommen direkt aus Singularity, nicht aus Formulas
          const crimeStats = sing.getCrimeStats(crime);

          // FIX 2: Erfolgschance liegt im work-Zweig der Formulas API
          const chance = ns.formulas.work.crimeSuccessChance(p, crime);

          const durationSeconds = crimeStats.time / 1000;
          const expectedMoney = crimeStats.money * chance;
          const moneyPerSecond = expectedMoney / durationSeconds;

          if (moneyPerSecond > maxMoneyPerSecond) {
            maxMoneyPerSecond = moneyPerSecond;
            bestCrime = crime;
          }
        }
      }

      // 2. Führe das lukrativste Verbrechen aus
      // Da bestCrime jetzt garantiert vom Typ CrimeType ist, meckert TypeScript nicht mehr.
      const currentCrime = work?.type === "CRIME" ? work.crimeType : "";

      if (currentCrime !== bestCrime) {
        sing.commitCrime(bestCrime);
      }
    }

    // MANAGER-AUFRUFE
    handleHomeServerPurchases(ns);
    autoAcceptFactions(ns, HACKING_FACTIONS);
    autoBuyAugmentations(ns, p);
    handlePurchases(ns, p);
    handleServerPurchases(ns);

    await ns.sleep(2000);
  }
}

// --- HELPER ---

function findNextFaction(
  ns: NS,
  list: TargetFaction[],
  p: Player,
  reachedM: number,
): FactionName | null {
  const sing = ns.singularity;

  for (const f of list) {
    if (p.factions.includes(f.name) && f.minStat <= reachedM) {
      const highestRepNeeded = getHighestRepNeeded(ns, f.name);

      if (
        highestRepNeeded > 0 &&
        sing.getFactionRep(f.name) < highestRepNeeded
      ) {
        return f.name;
      }
    }
  }
  return null;
}

function createBar(ns: NS, fName: FactionName, list: TargetFaction[]): string {
  const f = list.find((x) => x.name === fName);
  if (!f) return "N/A";

  const curr = ns.singularity.getFactionRep(fName);
  const targetRep = getHighestRepNeeded(ns, fName);

  if (targetRep === 0) return `[██████████] 100.0%`;

  const size = 10;
  const percent = Math.min(1, curr / targetRep);
  const progress = Math.floor(size * percent);

  return `[${"█".repeat(progress)}${"░".repeat(size - progress)}] ${(percent * 100).toFixed(1)}%`;
}

function isWorkingOn(
  work: any,
  type: string,
  stat: string | null = null,
  faction: string | null = null,
  company: string | null = null,
): boolean {
  if (!work) return false;
  if (work.type !== type) return false;
  if (stat && work.classType !== stat) return false;
  if (faction && work.factionName !== faction) return false;
  // Neues Feld für Firmenarbeit:
  if (company && work.companyName !== company) return false;
  return true;
}
function autoAcceptFactions(ns: NS, list: TargetFaction[]): void {
  const sing = ns.singularity;
  const invites = sing.checkFactionInvitations();
  const ownedAugs = sing.getOwnedAugmentations(true);

  for (const inv of invites) {
    const factionName = inv as FactionName;

    if (!list.some((f) => f.name === factionName)) continue;

    const fAugs = sing.getAugmentationsFromFaction(factionName);
    const needsAugs = fAugs.some(
      (aug) => !ownedAugs.includes(aug) && aug !== "NeuroFlux Governor",
    );

    if (needsAugs) {
      sing.joinFaction(factionName);
      ns.print(`[FACTION] Beigetreten: ${factionName}`);
    }
  }
}

function handlePurchases(ns: NS, p: Player): void {
  const sing = ns.singularity;
  if (!ns.hasTorRouter() && p.money >= 200000) sing.purchaseTor();
  if (ns.hasTorRouter()) {
    const programs: ProgramName[] = [
      "BruteSSH.exe" as ProgramName,
      "FTPCrack.exe" as ProgramName,
      "relaySMTP.exe" as ProgramName,
      "DarkscapeNavigator.exe" as ProgramName,
      "HTTPWorm.exe" as ProgramName,
      "SQLInject.exe" as ProgramName,
      "Formulas.exe" as ProgramName,
    ];
    for (const prog of programs)
      if (!ns.fileExists(prog, "home")) sing.purchaseProgram(prog);
  }
}

function autoBuyAugmentations(ns: NS, p: Player): void {
  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true);
  const augMap = new Map<string, AugmentItem>();

  for (const f of p.factions) {
    const faction = f as FactionName;
    for (const aug of sing.getAugmentationsFromFaction(faction)) {
      if (aug === "NeuroFlux Governor" || ownedAugs.includes(aug)) continue;
      if (sing.getFactionRep(faction) >= sing.getAugmentationRepReq(aug)) {
        augMap.set(aug, {
          faction,
          name: aug,
          price: sing.getAugmentationPrice(aug),
        });
      }
    }
  }

  const purchasable = Array.from(augMap.values()).sort(
    (a, b) => b.price - a.price,
  );

  for (const item of purchasable) {
    // Fix: Preis live abfragen, da er sich nach jedem Kauf inflationär erhöht!
    const currentPrice = sing.getAugmentationPrice(item.name);
    if (ns.getPlayer().money >= currentPrice) {
      sing.purchaseAugmentation(item.faction, item.name);
    }
  }
}

function getHighestRepNeeded(ns: NS, fName: FactionName): number {
  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true);
  const fAugs = sing.getAugmentationsFromFaction(fName);

  let highest = 0;
  for (const aug of fAugs) {
    if (!ownedAugs.includes(aug) && aug !== "NeuroFlux Governor") {
      const req = sing.getAugmentationRepReq(aug);
      if (req > highest) highest = req;
    }
  }
  return highest;
}

function handleServerPurchases(ns: NS): void {
  const maxServers = ns.cloud.getServerLimit();
  const currentServers = ns.cloud.getServerNames();
  const maxRam = ns.cloud.getRamLimit();
  const money = ns.getPlayer().money;

  if (money < 50000) return;

  // Szenario A: Neuen Server kaufen
  if (currentServers.length < maxServers) {
    let targetRam = 8;
    while (
      targetRam * 2 <= maxRam &&
      ns.cloud.getServerCost(targetRam * 2) <= money
    ) {
      targetRam *= 2;
    }

    const cost = ns.cloud.getServerCost(targetRam);
    if (money >= cost) {
      // Fix: Name generiert auf Basis eines Timestamps oder eindeutigen IDs, um Kollisionen zu vermeiden
      const name = `p-serv-${Date.now()}`;
      ns.cloud.purchaseServer(name, targetRam);
      ns.print(`[SERVER] Neuer Server gekauft: ${name} (${targetRam} GB RAM)`);
    }
  }
  // Szenario B: Bestehende Server upgraden
  else {
    let minRam = maxRam;
    let worstServer = "";

    for (const server of currentServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
    }

    if (worstServer !== "") {
      const nextRam = minRam * 2;
      const upgradeCost =
        ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

      if (money >= upgradeCost) {
        ns.cloud.upgradeServer(worstServer, nextRam);
        ns.print(`[SERVER] ${worstServer} auf ${nextRam} GB RAM erweitert.`);
      }
    }
  }
}
function handleHomeServerPurchases(ns: NS, reserveMoney: number = 200_000): void {
  const sing = ns.singularity;
  
  // 1. Live-Geld holen (verhindert den Snapshot-Fehler)
  let availableMoney = ns.getPlayer().money - reserveMoney;
  if (availableMoney <= 0) return;

  // 2. PRIORITÄT 1: RAM Upgrade
  const ramCost = sing.getUpgradeHomeRamCost();
  if (availableMoney >= ramCost) {
    if (sing.upgradeHomeRam()) {
      ns.print(`[SYSTEM] Home-RAM erfolgreich erweitert! Cost: ${ns.format.number(ramCost)}`);
      availableMoney -= ramCost; // Geld-Tracker für den nächsten Schritt aktualisieren
    }
  }

  // 3. PRIORITÄT 2: Cores Upgrade (nur wenn danach noch Geld da ist)
  const coreCost = sing.getUpgradeHomeCoresCost();
  if (availableMoney >= coreCost) {
    if (sing.upgradeHomeCores()) {
      ns.print(`[SYSTEM] Home-Cores erfolgreich erhöht! Cost: ${ns.format.number(coreCost)}`);
    }
  }
}
