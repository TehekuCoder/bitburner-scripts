export const PATHS = {
  app: {
    actions: {
      cloud: "app/actions/act-cloud.js",
      corporation: "app/actions/act-corporation.js",
      gang: "app/actions/act-gang.js",
      hacknet: "app/actions/act-hacknet.js",
      singularity: "app/actions/act-singularity.js",
      sleeve: "app/actions/act-sleeve.js",
      stock: "app/actions/act-stock.js",
    },
    engines: {
      prep: "app/engines/engine-prep.js",
      proto: "app/engines/engine-proto.js",
      shotgun: "app/engines/engine-shotgun.js",
      xpGrind: "app/engines/engine-xp-grind.js",
      jitBatcher: "app/engines/sys-jit-batcher.js",
    },
    orchestration: {
      boot: "app/orchestration/boot.js",
      financeCore: "app/orchestration/finance-core.js",
      apocalypse: "app/orchestration/sys-apocalypse.js",
      dispatcher: "app/orchestration/sys-dispatcher.js",
      kernel: "app/orchestration/sys-kernel.js",
      orchestrator: "app/orchestration/sys-orchestrator.js",
    },
  },

  domain: {
    corporation: { helper: "domain/corporation/corporation-helper.js" },
    evaluators: {
      purchase: {
        bladeburner: "domain/evaluators/purchase/bladeburner.js",
        corporation: "domain/evaluators/purchase/corporation.js",
        cloud: "domain/evaluators/purchase/cloud.js",
        gang: "domain/evaluators/purchase/gang.js",
        hacknet: "domain/evaluators/purchase/hacknet.js",
        home: "domain/evaluators/purchase/home.js",
        player: "domain/evaluators/purchase/player.js",
        programs: "domain/evaluators/purchase/programs.js",
        sleeve: "domain/evaluators/purchase/sleeve.js",
        stock: "domain/evaluators/purchase/stock.js",
      },
      strategy: {
        hacking: "domain/evaluators/strategy/hacking-strategy.js",
        system: "domain/evaluators/strategy/system-strategy.js",
        target: "domain/evaluators/strategy/target-selection.js",
      },
    },
    faction: { helper: "domain/faction/faction-helper.js" },
    gang: { utils: "domain/gang/gang-utils.js" },
    hacking: {
      batchCalculator: "domain/hacking/batch-calculator.js",
      deployment: "domain/hacking/deployment.js",
      planner: "domain/hacking/internal-planner.js",
      provision: "domain/hacking/provision.js",
    },
    sleeve: { utils: "domain/sleeve/sleeve-utils.js" },
    solvers: {
      accounts: "domain/solvers/solveAccountsManager.js",
      anagram: "domain/solvers/solveAnagram.js",
      cloudflare: "domain/solvers/solveCloudBlare.js",
      deepGreen: "domain/solvers/solveDeepGreen.js",
      deskMemo: "domain/solvers/solveDeskMemo.js",
      factoriOs: "domain/solvers/solveFactoriOs.js",
      freshInstall: "domain/solvers/solveFreshInstall.js",
      laika4: "domain/solvers/solveLaika4.js",
      manager: "domain/solvers/solveManager.js",
      nil: "domain/solvers/solveNIL.js",
      octantVoxel: "domain/solvers/solveOctantVoxel.js",
      openWebAccessPoint: "domain/solvers/solveOpenWebAccessPoint.js",
      php54: "domain/solvers/solvePHP54.js",
      pr0verFl0: "domain/solvers/solvePr0verFl0.js",
      roman: "domain/solvers/solveRoman.js",
      zeroLogon: "domain/solvers/solveZeroLogon.js",
    },
    strategy: {},
    tasks: {
      analyzeAug: "domain/tasks/analyze-augmentations.js",
      cctSolver: "domain/tasks/cct-solver.js",
      company: "domain/tasks/company.js",
      crime: "domain/tasks/crime.js",
      loot: "domain/tasks/dnet-loot.js",
      phish: "domain/tasks/dnet-phish.js",
      dnetSolver: "domain/tasks/dnet-solver.js",
      faction: "domain/tasks/faction-grind.js",
      train: "domain/tasks/train.js",
      uni: "domain/tasks/uni.js",
    },
  },

  infrastructure: {
    logging: {
      logger: "infrastructure/logging/sys-logger.js",
      loggerClient: "infrastructure/logging/logger-client.js",
    },
    monitoring: {
      dashboard: "infrastructure/monitoring/sys-engine-dashboard.js",
      jitDashboard: "infrastructure/monitoring/sys-jit-batcher-dashboard.js",
    },
    runtime: {
      workerExecutor: "infrastructure/runtime/worker-executor.js",
      paths: "infrastructure/runtime/paths.js",
      system: "infrastructure/runtime/system.js",
    },
  },

  lib: {
    utils: {
      provision: "lib/utils/provision.js",
    },
  },

  services: {
    daemons: {
      backdoor: "services/daemons/backdoor.js",
      crawler: "services/daemons/dnet-crawler.js",
      fillShare: "services/daemons/fill-share.js",
      financeDispatcher: "services/daemons/finance-dispatcher.js",
      hackingOrchestrator: "services/daemons/hacking-orchestrator.js",
      perfMonitor: "services/daemons/perf-monitor.js",
    },
    managers: {
      bladeburner:"services/managers/bladeburner-manager.js",
      corporation: "services/managers/corporation-manager.js",
      dnet: "services/managers/dnet-master.js",
      gang: "services/managers/gang-manager.js",
      hash: "services/managers/hash-manager.js",
      ipvgo: "services/managers/ipvgo-manager.js",
      sleeve: "services/managers/sleeve-manager.js",
    },
    payloads: {
      grow: "services/payloads/grow.js",
      hack: "services/payloads/hack.js",
      share: "services/payloads/share.js",
      weaken: "services/payloads/weaken.js",
      work: "services/payloads/work.js",
    },
  },

  shared: {
    constants: {
      colors: "shared/constants/colors.js",
      corporation: "shared/constants/corporation.js",
      darknet: "shared/constants/darknet.js",
      logger: "shared/constants/logger.js",
      payloads: "shared/constants/payloads.js",
    },
    types: {
      logger: "shared/types/logger.js",
    },
    settings: {
      bnMultipliers: "shared/settings/bn-multipliers.txt"
    }
  },
  ui: {
    corporation: "ui/corporation.js",
    roadmap: "ui/roadmap.js",
    gang: "ui/gang.js",
    sleeve: "ui/sleeve.js",
  },
} as const;
