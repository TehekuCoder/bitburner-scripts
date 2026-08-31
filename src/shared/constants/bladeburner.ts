// shared/constants/bladeburner.ts
import { BladeburnerSkillPriority } from "/shared/types/bladeburner.js";

export const BLADEBURNER_SKILL_PRIORITIES: BladeburnerSkillPriority[] = [
  { name: "Blade's Intuition", weight: 100 },       // Erfolgschancen aller Aktionen
  { name: "Digital Observer", weight: 90 },        // Erfolgschancen von Operationen
  { name: "Overclock", weight: 85, maxLevel: 90 },  // Reduziert Aktionsdauer (Max Level 90)
  { name: "Reaper", weight: 80 },                   // Erhöht Combat Stats
  { name: "Evasive System", weight: 80 },           // Erhöht Defense/Dodge
  { name: "Cloak", weight: 70 },                    // Erhöht Erfolgschancen bei Stealth/Infiltration
  { name: "Short-Circuit", weight: 60 },           // Hilft gegen synthetische Zielen
  { name: "Hands of Midas", weight: 50 },          // Mehr Geld aus Verträgen
  { name: "Hyperdrive", weight: 40 },              // Erhöht Stat-Gewinn
  { name: "Tracer", weight: 35 },                   // Erhöht Erfolgschancen bei Tracking
  { name: "Datamancer", weight: 30 },               // Erhöht Synthetik-Analyse
  { name: "Cyber's Edge", weight: 25 },             // Erhöht Max HP
];