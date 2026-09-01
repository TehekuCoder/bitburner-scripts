import { BladeburnerSkillPriority } from "/shared/types/bladeburner.js";

export const BLADEBURNER_SKILL_PRIORITIES: BladeburnerSkillPriority[] = [
  // 1. Trefferchancen & Kern-Erfolg
  { name: "Blade's Intuition", weight: 100 },       // Allgemeine Erfolgschance
  { name: "Digital Observer", weight: 95 },         // Erfolgschance für Operationen

  // 2. Progression & Geschwindigkeit
  { name: "Hyperdrive", weight: 90 },               // Erhöht Rank- & XP-Gewinn pro Aktion
  { name: "Overclock", weight: 85, maxLevel: 90 },   // Reduziert Aktionsdauer (Max Level 90)

  // 3. Kampf-Performance für schwere Aktionen & BlackOps
  { name: "Reaper", weight: 80 },                   // Erhöht Combat Stats
  { name: "Evasive System", weight: 80 },           // Erhöht Defense / Dodge

  // 4. Spezialisierte Aufklärung & Effizienz
  { name: "Datamancer", weight: 60 },               // Präzisere Schätzung der Erfolgschancen
  { name: "Short-Circuit", weight: 50 },            // Schaden/Effizienz gegen Synthetics
  { name: "Cloak", weight: 40 },                    // Stealth & Infiltration Booster

  // 5. Nischen- & Low-Priority Skills
  { name: "Tracer", weight: 30 },                   // Nur für Tracking-Verträge
  { name: "Cyber's Edge", weight: 20 },             // Max HP
  { name: "Hands of Midas", weight: 10 },           // Geld-Ertrag (in Bladeburner vernachlässigbar)
];