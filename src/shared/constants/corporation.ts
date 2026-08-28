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

  officeSizes: {
    phase1: 6,
    phase2: 9,
  },

  warehouseLevels: {
    agriR1: 3,
    chemR1: 3,
    agriR2: 5,
    chemR2: 4,
  },

  // Job-Verteilungen
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
    support9: {
      Operations: 2,
      Engineer: 2,
      Business: 2,
      Management: 2,
      "Research & Development": 1,
    },
    chem9: {
      Operations: 2,
      Engineer: 3,
      Business: 2,
      Management: 2,
      "Research & Development": 0,
    },
    spike9: {
      Operations: 4,
      Business: 5,
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
  "Hi-Tech R&D Laboratory",
  "Market-TA.I",
  "Market-TA.II",
  "uPgrade: Fulcrum",
  "uPgrade: Capacity.I",
  "uPgrade: Capacity.II",
  "Self-Correcting Assemblers",
  "AutoBrew",
  "AutoPartyManager",
] as const;

export const MATERIAL_VOLUMES = {
  Hardware: 0.06,
  Robots: 0.5,
  "AI Cores": 0.1,
  "Real Estate": 0.005,
} as const;

export const AGRI_BOOST_RATIOS = {
  R1: { "Real Estate": 0.75, Hardware: 0.125, "AI Cores": 0.125, Robots: 0 },
  R2: { "Real Estate": 0.65, Hardware: 0.1, "AI Cores": 0.15, Robots: 0.1 },
} as const;

export const CHEM_BOOST_RATIOS = {
  R2: {
    Hardware: 0.25,
    "AI Cores": 0.3,
    "Real Estate": 0.25,
    Robots: 0.2,
  },
} as const;
