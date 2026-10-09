package com.mrtuik.studybuddy;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Asks for the microphone with the normal Android dialog, so the user never has to go to Settings. */
@CapacitorPlugin(
    name = "BuddyMic",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class BuddyMicPlugin extends Plugin {

    @PluginMethod
    public void ask(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            reply(call);
        } else {
            requestPermissionForAlias("microphone", call, "micResult");
        }
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        reply(call);
    }

    private void reply(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** only needed when the user pressed "Don't allow" twice and Android stops showing the dialog */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
