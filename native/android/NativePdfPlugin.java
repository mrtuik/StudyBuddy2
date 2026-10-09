package com.mrtuik.studybuddy;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native PDF rendering with android.graphics.pdf.PdfRenderer.
 * Used for DOWNLOADED books only: opens instantly (no parsing in JS) and renders pages to cached JPEG files.
 */
@CapacitorPlugin(name = "NativePdf")
public class NativePdfPlugin extends Plugin {
    private static final long MAX_PIXELS = 12_000_000L;

    private final Object lock = new Object();
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private ParcelFileDescriptor pfd;
    private PdfRenderer renderer;
    private int session = 0;

    private File cacheDir() {
        File d = new File(getContext().getCacheDir(), "nativepdf");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private void closeInternal() {
        try { if (renderer != null) renderer.close(); } catch (Exception ignored) { }
        try { if (pfd != null) pfd.close(); } catch (Exception ignored) { }
        renderer = null;
        pfd = null;
    }

    private void clearCache() {
        File[] files = cacheDir().listFiles();
        if (files != null) for (File f : files) f.delete();
    }

    @PluginMethod
    public void open(final PluginCall call) {
        final String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) { call.reject("uri required"); return; }
        exec.execute(() -> {
            synchronized (lock) {
                try {
                    closeInternal();
                    clearCache();
                    session++;
                    String path = uri.startsWith("file:") ? Uri.parse(uri).getPath() : uri;
                    if (path == null) throw new IllegalArgumentException("Bad path");
                    pfd = ParcelFileDescriptor.open(new File(path), ParcelFileDescriptor.MODE_READ_ONLY);
                    renderer = new PdfRenderer(pfd);
                    JSObject ret = new JSObject();
                    ret.put("pages", renderer.getPageCount());
                    try {
                        PdfRenderer.Page p0 = renderer.openPage(0);
                        ret.put("ratio", (double) p0.getHeight() / Math.max(1, p0.getWidth()));
                        p0.close();
                    } catch (Exception ignored) { }
                    call.resolve(ret);
                } catch (Exception e) {
                    closeInternal();
                    call.reject("Cannot open PDF: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void renderPage(final PluginCall call) {
        final Integer page = call.getInt("page");
        final Integer width = call.getInt("width");
        if (page == null || width == null || width < 50) { call.reject("page and width required"); return; }
        exec.execute(() -> {
            synchronized (lock) {
                if (renderer == null) { call.reject("PDF not open"); return; }
                PdfRenderer.Page p = null;
                Bitmap bmp = null;
                try {
                    int idx = page - 1;
                    if (idx < 0 || idx >= renderer.getPageCount()) { call.reject("Bad page"); return; }
                    p = renderer.openPage(idx);
                    float pw = Math.max(1, p.getWidth());
                    float ph = Math.max(1, p.getHeight());
                    int bw = width;
                    int bh = Math.round(bw * ph / pw);
                    if ((long) bw * bh > MAX_PIXELS) {
                        double s = Math.sqrt((double) MAX_PIXELS / ((double) bw * bh));
                        bw = Math.max(50, (int) (bw * s));
                        bh = Math.max(50, (int) (bh * s));
                    }
                    File out = new File(cacheDir(), "s" + session + "_p" + page + "_w" + bw + ".jpg");
                    if (!out.exists() || out.length() == 0) {
                        // keep the cache small: drop this page's images made for other zoom levels
                        File[] old = cacheDir().listFiles();
                        if (old != null) for (File f : old) if (f.getName().startsWith("s" + session + "_p" + page + "_w")) f.delete();
                        bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);
                        bmp.eraseColor(Color.WHITE);
                        p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        File tmp = new File(out.getPath() + ".tmp");
                        try (FileOutputStream fos = new FileOutputStream(tmp)) {
                            bmp.compress(Bitmap.CompressFormat.JPEG, 90, fos);
                        }
                        if (!tmp.renameTo(out)) throw new Exception("Could not write page image");
                    }
                    JSObject ret = new JSObject();
                    ret.put("uri", "file://" + out.getAbsolutePath());
                    ret.put("width", bw);
                    ret.put("height", bh);
                    call.resolve(ret);
                } catch (Throwable e) {
                    call.reject("Render failed: " + e.getMessage());
                } finally {
                    if (p != null) { try { p.close(); } catch (Exception ignored) { } }
                    if (bmp != null) bmp.recycle();
                }
            }
        });
    }

    @PluginMethod
    public void close(final PluginCall call) {
        exec.execute(() -> {
            synchronized (lock) {
                closeInternal();
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (lock) { closeInternal(); }
        exec.shutdown();
    }
}
