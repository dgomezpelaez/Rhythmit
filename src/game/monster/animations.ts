/**
 * Animations Monster Feeder plays unconditionally — a character without all
 * of these is rejected at load time. Optional extras the game escalates to
 * when present: combo_10, combo_25, fever.
 */
export const REQUIRED_ANIMATIONS = [
  'idle',
  'chomp_left',
  'chomp_right',
  'chomp_up',
  'chomp_down',
  'perfect',
  'splat',
  'ko',
] as const;
