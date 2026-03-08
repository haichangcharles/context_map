export const CONTEXT_MAP_SELECTION_BODY_CLASS = 'selecting-context-map';

type BodyLike = {
  classList: {
    add: (className: string) => void;
    remove: (className: string) => void;
  };
};

export const syncBodyClassToggle = (
  body: BodyLike | null | undefined,
  className: string,
  enabled: boolean
) => {
  if (!body) return;
  if (enabled) {
    body.classList.add(className);
    return;
  }
  body.classList.remove(className);
};
