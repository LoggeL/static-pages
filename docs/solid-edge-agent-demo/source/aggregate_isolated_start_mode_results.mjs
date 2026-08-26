#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const inputDirectory = path.resolve(
  process.argv[2] ?? "output/solid-edge-large-assembly/api-benchmark",
);

const modes = [
  {
    id: "automation_spawned",
    files: [
      "start-mode-automation-smoke.json",
      "start-mode-automation-2.json",
      "start-mode-automation-3.json",
      "start-mode-automation-4.json",
      "start-mode-automation-5.json",
    ],
  },
  {
    id: "interactive_normal",
    files: Array.from({ length: 5 }, (_, index) =>
      `start-mode-interactive_normal-${index + 1}.json`,
    ),
  },
  {
    id: "interactive_file_open",
    files: Array.from({ length: 5 }, (_, index) =>
      `start-mode-interactive_file_open-${index + 1}.json`,
    ),
  },
];

const metricDefinitions = {
  application_ready: { unit: "ms", read: (run) => run.timings_ms.application_ready_ms },
  document_ready: { unit: "ms", read: (run) => run.timings_ms.document_ready_ms },
  addin_ready: { unit: "ms", read: (run) => run.timings_ms.addin_ready_observed_ms },
  occurrence_read: { unit: "ms", read: (run) => run.timings_ms.occurrence_read_ms },
  total: { unit: "ms", read: (run) => run.timings_ms.total_ms },
  process_cpu: { unit: "ms", read: (run) => run.process_cpu_ms },
  peak_working_set: { unit: "bytes", read: (run) => run.peak_working_set_bytes },
};

function readJson(fileName) {
  const filePath = path.join(inputDirectory, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing start-mode result: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function nearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

function populationCvPercent(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean === 0 ? 0 : (Math.sqrt(variance) / mean) * 100;
}

function summarize(values, unit) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    unit,
    attempts: values.length,
    successes: values.length,
    p50: nearestRank(values, 0.5),
    p90: nearestRank(values, 0.9),
    p95: nearestRank(values, 0.95),
    min: sorted[0],
    max: sorted.at(-1),
    cv_percent_population: populationCvPercent(values),
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const runs = modes.flatMap(({ id, files }) =>
  files.map((fileName) => {
    const run = readJson(fileName);
    if (run.start_mode !== id) {
      throw new Error(`${fileName}: expected ${id}, got ${run.start_mode}`);
    }
    return { ...run, source_file: fileName };
  }),
);

const fixtureHashes = [...new Set(runs.map((run) => run.fixture_sha256))];
const validationErrors = [];

if (fixtureHashes.length !== 1) {
  validationErrors.push(`Expected one fixture hash, got ${fixtureHashes.length}.`);
}

for (const mode of modes) {
  const modeRuns = runs.filter((run) => run.start_mode === mode.id);
  if (modeRuns.length !== 5) {
    validationErrors.push(`${mode.id}: expected 5 samples, got ${modeRuns.length}.`);
  }
  for (const run of modeRuns) {
    if (!run.success) validationErrors.push(`${run.source_file}: run failed.`);
    if (run.actual_occurrences !== 210) {
      validationErrors.push(`${run.source_file}: expected 210 occurrences, got ${run.actual_occurrences}.`);
    }
    if (!run.addin?.connect || run.addin?.command_count !== 2) {
      validationErrors.push(`${run.source_file}: add-in contract not observed.`);
    }
    if (!run.cleanup?.edge_exit_observed || run.cleanup?.forced_termination) {
      validationErrors.push(`${run.source_file}: cleanup was not graceful.`);
    }
  }
}

if (validationErrors.length > 0) {
  throw new Error(`Start-mode validation failed:\n${validationErrors.join("\n")}`);
}

const summaries = modes.map(({ id }) => {
  const modeRuns = runs.filter((run) => run.start_mode === id);
  return {
    start_mode: id,
    process_start_mechanism: modeRuns[0].process_start_mechanism,
    sample_count: modeRuns.length,
    all_success: modeRuns.every((run) => run.success),
    all_structure_valid: modeRuns.every((run) => run.stages?.structure_valid),
    all_addin_ready: modeRuns.every((run) => run.stages?.addin_ready),
    all_cleanup_complete: modeRuns.every((run) => run.stages?.cleanup_complete),
    forced_termination_count: modeRuns.filter((run) => run.cleanup?.forced_termination).length,
    metrics: Object.fromEntries(
      Object.entries(metricDefinitions).map(([name, definition]) => [
        name,
        summarize(modeRuns.map(definition.read), definition.unit),
      ]),
    ),
  };
});

const generatedAtUtc = new Date().toISOString();
const combined = {
  schema_version: 1,
  generated_at_utc: generatedAtUtc,
  fixture_sha256: fixtureHashes[0],
  measurement_class: "application_cold",
  sample_count: runs.length,
  samples_per_start_mode: 5,
  percentile_method: "nearest_rank",
  cv_method: "population_standard_deviation_divided_by_mean",
  validation: {
    all_success: true,
    all_fixture_hashes_equal: true,
    all_actual_occurrences: 210,
    all_addin_commands_observed: true,
    all_cleanup_graceful: true,
    forced_termination_count: 0,
  },
  runs,
};

const summary = {
  schema_version: 1,
  generated_at_utc: generatedAtUtc,
  fixture_sha256: fixtureHashes[0],
  measurement_class: "application_cold",
  sample_count: runs.length,
  samples_per_start_mode: 5,
  percentile_method: "nearest_rank",
  cv_method: "population_standard_deviation_divided_by_mean",
  validation: combined.validation,
  start_modes: summaries,
  measurement_note:
    "Application-cold means zero Edge.exe processes before every sample. It is not an OS-cold or filesystem-cache-cold measurement. Interactive modes were launched asynchronously in the logged-on console session so the Mac-side controller could independently observe completion.",
};

const csvColumns = [
  "start_mode",
  "iteration",
  "run_id",
  "timestamp_utc",
  "fixture_sha256",
  "process_start_mechanism",
  "success",
  "actual_occurrences",
  "included_in_bom",
  "hierarchy_depth",
  "application_ready_ms",
  "document_ready_ms",
  "addin_ready_ms",
  "occurrence_read_ms",
  "total_ms",
  "process_cpu_ms",
  "peak_working_set_bytes",
  "addin_connect",
  "addin_command_count",
  "cleanup_complete",
  "forced_termination",
  "source_file",
];

const csvRows = runs.map((run) => ({
  start_mode: run.start_mode,
  iteration: run.iteration,
  run_id: run.run_id,
  timestamp_utc: run.timestamp_utc,
  fixture_sha256: run.fixture_sha256,
  process_start_mechanism: run.process_start_mechanism,
  success: run.success,
  actual_occurrences: run.actual_occurrences,
  included_in_bom: run.included_in_bom,
  hierarchy_depth: run.hierarchy_depth,
  application_ready_ms: run.timings_ms.application_ready_ms,
  document_ready_ms: run.timings_ms.document_ready_ms,
  addin_ready_ms: run.timings_ms.addin_ready_observed_ms,
  occurrence_read_ms: run.timings_ms.occurrence_read_ms,
  total_ms: run.timings_ms.total_ms,
  process_cpu_ms: run.process_cpu_ms,
  peak_working_set_bytes: run.peak_working_set_bytes,
  addin_connect: run.addin.connect,
  addin_command_count: run.addin.command_count,
  cleanup_complete: run.stages.cleanup_complete,
  forced_termination: run.cleanup.forced_termination,
  source_file: run.source_file,
}));

fs.writeFileSync(
  path.join(inputDirectory, "start-mode-comparison-runs.json"),
  `${JSON.stringify(combined, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(inputDirectory, "start-mode-comparison-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(inputDirectory, "start-mode-comparison-runs.csv"),
  `${csvColumns.join(",")}\n${csvRows
    .map((row) => csvColumns.map((column) => csvCell(row[column])).join(","))
    .join("\n")}\n`,
);

console.log(JSON.stringify(summary, null, 2));
