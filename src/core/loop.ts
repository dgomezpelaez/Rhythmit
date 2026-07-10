/**
 * Render loop — requestAnimationFrame only. The rAF timestamp is passed to
 * the callback purely for animation smoothing; gameplay time always comes
 * from the AudioClock, never from here.
 */
export function startRenderLoop(render: (rafTimeMs: number) => void): void {
  const frame = (rafTimeMs: number) => {
    render(rafTimeMs);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
