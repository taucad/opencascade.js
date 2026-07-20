export const buildDate = (env = process.env) => {
  const raw = env.SOURCE_DATE_EPOCH;
  if (!raw) return new Date();
  if (!/^\d+$/.test(raw)) {
    throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer');
  }
  return new Date(Number(raw) * 1000);
};
