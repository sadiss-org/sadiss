import { createMeasurementService, systemClock } from './measurementService'
import { performanceLogFiles } from './performanceLogFiles'

/**
 * The composed, application-wide clock-sync service: real system clock, cadence
 * sourced from the environment. Cadence is tunable at runtime via
 * `measurementService.setConfig(...)` and pushed to devices, so it can change
 * without an app rebuild.
 */
const intervalMs = Number(process.env.MEASUREMENT_INTERVAL_MS) || 3000

export const measurementService = createMeasurementService({
  clock: systemClock,
  config: { intervalMs },
  // Phones report only while there is a log to keep their reports in; PHONE_REPORTS=off stops them even then.
  reportsWanted: () => performanceLogFiles.writing() && process.env.PHONE_REPORTS !== 'off'
})
