export type ScrollViewportMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type AutoScrollDecision = {
  isUserNearBottom: boolean;
  contextChanged: boolean;
  forceFollow: boolean;
};

export const DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX = 80;

export const isNearBottom = (
  metrics: ScrollViewportMetrics,
  threshold = DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
): boolean => {
  const distanceFromBottom = metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
  return distanceFromBottom <= threshold;
};

export const shouldAutoScrollToLatest = ({
  isUserNearBottom,
  contextChanged,
  forceFollow,
}: AutoScrollDecision): boolean => contextChanged || forceFollow || isUserNearBottom;
