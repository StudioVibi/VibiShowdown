const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function to_bigint_trunc(value: number): bigint {
  if (!Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.trunc(value));
}

function clamp_bigint_to_safe(value: bigint): bigint {
  if (value > MAX_SAFE_BIGINT) {
    return MAX_SAFE_BIGINT;
  }
  if (value < -MAX_SAFE_BIGINT) {
    return -MAX_SAFE_BIGINT;
  }
  return value;
}

function to_safe_number(value: bigint): number {
  return Number(clamp_bigint_to_safe(value));
}

function floor_div(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    return 0n;
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n && ((remainder > 0n) !== (denominator > 0n))) {
    quotient -= 1n;
  }
  return quotient;
}

function ceil_div(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    return 0n;
  }
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder !== 0n && ((remainder > 0n) === (denominator > 0n))) {
    quotient += 1n;
  }
  return quotient;
}

export function normalize_int(value: number, fallback: number, min: number = Number.MIN_SAFE_INTEGER): number {
  const base = Number.isFinite(value) ? Math.round(value) : Math.round(fallback);
  return Math.max(min, base);
}

export function mul_div_floor(a: number, b: number, d: number): number {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  return to_safe_number(floor_div(numerator, denominator));
}

export function mul_div_ceil(a: number, b: number, d: number): number {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  return to_safe_number(ceil_div(numerator, denominator));
}

export function mul_div_round(a: number, b: number, d: number): number {
  const numerator = to_bigint_trunc(a) * to_bigint_trunc(b);
  const denominator = to_bigint_trunc(d);
  if (denominator === 0n) {
    return 0;
  }

  const negative = (numerator < 0n) !== (denominator < 0n);
  const abs_num = numerator < 0n ? -numerator : numerator;
  const abs_den = denominator < 0n ? -denominator : denominator;
  const rounded = (abs_num + abs_den / 2n) / abs_den;
  return to_safe_number(negative ? -rounded : rounded);
}
