export const FIXED_SIMULATION_HZ = 60;

const FIXED_STEP_MILLISECONDS = 1000 / FIXED_SIMULATION_HZ;
const MAX_FRAME_MILLISECONDS = 50;
const MAX_PLAYBACK_SPEED = 4;
const MAX_ENGINE_TICK_UNITS = 0.2;
const MAX_ENGINE_TICKS_PER_FIXED_STEP = 64;
const EPSILON = 1e-9;

/**
 * Presentation adapters may render at any cadence, but they advance the engine through this
 * fixed wall-clock schedule. The engine's public tick clamp is respected by subdividing one
 * fixed step; renderer FPS therefore cannot alter authoritative simulation chunking.
 */
export function createFixedSimulationClockV1(options = {}) {
  const timeUnitSeconds = Number(options.timeUnitSeconds);
  if (!Number.isFinite(timeUnitSeconds) || timeUnitSeconds <= 0) {
    throw new TypeError("timeUnitSeconds must be a finite positive number.");
  }

  let pendingMilliseconds = 0;

  const clock = {
    advance(elapsedMilliseconds, playbackSpeed, tick) {
      if (typeof tick !== "function") throw new TypeError("tick must be a function.");
      const elapsed = Number(elapsedMilliseconds);
      const speed = Number(playbackSpeed);
      if (!Number.isFinite(elapsed) || elapsed <= 0 || !Number.isFinite(speed) || speed <= 0) {
        return result(0, 0, 0, pendingMilliseconds);
      }

      pendingMilliseconds += Math.min(MAX_FRAME_MILLISECONDS, elapsed);
      const fixedSteps = Math.floor((pendingMilliseconds + EPSILON) / FIXED_STEP_MILLISECONDS);
      if (fixedSteps <= 0) return result(0, 0, 0, pendingMilliseconds);
      pendingMilliseconds = Math.max(0, pendingMilliseconds - fixedSteps * FIXED_STEP_MILLISECONDS);
      if (pendingMilliseconds < EPSILON) pendingMilliseconds = 0;

      const boundedSpeed = Math.min(MAX_PLAYBACK_SPEED, speed);
      const unitsPerFixedStep = FIXED_STEP_MILLISECONDS / 1000 / timeUnitSeconds * boundedSpeed;
      const boundedUnitsPerFixedStep = Math.min(
        unitsPerFixedStep,
        MAX_ENGINE_TICK_UNITS * MAX_ENGINE_TICKS_PER_FIXED_STEP
      );
      let engineTicks = 0;
      let unitsAdvanced = 0;

      for (let fixedStep = 0; fixedStep < fixedSteps; fixedStep += 1) {
        let remainingUnits = boundedUnitsPerFixedStep;
        while (remainingUnits > EPSILON) {
          const units = Math.min(MAX_ENGINE_TICK_UNITS, remainingUnits);
          tick(units);
          engineTicks += 1;
          unitsAdvanced += units;
          remainingUnits -= units;
        }
      }

      return result(fixedSteps, engineTicks, unitsAdvanced, pendingMilliseconds);
    },
    reset() {
      pendingMilliseconds = 0;
    },
    read() {
      return Object.freeze({
        schemaVersion: 1,
        fixedHz: FIXED_SIMULATION_HZ,
        pendingMilliseconds
      });
    }
  };

  return Object.freeze(clock);
}

function result(fixedSteps, engineTicks, unitsAdvanced, pendingMilliseconds) {
  return Object.freeze({
    schemaVersion: 1,
    fixedSteps,
    engineTicks,
    unitsAdvanced,
    pendingMilliseconds
  });
}
