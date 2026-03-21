export const createChildTimestampAfter = (parentTimestamp: string, candidateTimestamp: string): string => {
  const parentMs = new Date(parentTimestamp).getTime();
  const candidateMs = new Date(candidateTimestamp).getTime();

  if (!Number.isFinite(parentMs) || !Number.isFinite(candidateMs)) {
    return candidateTimestamp;
  }

  return new Date(Math.max(candidateMs, parentMs + 1)).toISOString();
};
