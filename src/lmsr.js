// Logarithmic Market Scoring Rule (Hanson). Works for any number of outcomes.
// Each share pays 1 coin if its outcome wins. Shared with the browser (public/lmsr.js).

export function prices(qs, b) {
  const max = Math.max(...qs);
  const ex = qs.map((q) => Math.exp((q - max) / b));
  const sum = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / sum);
}

export function cost(qs, b) {
  const max = Math.max(...qs);
  return max + b * Math.log(qs.reduce((a, q) => a + Math.exp((q - max) / b), 0));
}

// Shares received for spending `amount` on outcome i (closed form of cost(q + x·e_i) - cost(q) = amount).
export function sharesForAmount(qs, b, i, amount) {
  const p = prices(qs, b)[i];
  return b * Math.log1p(Math.expm1(amount / b) / p);
}

// Coins received for selling `shares` of outcome i.
export function sellValue(qs, b, i, shares) {
  const after = qs.slice();
  after[i] -= shares;
  return cost(qs, b) - cost(after, b);
}
