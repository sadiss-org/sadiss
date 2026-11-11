package net.sadiss.playbackservice;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Starts {@link PlaybackService}, which runs until the app's activity is destroyed. */
@CapacitorPlugin(
    name = "PlaybackService",
    permissions = { @Permission(alias = PlaybackServicePlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class PlaybackServicePlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    @PluginMethod
    public void start(PluginCall call) {
        try {
            ContextCompat.startForegroundService(getContext(), serviceIntent());
        } catch (RuntimeException refused) {
            call.reject(refused.getMessage(), refused);
            return;
        }
        // From Android 13 a notification needs the user's permission. The service
        // already runs without it, so a phone locked before the user answers is
        // kept running too; only the notification stays hidden until it is granted.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "notificationsAnswered");
            return;
        }
        call.resolve();
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        getContext().stopService(serviceIntent());
    }

    private Intent serviceIntent() {
        return new Intent(getContext(), PlaybackService.class);
    }
}
