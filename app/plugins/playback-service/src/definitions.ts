export interface PlaybackServicePlugin {
  /**
   * Starts the foreground service and its notification. The service runs until
   * the app's activity is destroyed. On Android 13 and later it then asks for
   * permission to show the notification on every call while that permission is
   * not granted, and resolves when the user answers; the service runs either way.
   * The app calls it at each run's join, so it asks at each join until allowed,
   * and Android stops showing the dialog after the second denial. Rejects when
   * Android refuses to start the service.
   */
  start(): Promise<void>
}
