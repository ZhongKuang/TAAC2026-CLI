import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const DEFAULT_OUT_ROOT = "outputs/taiji-output/reports";
const DEFAULT_OUT_DIR = `${DEFAULT_OUT_ROOT}/config-diffs`;

function parseArgs(argv) {
  const args = {
    json: false,
    out: "",
  };
  const files = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (!arg.startsWith("--")) files.push(arg);
  }

  if (files.length !== 2) {
    throw new Error("Usage: taac2026 diff-config <old-config.yaml> <new-config.yaml> [--json] [--out diff.json]. Relative --out paths are written under outputs/taiji-output/.");
  }

  return { ...args, oldFile: files[0], newFile: files[1] };
}

function assertSafeRelativeOutputPath(outPath) {
  if (!path.isAbsolute(outPath) && String(outPath).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside outputs/taiji-output.");
  }
}

export function resolveTaijiOutputFile(outPath) {
  assertSafeRelativeOutputPath(outPath);
  if (path.isAbsolute(outPath)) return outPath;
  const parts = outPath.split(/[\\/]+/);
  if (parts[0] === "outputs" && parts[1] === "taiji-output") return path.resolve(outPath);
  if (parts[0] === "taiji-output") return path.resolve(DEFAULT_OUT_ROOT, ...parts.slice(1));
  if (path.dirname(outPath) === ".") return path.resolve(DEFAULT_OUT_DIR, outPath);
  return path.resolve(DEFAULT_OUT_ROOT, outPath);
}

function formatPath(parts) {
  if (!parts.length) return "$";
  return parts
    .map((part) => (typeof part === "number" ? `[${part}]` : String(part).replace(/[.[\]\\]/g, "\\$&")))
    .reduce((acc, part) => (part.startsWith("[") ? `${acc}${part}` : acc ? `${acc}.${part}` : part), "");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareValues(before, after, parts = [], changes = []) {
  if (stableStringify(before) === stableStringify(after)) return changes;

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (index >= before.length) changes.push({ type: "added", path: formatPath([...parts, index]), before: undefined, after: after[index] });
      else if (index >= after.length) changes.push({ type: "removed", path: formatPath([...parts, index]), before: before[index], after: undefined });
      else compareValues(before[index], after[index], [...parts, index], changes);
    }
    return changes;
  }

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      if (!(key in before)) changes.push({ type: "added", path: formatPath([...parts, key]), before: undefined, after: after[key] });
      else if (!(key in after)) changes.push({ type: "removed", path: formatPath([...parts, key]), before: before[key], after: undefined });
      else compareValues(before[key], after[key], [...parts, key], changes);
    }
    return changes;
  }

  changes.push({ type: "changed", path: formatPath(parts), before, after });
  return changes;
}

function summarize(changes) {
  return changes.reduce(
    (acc, change) => {
      acc.total += 1;
      acc[change.type] += 1;
      return acc;
    },
    { total: 0, added: 0, removed: 0, changed: 0 },
  );
}

function renderValue(value) {
  if (value === undefined) return "<missing>";
  if (typeof value === "string") return JSON.stringify(value);
  return stableStringify(value);
}

function renderMarkdown(result) {
  const lines = [
    `# Config diff`,
    "",
    `Old: ${result.oldFile}`,
    `New: ${result.newFile}`,
    "",
    `Summary: ${result.summary.total} total, ${result.summary.added} added, ${result.summary.removed} removed, ${result.summary.changed} changed.`,
    "",
  ];

  for (const type of ["changed", "added", "removed"]) {
    const group = result.changes.filter((change) => change.type === type);
    if (!group.length) continue;
    lines.push(`## ${type}`);
    for (const change of group) {
      lines.push(`- \`${change.path}\`: ${renderValue(change.before)} -> ${renderValue(change.after)}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function loadYaml(filePath) {
  const content = await readFile(filePath, "utf8");
  return yaml.load(content);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [before, after] = await Promise.all([loadYaml(args.oldFile), loadYaml(args.newFile)]);
  const changes = compareValues(before, after);
  const result = {
    oldFile: path.resolve(args.oldFile),
    newFile: path.resolve(args.newFile),
    summary: summarize(changes),
    changes,
  };

  const output = args.json ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result);
  if (args.out) {
    const outPath = resolveTaijiOutputFile(args.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, output, "utf8");
    console.error(`Wrote config diff: ${outPath}`);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
