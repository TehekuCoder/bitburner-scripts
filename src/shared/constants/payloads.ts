import { PATHS } from "/infrastructure/runtime/paths.js";

export const PAYLOADS = {
  hgw: [
    PATHS.services.payloads.hack,
    PATHS.services.payloads.grow,
    PATHS.services.payloads.weaken,
    PATHS.services.payloads.share,
  ],
  darknet: [
    // Daemons & Tasks
    PATHS.services.daemons.crawler,
    PATHS.domain.tasks.dnetSolver,
    PATHS.domain.tasks.loot,
    PATHS.domain.tasks.phish,

    // Utilities & Logging
    PATHS.lib.utils.provision,
    PATHS.infrastructure.logging.loggerClient,
    PATHS.shared.constants.logger,
    PATHS.shared.types.logger,

    // Runtime & Constants
    PATHS.shared.constants.darknet,
    PATHS.shared.constants.payloads,
    PATHS.shared.constants.colors,
    PATHS.infrastructure.runtime.paths,
    PATHS.infrastructure.runtime.system,


    // Alle Solver-Dateien einzeln entpacken!
    ...Object.values(PATHS.domain.solvers),
  ],
} as const;