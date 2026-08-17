import { PATHS } from "/infrastructure/runtime/paths.js";

export const PAYLOADS = {
  hgw: [
    PATHS.services.payloads.hack,
    PATHS.services.payloads.grow,
    PATHS.services.payloads.weaken,
    PATHS.services.payloads.share,
  ],
  darknet: [
    PATHS.services.daemons.crawler,
    PATHS.domain.tasks.dnetSolver,
    PATHS.domain.tasks.loot,
    PATHS.domain.tasks.phish,
  ],
} as const;