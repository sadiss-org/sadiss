package net.sadiss.playbackservice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the app's process, and with it the WebView that plays the performance,
 * running while the screen is locked. Without a foreground service Android treats
 * a locked app as cached and reclaims it within minutes.
 *
 * The type is mediaPlayback because that is what the app does, and it is one of
 * the types Android lets run for as long as its notification shows.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID = "playback";
    private static final String CHANNEL_NAME = "Performance playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String TITLE = "SADISS is playing";
    private static final String TEXT = "Keep the app open until the performance ends";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);

        // Service types exist from Android 10; before that a foreground service has none.
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type);

        // A service restarted after Android killed the app has no WebView to keep playing.
        return START_NOT_STICKY;
    }

    private Notification notification() {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(TITLE)
            .setContentText(TEXT)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE);

        // Tapping the notification brings the app back to the front.
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
