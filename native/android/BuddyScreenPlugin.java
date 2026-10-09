package com.mrtuik.studybuddy;

import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;

/** Captures ONLY this app's own window (PixelCopy, no permission needed) as a small JPEG for Buddy. */
@CapacitorPlugin(name = "BuddyScreen")
public class BuddyScreenPlugin extends Plugin {

    @PluginMethod
    public void capture(final PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Android 8 or newer is needed");
            return;
        }
        final int maxSide = Math.max(256, call.getInt("maxSide", 768));
        final int quality = Math.min(95, Math.max(30, call.getInt("quality", 60)));
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final Window window = getActivity().getWindow();
                    View v = window.getDecorView();
                    int w = v.getWidth(), h = v.getHeight();
                    if (w <= 0 || h <= 0) { call.reject("No window"); return; }
                    float k = Math.min(1f, maxSide / (float) Math.max(w, h));
                    final Bitmap bmp = Bitmap.createBitmap(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), Bitmap.Config.ARGB_8888);
                    PixelCopy.request(window, null, bmp, new PixelCopy.OnPixelCopyFinishedListener() {
                        @Override
                        public void onPixelCopyFinished(int result) {
                            try {
                                if (result != PixelCopy.SUCCESS) { call.reject("Capture failed (" + result + ")"); return; }
                                ByteArrayOutputStream out = new ByteArrayOutputStream();
                                bmp.compress(Bitmap.CompressFormat.JPEG, quality, out);
                                JSObject r = new JSObject();
                                r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                                r.put("width", bmp.getWidth());
                                r.put("height", bmp.getHeight());
                                r.put("grid", grid(bmp));
                                bmp.recycle();
                                call.resolve(r);
                            } catch (Exception e) {
                                call.reject("Capture failed: " + e.getMessage());
                            }
                        }
                    }, new Handler(Looper.getMainLooper()));
                } catch (Exception e) {
                    call.reject("Capture failed: " + e.getMessage());
                }
            }
        });
    }

    /** 24x24 brightness fingerprint (one hex char per cell) so the app can tell whether the screen really changed */
    private static String grid(Bitmap b) {
        StringBuilder sb = new StringBuilder(576);
        for (int y = 0; y < 24; y++) {
            for (int x = 0; x < 24; x++) {
                int p = b.getPixel(Math.min(b.getWidth() - 1, x * b.getWidth() / 24 + b.getWidth() / 48),
                                   Math.min(b.getHeight() - 1, y * b.getHeight() / 24 + b.getHeight() / 48));
                int lum = (((p >> 16) & 255) * 3 + ((p >> 8) & 255) * 6 + (p & 255)) / 10;
                sb.append(Integer.toHexString(lum >> 4));
            }
        }
        return sb.toString();
    }
}
