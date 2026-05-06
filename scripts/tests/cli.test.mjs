import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const toolDir = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../../bin/taac2026.mjs", import.meta.url));

test("taac2026 CLI prints top-level command help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"], { cwd: toolDir });

  assert.match(stdout, /TAAC2026 CLI/);
  assert.match(stdout, /scrape/);
  assert.match(stdout, /diff-config/);
  assert.match(stdout, /prepare-submit/);
  assert.match(stdout, /submit/);
  assert.match(stdout, /compare/);
  assert.match(stdout, /compare-runs/);
  assert.match(stdout, /logs/);
  assert.match(stdout, /ckpt-select/);
  assert.match(stdout, /ckpt-publish/);
  assert.match(stdout, /model/);
  assert.match(stdout, /eval/);
  assert.match(stdout, /ledger/);
});

test("taac2026 CLI dispatches to bundled commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "prepare-submit", "--help"], { cwd: toolDir });

  assert.match(stdout, /prepare-taiji-submit/);
  assert.match(stdout, /--file-dir/);
});

test("taac2026 scrape help does not launch a browser", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "scrape", "--help"], { cwd: toolDir });

  assert.match(stdout, /taac2026 scrape/);
  assert.match(stdout, /--direct/);
  assert.match(stdout, /--job-internal-id/);
});

test("taac2026 CLI dispatches experiment helper commands", async () => {
  const { stdout: doctorHelp } = await execFileAsync(process.execPath, [cliPath, "submit", "doctor", "--help"], { cwd: toolDir });
  const { stdout: compareHelp } = await execFileAsync(process.execPath, [cliPath, "compare", "jobs", "--help"], { cwd: toolDir });
  const { stdout: compareRunsHelp } = await execFileAsync(process.execPath, [cliPath, "compare-runs", "--help"], { cwd: toolDir });
  const { stdout: ckptPublishHelp } = await execFileAsync(process.execPath, [cliPath, "ckpt-publish", "--help"], { cwd: toolDir });
  const { stdout: evalHelp } = await execFileAsync(process.execPath, [cliPath, "eval", "--help"], { cwd: toolDir });

  assert.match(doctorHelp, /submit doctor/);
  assert.match(compareHelp, /compare jobs/);
  assert.match(compareRunsHelp, /compare-runs/);
  assert.match(ckptPublishHelp, /ckpt-publish/);
  assert.match(evalHelp, /eval create/);
  assert.match(evalHelp, /eval scrape/);
  assert.match(evalHelp, /--submit-name/);
});
