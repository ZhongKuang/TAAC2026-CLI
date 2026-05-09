#!/usr/bin/env node
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_OUT_ROOT = "outputs/taiji-output/submit";
const PRIMARY_TRAIN_FILE_NAMES = new Set(["code.zip", "config.yaml", "run.sh"]);

function usage() {
  return `Usage:
  taac2026 prepare-submit --template-job-url <url> --zip <code.zip> --config <config.yaml> --name <job-name> [options]
  node scripts/prepare-taiji-submit.mjs --template-job-url <url> --zip <code.zip> --config <config.yaml> --name <job-name> [options]

Options:
  --description <text>   Job Description to use on Taiji.
  --run-sh <run.sh>      Optional replacement entrypoint. Template Job must already contain run.sh unless submit uses --allow-add-file.
  --file <path[=name]>   Optional generic trainFile replacement. Repeatable. Primary names are reserved for --zip/--config/--run-sh.
  --file-dir <dir>       Optional directory of trainFiles. Direct files only; code.zip/config.yaml/run.sh are auto-detected, others become generic files.
  --run                  Mark the prepared submission as run-after-submit.
  --out <dir>            Output directory. Relative paths are placed under outputs/taiji-output/submit/. Default: outputs/taiji-output/submit/bundle
  --message <text>       Optional local note, often matching the git commit message.
  --allow-dirty          Do not warn when the local git working tree is dirty.
  --help                 Show this help.

This tool prepares a deterministic local submission bundle. It does not upload,
click, submit, or run a Taiji job by itself. Use it as the safe input layer for
browser/API automation after the platform upload flow is captured.`;
}

function parseArgs(argv) {
  const args = {
    run: false,
    out: "bundle",
    allowDirty: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--run") {
      args.run = true;
    } else if (arg === "--allow-dirty") {
      args.allowDirty = true;
    } else if (arg === "--file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args.files ??= [];
      args.files.push(value);
      i += 1;
    } else if (arg === "--file-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args.fileDirs ??= [];
      args.fileDirs.push(value);
      i += 1;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args) {
  try {
    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getGitInfo() {
  const root = await runGit(["rev-parse", "--show-toplevel"]);
  if (!root) {
    return { available: false };
  }

  const [head, branch, statusShort] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["branch", "--show-current"]),
    runGit(["status", "--short"]),
  ]);

  return {
    available: true,
    root,
    branch,
    head,
    dirty: Boolean(statusShort),
    statusShort: statusShort || "",
  };
}

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`Missing required option --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
}

function safeBasename(filePath) {
  return path.basename(path.normalize(filePath));
}

function validateTrainFileName(name) {
  if (!name || name === "." || name === "..") throw new Error(`Invalid trainFile name: ${name}`);
  if (/[\\/]/.test(name)) throw new Error(`Generic trainFile name must be a file name, not a path: ${name}`);
  if (/[\x00-\x1F]/.test(name)) throw new Error(`Generic trainFile name contains control characters: ${name}`);
}

function parseGenericFileSpec(spec) {
  const separatorIndex = spec.lastIndexOf("=");
  const rawPath = separatorIndex > 0 ? spec.slice(0, separatorIndex) : spec;
  const name = separatorIndex > 0 ? spec.slice(separatorIndex + 1) : safeBasename(rawPath);
  validateTrainFileName(name);
  if (PRIMARY_TRAIN_FILE_NAMES.has(name)) {
    throw new Error(`reserved primary trainFile name: ${name}. Use --zip, --config, or --run-sh instead.`);
  }
  return { sourcePath: path.resolve(rawPath), name };
}

function parseGenericFileSpecs(specs = []) {
  const files = specs.map(parseGenericFileSpec);
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.name)) throw new Error(`Duplicate generic trainFile name: ${file.name}`);
    seen.add(file.name);
  }
  return files;
}

async function collectFileDirSpecs(fileDirs = []) {
  const result = { codeZip: null, config: null, runSh: null, genericSpecs: [] };

  for (const rawDir of fileDirs) {
    const dir = path.resolve(rawDir);
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.name === "code.zip") {
        if (result.codeZip) throw new Error(`Duplicate code.zip found in --file-dir: ${filePath}`);
        result.codeZip = filePath;
      } else if (entry.name === "config.yaml") {
        if (result.config) throw new Error(`Duplicate config.yaml found in --file-dir: ${filePath}`);
        result.config = filePath;
      } else if (entry.name === "run.sh") {
        if (result.runSh) throw new Error(`Duplicate run.sh found in --file-dir: ${filePath}`);
        result.runSh = filePath;
      } else {
        result.genericSpecs.push(filePath);
      }
    }
  }

  return result;
}

function assertSafeRelativeOutputPath(outDir) {
  if (!path.isAbsolute(outDir) && String(outDir).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside outputs/taiji-output.");
  }
}

export function resolveTaijiOutputDir(outDir) {
  assertSafeRelativeOutputPath(outDir);
  if (path.isAbsolute(outDir)) return outDir;
  const parts = outDir.split(/[\\/]+/);
  if (parts[0] === "outputs" && parts[1] === "taiji-output") return path.resolve(outDir);
  if (parts[0] === "taiji-output") return path.resolve(DEFAULT_OUT_ROOT, ...parts.slice(1));
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

async function fileInfo(filePath) {
  const s = await stat(filePath);
  return {
    path: filePath,
    basename: safeBasename(filePath),
    bytes: s.size,
    mtime: s.mtime.toISOString(),
  };
}

function makeNextSteps(manifest) {
  const genericFiles = manifest.files.genericFiles ?? [];
  const primaryNames = [
    manifest.files.codeZip ? "code zip" : null,
    manifest.files.config ? "config file" : null,
    manifest.files.runSh ? "`run.sh`" : null,
  ].filter(Boolean);
  const lines = [
    "# Taiji Submit Next Steps",
    "",
    "This directory was prepared by `prepare-taiji-submit.mjs`.",
    "",
    "## Intended live workflow",
    "",
    "1. Open the template Job URL in a logged-in browser.",
    "2. Copy the template Job.",
    primaryNames.length
      ? `3. Replace ${primaryNames.join(", ")} with the files in \`files/\`.`
      : "3. No primary files were prepared; use the generic trainFiles in `files/generic/`.",
    manifest.files.runSh
      ? "4. Confirm the new `run.sh` entrypoint matches this experiment."
      : "4. Keep `run.sh` unchanged unless the experiment explicitly needs a new entrypoint.",
    ...(genericFiles.length ? [`4a. Replace generic trainFiles: ${genericFiles.map((file) => `\`${file.name}\``).join(", ")}.`] : []),
    "5. Fill Job Name and Job Description from `manifest.json`.",
    "6. Submit the copied Job.",
    "7. If `runAfterSubmit` is true, start the new Job and record the Job ID / instance ID.",
    "",
    "## Prepared values",
    "",
    `- Template Job URL: ${manifest.templateJobUrl}`,
    `- Job Name: ${manifest.job.name}`,
    `- Job Description: ${manifest.job.description || ""}`,
    `- Run after submit: ${manifest.runAfterSubmit}`,
    ...(manifest.files.codeZip ? [`- Code zip: files/${manifest.files.codeZip.basename}`] : []),
    ...(manifest.files.config ? [`- Config: files/${manifest.files.config.basename}`] : []),
    ...(manifest.files.runSh ? [`- run.sh: files/${manifest.files.runSh.basename}`] : []),
    ...genericFiles.map((file) => `- ${file.name}: ${file.preparedPath}`),
    "",
    "## Automation note",
    "",
    "Live API/browser submission is intentionally not executed by this preparation tool.",
    "Before enabling it, capture one successful manual Copy Job -> upload zip/config -> submit -> run flow from DevTools, including upload endpoints and request payloads.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  requireArg(args, "templateJobUrl");
  requireArg(args, "name");

  const fileDirSpecs = await collectFileDirSpecs(args.fileDirs ?? []);
  const codeZip = args.zip ? path.resolve(args.zip) : fileDirSpecs.codeZip;
  const config = args.config ? path.resolve(args.config) : fileDirSpecs.config;
  const runSh = args.runSh ? path.resolve(args.runSh) : fileDirSpecs.runSh;
  const genericFiles = parseGenericFileSpecs([...fileDirSpecs.genericSpecs, ...(args.files ?? [])]);
  const outDir = resolveTaijiOutputDir(args.out);
  const filesDir = path.join(outDir, "files");
  const genericFilesDir = path.join(filesDir, "generic");

  if (codeZip && !(await exists(codeZip))) {
    throw new Error(`Code zip not found: ${codeZip}`);
  }
  if (config && !(await exists(config))) {
    throw new Error(`Config file not found: ${config}`);
  }
  if (codeZip && !safeBasename(codeZip).toLowerCase().endsWith(".zip")) {
    throw new Error(`--zip must point to a .zip file: ${codeZip}`);
  }
  if (runSh && !(await exists(runSh))) {
    throw new Error(`run.sh file not found: ${runSh}`);
  }
  if (runSh && safeBasename(runSh) !== "run.sh") {
    throw new Error(`--run-sh must point to a file named run.sh: ${runSh}`);
  }
  for (const file of genericFiles) {
    if (!(await exists(file.sourcePath))) {
      throw new Error(`Generic trainFile not found: ${file.sourcePath}`);
    }
  }
  if (!codeZip && !config && !runSh && !genericFiles.length) {
    throw new Error("No trainFiles prepared. Provide --zip/--config/--run-sh, --file, or --file-dir.");
  }

  const git = await getGitInfo();
  if (git.available && git.dirty && !args.allowDirty) {
    console.warn("Warning: git working tree is dirty. Use --allow-dirty to mark this as intentional.");
  }

  await mkdir(filesDir, { recursive: true });
  if (genericFiles.length) await mkdir(genericFilesDir, { recursive: true });

  const copiedZip = codeZip ? path.join(filesDir, safeBasename(codeZip)) : null;
  const copiedConfig = config ? path.join(filesDir, safeBasename(config)) : null;
  const copiedRunSh = runSh ? path.join(filesDir, "run.sh") : null;
  if (codeZip) await copyFile(codeZip, copiedZip);
  if (config) await copyFile(config, copiedConfig);
  if (runSh) await copyFile(runSh, copiedRunSh);

  const copiedGenericFiles = [];
  for (const file of genericFiles) {
    const copiedPath = path.join(genericFilesDir, file.name);
    await copyFile(file.sourcePath, copiedPath);
    copiedGenericFiles.push({ ...file, copiedPath });
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    templateJobUrl: args.templateJobUrl,
    runAfterSubmit: args.run,
    job: {
      name: args.name,
      description: args.description || "",
      message: args.message || "",
    },
    files: {
      ...(codeZip
        ? {
            codeZip: {
              ...(await fileInfo(codeZip)),
              preparedPath: path.relative(outDir, copiedZip).replaceAll(path.sep, "/"),
            },
          }
        : {}),
      ...(config
        ? {
            config: {
              ...(await fileInfo(config)),
              preparedPath: path.relative(outDir, copiedConfig).replaceAll(path.sep, "/"),
            },
          }
        : {}),
      ...(runSh
        ? {
            runSh: {
              ...(await fileInfo(runSh)),
              preparedPath: path.relative(outDir, copiedRunSh).replaceAll(path.sep, "/"),
            },
          }
        : {}),
      ...(copiedGenericFiles.length
        ? {
            genericFiles: await Promise.all(copiedGenericFiles.map(async (file) => ({
              name: file.name,
              ...(await fileInfo(file.sourcePath)),
              preparedPath: path.relative(outDir, file.copiedPath).replaceAll(path.sep, "/"),
            }))),
          }
        : {}),
    },
    git,
  };

  const manifestPath = path.join(outDir, "manifest.json");
  const nextStepsPath = path.join(outDir, "NEXT_STEPS.md");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(nextStepsPath, makeNextSteps(manifest), "utf8");

  console.log(`Prepared Taiji submission bundle: ${outDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Next steps: ${nextStepsPath}`);
  if (git.available && git.dirty && !args.allowDirty) {
    console.log("Git warning: working tree is dirty; manifest still records the exact status.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
