export type StreamLimitResult = {
  acceptedDelta: string;
  nextText: string;
  truncated: boolean;
};

export const appendDeltaWithinLimit = (
  currentText: string,
  delta: string,
  maxChars?: number
): StreamLimitResult => {
  if (!maxChars || maxChars <= 0) {
    return {
      acceptedDelta: delta,
      nextText: currentText + delta,
      truncated: false,
    };
  }

  if (currentText.length >= maxChars) {
    return {
      acceptedDelta: '',
      nextText: currentText,
      truncated: true,
    };
  }

  const remaining = maxChars - currentText.length;
  const acceptedDelta = delta.slice(0, remaining);
  const nextText = currentText + acceptedDelta;
  const truncated = acceptedDelta.length < delta.length || nextText.length >= maxChars;

  return { acceptedDelta, nextText, truncated };
};
