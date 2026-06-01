// benchmark/utils/timer.js
// -----------------------------------------------------------------------------
// Benchmark timer helpers
// -----------------------------------------------------------------------------

function nowNs() {
  return process.hrtime.bigint();
}

function nsToMs(ns) {
  return Number(ns) / 1_000_000;
}

function diffMs(startNs, endNs) {
  return nsToMs(endNs - startNs);
}

function round(value, digits = 4) {
  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function measure(name, fn, options = {}) {
  const startNs = nowNs();

  let result;
  let error = null;

  try {
    result = await fn();
  } catch (err) {
    error = err;
  }

  const endNs = nowNs();
  const durationMs = diffMs(startNs, endNs);

  const output = {
    name,
    ms: round(durationMs),
    started_at: options.startedAt || new Date().toISOString(),
    ok: !error,
  };

  if (options.rows !== undefined) {
    output.rows = options.rows;
    output.rows_per_sec = round(Number(options.rows) / (durationMs / 1000));
    output.avg_ms_per_row = round(durationMs / Number(options.rows));
  }

  if (options.operations !== undefined) {
    output.operations = options.operations;
    output.ops_per_sec = round(Number(options.operations) / (durationMs / 1000));
    output.avg_ms_per_op = round(durationMs / Number(options.operations));
  }

  if (typeof options.meta === "function") {
    Object.assign(output, options.meta(result));
  } else if (options.meta && typeof options.meta === "object") {
    Object.assign(output, options.meta);
  }

  if (error) {
    output.error_code = error.code || "ERROR";
    output.error_message = error.message || String(error);
    throw Object.assign(error, {
      benchmarkResult: output,
    });
  }

  return {
    result,
    metric: output,
  };
}

class BenchmarkTimer {
  constructor(name = "benchmark") {
    this.name = name;
    this.startNs = null;
    this.laps = [];
  }

  start() {
    this.startNs = nowNs();
    this.laps = [];
    return this;
  }

  lap(name, meta = {}) {
    if (!this.startNs) {
      this.start();
    }

    const currentNs = nowNs();
    const previousNs =
      this.laps.length > 0
        ? this.laps[this.laps.length - 1].ns
        : this.startNs;

    const lapMs = diffMs(previousNs, currentNs);
    const totalMs = diffMs(this.startNs, currentNs);

    const item = {
      name,
      ms: round(lapMs),
      total_ms: round(totalMs),
      ns: currentNs,
      ...meta,
    };

    this.laps.push(item);

    return item;
  }

  stop(meta = {}) {
    if (!this.startNs) {
      return {
        name: this.name,
        ms: 0,
        laps: [],
        ...meta,
      };
    }

    const endNs = nowNs();

    return {
      name: this.name,
      ms: round(diffMs(this.startNs, endNs)),
      laps: this.laps.map(({ ns, ...lap }) => lap),
      ...meta,
    };
  }
}

module.exports = {
  nowNs,
  nsToMs,
  diffMs,
  round,
  measure,
  BenchmarkTimer,
};