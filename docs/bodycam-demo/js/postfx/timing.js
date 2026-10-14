// Queries are allocated once. Reading results never waits for the GPU.
export function createGpuTimer(gl) {
  let ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const queries = ext ? Array.from({ length: 8 }, () => gl.createQuery()) : [];
  const pending = new Uint8Array(queries.length);
  const generations = new Uint32Array(queries.length);
  const samples = new Float64Array(240);
  let active = -1, cursor = 0, count = 0, totalCount = 0, last = 0, disjointCount = 0, generation = 1;
  function poll() {
    if (!ext) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      generation++; count = 0; disjointCount++; return;
    }
    for (let i = 0; i < queries.length; ++i) {
      if (!pending[i] || !gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) continue;
      if (generations[i]!==generation) { pending[i]=0; continue; }
      last = gl.getQueryParameter(queries[i], gl.QUERY_RESULT) / 1e6;
      samples[cursor] = last; cursor = (cursor + 1) % samples.length;
      count = Math.min(count + 1, samples.length); totalCount++; pending[i] = 0;
    }
  }
  function begin() {
    poll();
    if (!ext || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    for (let i = 0; i < queries.length; ++i) if (!pending[i]) {
      active = i; generations[i]=generation; gl.beginQuery(ext.TIME_ELAPSED_EXT, queries[i]); return;
    }
  }
  function end() {
    if (active < 0) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT); pending[active] = 1; active = -1;
  }
  return {
    supported: !!ext, begin, end, poll,
    get lastMs() { return last; },
    snapshot() {
      const sorted = Array.from(samples.subarray(0, count)).sort((a,b) => a-b);
      return { supported: !!ext, count, totalCount, disjointCount, lastMs: last,
        meanMs: sorted.reduce((sum,v) => sum+v,0) / Math.max(1,count),
        medianMs: sorted[Math.floor(count * 0.5)] ?? null,
        p95Ms: sorted[Math.min(count-1,Math.floor(count * 0.95))] ?? null,
        maxMs: sorted[count-1] ?? null };
    },
    reset() { generation++; count = 0; cursor = 0; totalCount = 0; last = 0; },
    restoreContext() {
      ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
      for(let i=0;i<queries.length;++i) queries[i]=ext ? gl.createQuery() : null;
      pending.fill(0); active=-1; generation++; count=0; cursor=0; totalCount=0; last=0;
    },
    dispose() { end(); for (const q of queries) gl.deleteQuery(q); },
  };
}
