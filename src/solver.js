// Two-phase primal simplex for continuous production-flow models.
// All variables are nonnegative. Inequalities are normalized before solving.
const solver = {
  Solve(model) {
    const names = Object.keys(model.variables),
      n = names.length,
      rows = [],
      limits = [],
      objective = names.map(
        (k) =>
          (model.variables[k][model.optimize] || 0) *
          (model.opType === "min" ? -1 : 1),
      );
    for (const [key, bounds] of Object.entries(model.constraints)) {
      const row = names.map((k) => model.variables[k][key] || 0);
      const append = (r, b) => {
        const scale = Math.max(1, ...r.map(Math.abs));
        rows.push(r.map((v) => v / scale));
        limits.push(b / scale);
      };
      if (bounds.max !== undefined) append(row, bounds.max);
      if (bounds.min !== undefined)
        append(
          row.map((v) => -v),
          -bounds.min,
        );
    }
    const m = rows.length,
      t = Array.from({ length: m + 2 }, () => new Float64Array(n + 2)),
      basis = Array.from({ length: m }, (_, i) => n + i),
      free = Array.from({ length: n + 1 }, (_, i) => i),
      tol = 1e-9;
    free[n] = -1;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) t[i][j] = rows[i][j];
      t[i][n] = -1;
      t[i][n + 1] = limits[i];
    }
    for (let j = 0; j < n; j++) t[m][j] = -objective[j];
    t[m + 1][n] = 1;
    function pivot(r, s) {
      const inv = 1 / t[r][s];
      for (let i = 0; i < m + 2; i++)
        if (i !== r) {
          const mult = t[i][s] * inv;
          if (Math.abs(mult) > 0)
            for (let j = 0; j < n + 2; j++)
              if (j !== s) t[i][j] -= t[r][j] * mult;
        }
      for (let j = 0; j < n + 2; j++) if (j !== s) t[r][j] *= inv;
      for (let i = 0; i < m + 2; i++) if (i !== r) t[i][s] *= -inv;
      t[r][s] = inv;
      [basis[r], free[s]] = [free[s], basis[r]];
    }
    function optimize(phase) {
      const obj = phase === 1 ? m + 1 : m;
      for (let step = 0; step < 20000; step++) {
        let col = -1;
        for (let j = 0; j <= n; j++) {
          if (phase === 2 && free[j] === -1) continue;
          if (
            col === -1 ||
            t[obj][j] < t[obj][col] - tol ||
            (Math.abs(t[obj][j] - t[obj][col]) <= tol && free[j] < free[col])
          )
            col = j;
        }
        if (col === -1 || t[obj][col] >= -tol) return true;
        let row = -1;
        for (let i = 0; i < m; i++) {
          if (t[i][col] <= tol) continue;
          if (row === -1) row = i;
          else {
            const a = t[i][n + 1] / t[i][col],
              b = t[row][n + 1] / t[row][col];
            if (
              a < b - tol ||
              (Math.abs(a - b) <= tol && basis[i] < basis[row])
            )
              row = i;
          }
        }
        if (row === -1) return false;
        pivot(row, col);
      }
      throw Error("求解未收敛，请简化配方组合");
    }
    let low = 0;
    for (let i = 1; i < m; i++) if (t[i][n + 1] < t[low][n + 1]) low = i;
    if (m && t[low][n + 1] < -tol) {
      pivot(low, n);
      if (!optimize(1) || Math.abs(t[m + 1][n + 1]) > 1e-7)
        return { feasible: false, bounded: true };
      for (let i = 0; i < m; i++)
        if (basis[i] === -1) {
          let col = -1;
          for (let j = 0; j <= n; j++)
            if (Math.abs(t[i][j]) > tol && (col === -1 || free[j] < free[col]))
              col = j;
          if (col !== -1) pivot(i, col);
        }
    }
    if (!optimize(2)) return { feasible: true, bounded: false };
    const out = {
      feasible: true,
      bounded: true,
      result: t[m][n + 1] * (model.opType === "min" ? -1 : 1),
    };
    for (let i = 0; i < m; i++)
      if (basis[i] >= 0 && basis[i] < n)
        out[names[basis[i]]] = Math.max(0, t[i][n + 1]);
    // Reject numerically invalid tableaux instead of presenting excess resources.
    for (let i = 0; i < m; i++) {
      let lhs = 0;
      for (let j = 0; j < n; j++) lhs += rows[i][j] * (out[names[j]] || 0);
      if (lhs > limits[i] + 1e-6 * Math.max(1, Math.abs(limits[i])))
        return { feasible: false, bounded: true };
    }
    return out;
  },
};
