export const PATHS = {
  app: {
    orchestration: {
      boot: "app/orchestration/boot.js",
      dispatcher: "app/orchestration/sys-dispatcher.js",
      kernel: "app/orchestration/sys-kernel.js",
      orchestrator: "app/orchestration/sys-orchestrator.js",
      apocalypse: "app/orchestration/sys-apocalypse.js",
      financeCore: "app/orchestration/finance-core.js",
    },
    actions: {
      cloud: "app/actions/act-cloud.js",
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
  },

  domain: {
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
    evaluators: {
      purchase: {
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
      dnet: "services/managers/dnet-master.js",
      gang: "services/managers/gang-manager.js",
      hash: "services/managers/hash-manager.js",
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

  infrastructure: {
    logging: {
      logger: "infrastructure/logging/sys-logger.js",
    },
    monitoring: {
      dashboard: "infrastructure/monitoring/sys-engine-dashboard.js",
      jitDashboard: "infrastructure/monitoring/sys-jit-batcher-dashboard.js",
    },
    runtime: {
      workerExecutor: "infrastructure/runtime/worker-executor.js",
    },
  },

  ui: {
    roadmap: "ui/roadmap.js",
    gang: "ui/gang.js",
    sleeve: "ui/sleeve.js",
  },
} as const;
