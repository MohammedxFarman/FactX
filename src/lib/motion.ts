export const motionTokens = {
  duration: { micro: .12, standard: .2, page: .3 },
  enter: [0.16, 1, 0.3, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
  stagger: .035,
};
