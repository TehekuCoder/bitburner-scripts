import { CompanyName, FactionName } from "@ns";
import { FactionConfig, NFGFactionWhitelist } from "shared/types/factions";

export const NFG_WHITELIST_CONFIG: NFGFactionWhitelist = {
  hackingGangDefault: "NiteSec" as FactionName,
  combatGangDefault: "Slum Snakes" as FactionName,
  fallbackWhitelist: [
    "CyberSec",
    "Slum Snakes",
    "Tian Di Hui",
    "NiteSec",
    "Netburners",
  ] as FactionName[],
};

export const MEGACORPS: Record<string, CompanyName> = {
  "Fulcrum Technologies": "Fulcrum Technologies" as CompanyName,
  ECorp: "ECorp" as CompanyName,
  MegaCorp: "MegaCorp" as CompanyName,
  "Four Sigma": "Four Sigma" as CompanyName,
  "KuaiGong International": "KuaiGong International" as CompanyName,
  NWO: "NWO" as CompanyName,
  "Blade Industries": "Blade Industries" as CompanyName,
  "OmniTek Incorporated": "OmniTek Incorporated" as CompanyName,
  "Bachman & Associates": "Bachman & Associates" as CompanyName,
  "Clarke Incorporated": "Clarke Incorporated" as CompanyName,
};

export const COMBAT_FACTION_REQUIREMENTS: Partial<Record<FactionName, number>> = {
  "Slum Snakes": 30,
  Tetrads: 75,
  "The Syndicate": 200,
  "The Dark Army": 300,
  "Speakers for the Dead": 300,
  "The Covenant": 850,
  Illuminati: 1200,
};

export const FACTION_ROADMAP: FactionConfig[] = [
  { name: "CyberSec", minStat: 0, priority: 1 },
  { name: "Tian Di Hui", minStat: 0, priority: 2 },
  { name: "Netburners", minStat: 0, priority: 3 },
  { name: "NiteSec", minStat: 0, priority: 4 },
  { name: "The Black Hand", minStat: 0, priority: 5 },
  { name: "BitRunners", minStat: 0, priority: 6 },
  { name: "Slum Snakes", minStat: COMBAT_FACTION_REQUIREMENTS["Slum Snakes"]!, priority: 7 },
  { name: "Tetrads", minStat: COMBAT_FACTION_REQUIREMENTS["Tetrads"]!, priority: 8 },
  { name: "The Syndicate", minStat: COMBAT_FACTION_REQUIREMENTS["The Syndicate"]!, priority: 9 },
  { name: "The Dark Army", minStat: COMBAT_FACTION_REQUIREMENTS["The Dark Army"]!, priority: 10 },
  { name: "Speakers for the Dead", minStat: COMBAT_FACTION_REQUIREMENTS["Speakers for the Dead"]!, priority: 11 },
  { name: "Sector-12", minStat: 0, priority: 12 },
  { name: "Aevum", minStat: 0, priority: 13 },
  { name: "Volhaven", minStat: 0, priority: 14 },
  { name: "Chongqing", minStat: 0, priority: 15 },
  { name: "Ishima", minStat: 0, priority: 16 },
  { name: "New Tokyo", minStat: 0, priority: 17 },
  { name: "Fulcrum Secret Technologies", minStat: 0, priority: 18 },
  { name: "ECorp", minStat: 0, priority: 19 },
  { name: "MegaCorp", minStat: 0, priority: 20 },
  { name: "Four Sigma", minStat: 0, priority: 21 },
  { name: "KuaiGong International", minStat: 0, priority: 22 },
  { name: "NWO", minStat: 0, priority: 23 },
  { name: "Blade Industries", minStat: 0, priority: 24 },
  { name: "OmniTek Incorporated", minStat: 0, priority: 25 },
  { name: "Bachman & Associates", minStat: 0, priority: 26 },
  { name: "Clarke Incorporated", minStat: 0, priority: 27 },
  { name: "Silhouette", minStat: 0, priority: 28 },
  { name: "Daedalus", minStat: 1500, priority: 29 },
  { name: "The Covenant", minStat: COMBAT_FACTION_REQUIREMENTS["The Covenant"]!, priority: 30 },
  { name: "Illuminati", minStat: COMBAT_FACTION_REQUIREMENTS["Illuminati"]!, priority: 31 },
];

export const CITY_FACTIONS: FactionName[] = [
  "Sector-12",
  "Aevum",
  "Chongqing",
  "New Tokyo",
  "Ishima",
  "Volhaven",
] as FactionName[];

export const GANG_CANDIDATE_FACTIONS: FactionName[] = [
  "Slum Snakes",
  "Tetrads",
  "Syndicate",
  "The Dark Army",
  "Speakers for the Dead",
  "NiteSec",
  "The Black Hand",
] as FactionName[];