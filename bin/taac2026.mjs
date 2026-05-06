#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const commands = {
  scrape: {
    script: "scripts/scrape-taiji.mjs",
    description: "Scrape Taiji jobs, metrics, logs, checkpoints, and code files.",
  },
  "diff-config": {
    script: "scripts/compare-config-yaml.mjs",
    description: "Compare two YAML config files semantically.",
  },
  "prepare-submit": {
    script: "scripts/prepare-taiji-submit.mjs",
    description: "Prepare a local Taiji submit bundle.",
  },
  submit: {
    script: "scripts/submit-taiji.mjs",
    description: "Dry-run or execute upload/create/run; also supports doctor and verify helpers.",
  },
  compare: {
    script: "scripts/experiment-tools.mjs",
    description: "Compare Jobs as evidence bundles without making experiment decisions.",
  },
  "compare-runs": {
    script: "scripts/experiment-tools.mjs",
    description: "Compare one base Job and one experiment Job.",
  },
  logs: {
    script: "scripts/experiment-tools.mjs",
    description: "Extract errors and tail lines from scraped Taiji Job logs.",
  },
  "ckpt-select": {
    script: "scripts/experiment-tools.mjs",
    description: "Select checkpoint candidates by explicit metric rules.",
  },
  "ckpt-publish": {
    script: "scripts/experiment-tools.mjs",
    description: "Publish a cached training checkpoint as a Taiji model.",
  },
  model: {
    script: "scripts/evaluation-tools.mjs",
    description: "List Taiji published models.",
  },
  eval: {
    script: "scripts/evaluation-tools.mjs",
    description: "Create, list, or stop Taiji evaluation tasks.",
  },
  evaluation: {
    script: "scripts/evaluation-tools.mjs",
    description: "Alias for eval.",
  },
  config: {
    script: "scripts/experiment-tools.mjs",
    description: "Compare config.yaml against an explicit Job reference.",
  },
  ledger: {
    script: "scripts/experiment-tools.mjs",
    description: "Sync a structured experiment ledger from scraped Taiji outputs.",
  },
  diagnose: {
    script: "scripts/experiment-tools.mjs",
    description: "Extract failure evidence from a scraped Taiji Job.",
  },
};

const submitHelperActions = new Set(["doctor", "verify"]);

function usage() {
  return `TAAC2026 CLI

Usage:
  taac2026 <command> [options]

Commands:
${Object.entries(commands).map(([name, command]) => `  ${name.padEnd(15)} ${command.description}`).join("\n")}

Examples:
  taac2026 scrape --all --incremental --direct --cookie-file taiji-output/secrets/taiji-cookie.txt
  taac2026 diff-config old.yaml new.yaml --json --out diff.json
  taac2026 prepare-submit --template-job-url <url> --file-dir ./taiji-files --name exp_001
  taac2026 submit --bundle taiji-output/submit-bundle --template-job-internal-id <id>
  taac2026 submit doctor --bundle taiji-output/submit-bundle
  taac2026 compare jobs 56242 58244
  taac2026 compare-runs --base 58244 --exp 56242
  taac2026 ckpt-select --job 56242 --by valid_auc
  taac2026 ckpt-publish --job 56242 --ckpt <ckpt-name>
  taac2026 eval create --model-id 29132 --submit-name <local-submit-name> --creator <ams_id>

Run 'taac2026 <command> --help' for command-specific options.`;
}

function run() {
  const [commandName, ...args] = process.argv.slice(2);
  if (!commandName || commandName === "--help" || commandName === "-h") {
    console.log(usage());
    return;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const routedArgs =
    commandName === "submit" && submitHelperActions.has(args[0])
      ? ["submit", ...args]
      : ["compare", "compare-runs", "logs", "ckpt-select", "ckpt-publish", "model", "eval", "evaluation", "config", "ledger", "diagnose"].includes(commandName)
        ? [commandName, ...args]
        : args;

  const routedScript =
    commandName === "submit" && submitHelperActions.has(args[0])
      ? "scripts/experiment-tools.mjs"
      : command.script;

  const child = spawn(process.execPath, [path.join(rootDir, routedScript), ...routedArgs], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

run();
