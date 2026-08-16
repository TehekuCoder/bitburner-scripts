import { PATHS } from "/lib/paths";

export const PAYLOADS = {
  hgw: [
    PATHS.payloads.hack,
    PATHS.payloads.grow,
    PATHS.payloads.weaken,
    PATHS.payloads.share,
  ],
  darknet: [
    PATHS.daemons.crawler,
    PATHS.tasks.dnetSolver,
    PATHS.tasks.loot,
    PATHS.tasks.phish,
  ],
} as const;