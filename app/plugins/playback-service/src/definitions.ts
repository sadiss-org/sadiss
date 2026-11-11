export interface PlaybackServicePlugin {
  /**
   * Starts the foreground service and its notification. The service runs until
   * the app's activity is destroyed. On Android 13 and later it then asks once
   * for permission to show the notification, and resolves when the user answers;
   * the service runs either way. Rejects when Android refuses to start the service.
   */
  start(): Promise<void>
}
