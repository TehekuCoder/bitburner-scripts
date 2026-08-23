import { CityName } from "@ns";

export const CORP_CONFIG = {
  corpName: "Philip Matrix",

  divisions: {
    agri: {
      name: "GreenPill Organics",
      type: "Agriculture",
    },
    chem: {
      name: "Agent Synthetics",
      type: "Chemical",
    },
    tobacco: {
      name: "RedPill Smokes",
      type: "Tobacco",
    },
  },

  cities: [
    "Aevum",
    "Chongqing",
    "Sector-12",
    "New Tokyo",
    "Ishima",
    "Volhaven",
  ] as const satisfies readonly CityName[],

  mainCity: "Aevum" as const satisfies CityName,

  // Booster-Materialien für Landwirtschaft (Runde 1 Zielwerte)
  agriBoosterR1: {
    Hardware: 125,
    Robots: 0,
    "AI Cores": 75,
    "Real Estate": 27000,
  },

  // Job-Verteilungen (6 Mitarbeiter)
  jobDistribution: {
    support6: {
      Operations: 1,
      Engineer: 2,
      Business: 1,
      Management: 1,
      "Research & Development": 1,
    },
    chem6: {
      Operations: 1,
      Engineer: 3,
      Business: 1,
      Management: 1,
      "Research & Development": 0,
    },
    tobaccoHQ60: {
      Operations: 12,
      Engineer: 12,
      Business: 12,
      Management: 12,
      "Research & Development": 12,
    },
  },
} as const;

export type CorpPhase =
  | "INIT_AGRI"
  | "AGRI_BOOST"
  | "INVESTOR_1"
  | "INIT_CHEM"
  | "EXPORT_LOOP"
  | "INVESTOR_2"
  | "INIT_TOBACCO"
  | "TOBACCO_LOOP";

export const CORP_RESEARCH_PRIORITY = [
  "Hi-Tech R&D Laboratory", // Prerequisite für fast alles
  "Market-TA.I",            // Prerequisite für TA.II
  "Market-TA.II",           // Automatischer Preis-Manager (extrem stark!)
  "uPgrade: Fulcrum",       // Booster + Prerequisite für Capacity.I
  "uPgrade: Capacity.I",    // Erhöht max. Produkte auf 4
  "uPgrade: Capacity.II",   // Erhöht max. Produkte auf 5
  "Self-Correcting Assemblers",
  "AutoBrew",
  "AutoPartyManager",
] as const;
