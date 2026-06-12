#!/usr/bin/env node
// ============================================================
// run.ts — ResumeWright CLI 入口
//
// 用法:
//   npx ts-node --esm run.ts run [file] [options]
//   npx ts-node --esm run.ts status
//   npx ts-node --esm run.ts reset [file | --all]
// ============================================================

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Scheduler } from './src/engine/scheduler.js';
import { WorkflowRunner } from './src/engine/workflow-runner.js';
import { listCheckpoints, Checkpoint, resetCaseRuntime, resetAllRuntimes, getSafeCaseName } from './src/engine/checkpoint.js';
import { loadCase } from './src/adapters/yaml-loader.js';
import { formatDuration } from './src/engine/workflow-runner.js';

const require = createRequire(import.meta.url);
const { version } = require('./package.json') as { version: string };

const program = new Command();

program
  .name('resumewright')
  .description('Resumable Playwright execution framework for multi-role workflow automation')
  .version(version);

// ── run 命令 ─────────────────────────────────────────────────

program
  .command('run [files...]')
  .description('Run one or more Case YAML files (or all cases in cases/ directory)')
  .option('-c, --concurrency <n>', 'Max parallel cases', '5')
  .option('--headed', 'Show browser window (debug mode)')
  .option('--only-failed', 'Only run cases with existing checkpoints (resume failed)')
  .option('--no-screenshot', 'Disable auto screenshot on failure')
  .option('--screenshot-on-assert', 'Take screenshot after assert_exists successfully executes')
  .option('--cases-dir <dir>', 'Cases directory', 'cases')
  .option('--trace', 'Enable Playwright action tracing (saves to .resumewright/traces/)')
  .option('--api-cache', 'Enable API response caching for non-idempotent requests (default: true)')
  .option('--no-api-cache', 'Disable API response caching')
  .option('--cache-get', 'Also cache GET requests (default: true)')
  .option('--no-cache-get', 'Disable caching of GET requests')
  .action(async (files: string[], opts) => {
    const headless = !opts.headed;
    const screenshotOnFail = opts.screenshot !== false;
    const screenshotOnAssert = !!opts.screenshotOnAssert;
    const onlyFailed = !!opts.onlyFailed;
    const concurrency = parseInt(opts.concurrency, 10);
    const casesDir = opts.casesDir;
    const enableTrace = !!opts.trace;
    const apiCache = !!opts.apiCache;
    const cacheGet = opts.cacheGet !== false;

    // 设置 headed 环境变量（playwright.config.ts 会读取）
    if (opts.headed) process.env['HEADED'] = 'true';

    if (files && files.length === 1) {
      // ── 单文件模式 ──
      const filePath = path.resolve(files[0]!);
      try {
        const definition = loadCase(filePath);
        const runner = new WorkflowRunner(definition, filePath, {
          headless,
          screenshotOnFail,
          screenshotOnAssert,
          enableTrace,
          apiCache,
          cacheGet,
        });
        const result = await runner.run();
        process.exit(result.status === 'passed' ? 0 : 1);
      } catch (err) {
        console.error(`[run] Error: ${String(err)}`);
        process.exit(1);
      }
    } else {
      // ── 批量 / 目录模式 ──
      const scheduler = new Scheduler(casesDir, {
        concurrency,
        headless,
        screenshotOnFail,
        screenshotOnAssert,
        onlyFailed,
        enableTrace,
        apiCache,
        cacheGet,
        filter: files && files.length > 1 ? files : undefined,
      });
      const { exitCode } = await scheduler.runAll(
        files && files.length > 1 ? files : undefined
      );
      process.exit(exitCode);
    }
  });

// ── status 命令 ───────────────────────────────────────────────

program
  .command('status')
  .description('Show execution status of all cases')
  .action(() => {
    const checkpoints = listCheckpoints();

    if (checkpoints.length === 0) {
      console.log('[status] No checkpoints found. Run some cases first.');
      return;
    }

    console.log(`\n${'═'.repeat(62)}`);
    console.log('  ResumeWright — Case Status');
    console.log(`${'═'.repeat(62)}`);
    console.log('');

    for (const cp of checkpoints) {
      const lastUpdated = new Date(cp.lastUpdated).toLocaleString();
      const completedSteps = cp.completedSteps.join(', ') || '(none)';
      const contextKeys = Object.keys(cp.context).join(', ') || '(none)';

      console.log(`  📋 ${cp.caseName}`);
      console.log(`     Last updated:     ${lastUpdated}`);
      console.log(`     Completed steps:  ${completedSteps}`);
      console.log(`     Context vars:     ${contextKeys}`);
      console.log('');
    }

    console.log(`${'═'.repeat(62)}\n`);
  });

// ── reset 命令 ────────────────────────────────────────────────

program
  .command('reset [file]')
  .description('Clear checkpoint and runtime directories for a specific case or all cases')
  .option('--all', 'Reset all checkpoints and runtime directories')
  .action((file: string | undefined, opts) => {
    if (opts.all) {
      // 清空所有的运行状态（包含子步骤状态、API 缓存、截图、录像等），但保留 history 目录以确保运行历史不丢失
      resetAllRuntimes();
      console.log('[reset] All checkpoints and runtime directories cleared (history preserved).');
      return;
    }

    if (!file) {
      console.error('[reset] Please specify a case file or use --all');
      process.exit(1);
    }

    try {
      const filePath = path.resolve(file);
      const definition = loadCase(filePath);

      // 清理该 case 的运行状态，但保留 history 目录以确保运行历史不丢失
      const safeCaseName = getSafeCaseName(definition.name, filePath);
      const caseDir = path.join(process.cwd(), '.resumewright', safeCaseName);
      resetCaseRuntime(caseDir);

      console.log(`[reset] Checkpoint and runtime directory cleared (history preserved) for: ${definition.name}`);
    } catch (err) {
      console.error(`[reset] Error: ${String(err)}`);
      process.exit(1);
    }
  });

// ── validate 命令 ──────────────────────────────────────────────

program
  .command('validate [files...]')
  .description('Validate YAML case files without running them')
  .option('--cases-dir <dir>', 'Cases directory', 'cases')
  .action(async (files: string[], opts) => {
    const { loadAllCases } = await import('./src/adapters/yaml-loader.js');

    let cases: string[] = files;
    if (!cases || cases.length === 0) {
      const { default: fg } = await import('fast-glob');
      cases = await fg(path.join(opts.casesDir, '**/*.yaml'));
    }

    let ok = 0;
    let errors = 0;

    for (const f of cases) {
      try {
        loadCase(f);
        console.log(`  ✅ ${f}`);
        ok++;
      } catch (err) {
        console.error(`  ❌ ${f}: ${String(err)}`);
        errors++;
      }
    }

    console.log(`\nValidation complete: ${ok} valid, ${errors} invalid`);
    process.exit(errors > 0 ? 1 : 0);
  });

// ── list 命令 ─────────────────────────────────────────────────

program
  .command('list')
  .description('List all available cases')
  .option('--cases-dir <dir>', 'Cases directory', 'cases')
  .action(async (opts) => {
    const { loadAllCases } = await import('./src/adapters/yaml-loader.js');
    const cases = await loadAllCases(opts.casesDir);

    if (cases.length === 0) {
      console.log(`[list] No cases found in ${opts.casesDir}/`);
      return;
    }

    console.log(`\nAvailable cases (${cases.length}):\n`);
    for (const { filePath, definition } of cases) {
      console.log(`  📄 ${definition.name}`);
      console.log(`     File:    ${filePath}`);
      console.log(`     Steps:   ${definition.steps.length}`);
      console.log(`     Roles:   ${Object.keys(definition.roles).join(', ')}`);
      if (definition.description) {
        console.log(`     Desc:    ${definition.description}`);
      }
      console.log('');
    }
  });

// ── dashboard 命令 ─────────────────────────────────────────────

program
  .command('dashboard')
  .description('Start the Web Dashboard to monitor and control execution')
  .option('-p, --port <port>', 'Port to run the dashboard on', '3000')
  .action(async (opts) => {
    const { startDashboardServer } = await import('./src/dashboard/server.js');
    await startDashboardServer(parseInt(opts.port, 10));
  });

program.parse(process.argv);
