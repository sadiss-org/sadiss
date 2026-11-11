export interface PlaybackServicePlugin {
  /**
   * Starts the foreground service and its notification. On Android 13 and later
   * it first asks once for permission to show notifications; the service runs
   * either way. Rejects when Android refuses to start the service.
   */
  start(): Promise<void>
  /** Stops the foreground service and removes its notification. */
  stop(): Promise<void>
}
