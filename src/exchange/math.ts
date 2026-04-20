export const clamp = (value: number, minimum: number, maximum: number): number => {
  if (Number.isNaN(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
};

export const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
};

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export const standardDeviation = (values: number[]): number => {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
};

export const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

export const normalize = (value: number, minimum: number, maximum: number): number => {
  if (maximum <= minimum) {
    return 0;
  }

  return clamp((value - minimum) / (maximum - minimum), 0, 1);
};

export const harmonicMean = (values: number[]): number => {
  const filtered = values.filter((value) => value > 0);
  if (!filtered.length) {
    return 0;
  }

  return filtered.length / filtered.reduce((total, value) => total + 1 / value, 0);
};

export const percentile = (values: number[], ratio: number): number => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.floor((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index]!; // Non-null assertion safe after length check
};

export const boundedRatio = (numerator: number, denominator: number): number => {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
};

export const nowIso = (): string => new Date().toISOString();

export const bucketTimestamp = (timestamp: string, granularity: "minute" | "hour"): string => {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return nowIso();
  }

  // Work in UTC to avoid timezone issues during DST transitions
  if (granularity === "hour") {
    date.setUTCMinutes(0, 0, 0);
  } else {
    date.setUTCSeconds(0, 0);
  }

  return date.toISOString();
};

export const unique = <T>(values: T[]): T[] => [...new Set(values)];
