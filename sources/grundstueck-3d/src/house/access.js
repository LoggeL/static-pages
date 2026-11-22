// Shared rectangular footprints for the three entrances in model, drawings and site overlays.
export function accessGeometry(spec) {
  const { main, side, garden } = spec.entrance;
  const steps = (stair) =>
    stair.steps.map((step) => ({ ...step, y: step.yTop }));
  return {
    foyer: {
      threshold: main.sillY,
      opening: main.slabOpening,
      bottom: main.landing,
      risers: main.stair.risers,
      rise: main.stair.riseM,
      tread: main.stair.treadM,
      clearWidth: main.stair.box.clearWidthM,
      steps: steps(main.stair),
    },
    hof: {
      top: side.landing,
      bottom: side.stair.bottomPad,
      risers: side.stair.risers,
      rise: side.stair.riseM,
      tread: side.stair.treadM,
      clearWidth: side.stair.box.clearWidthM,
      steps: steps(side.stair),
    },
    gardenStep: { ...garden.steps[0], y: garden.steps[0].yTop },
  };
}
