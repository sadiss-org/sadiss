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

/** Starts and stops {@link PlaybackService}; it never outlives the app's activity. */
@CapacitorPlugin(
    name = "PlaybackService",
    permissions = { @Permission(alias = PlaybackServicePlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class PlaybackServicePlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    @PluginMethod
    public void start(PluginCall call) {
        // From Android 13 a notification needs the user's permission. The service
        // runs without it; only its notification stays hidden.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "notificationsAnswered");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        try {
            ContextCompat.startForegroundService(getContext(), serviceIntent());
            call.resolve();
        } catch (RuntimeException refused) {
            call.reject(refused.getMessage(), refused);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(serviceIntent());
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
