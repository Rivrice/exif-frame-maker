package io.github.rivrice.exifframe;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * ほかのアプリ（Photo Tile Maker やギャラリーなど）から「共有」で渡された画像を受け取る。
 * take() で受け取った画像を返し、アプリを開いている間に新しく届いたら "received" を通知する。
 */
@CapacitorPlugin(name = "IncomingImage")
public class IncomingImagePlugin extends Plugin {
    private static final int MAX_FILES = 20;

    private static boolean isShare(Intent intent) {
        if (intent == null) return false;
        String a = intent.getAction();
        return Intent.ACTION_SEND.equals(a) || Intent.ACTION_SEND_MULTIPLE.equals(a);
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> urisOf(Intent intent) {
        List<Uri> out = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri u = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) out.add(u);
        } else {
            ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) out.addAll(list);
        }
        return out.size() > MAX_FILES ? out.subList(0, MAX_FILES) : out;
    }

    private String nameOf(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Throwable ignored) {
            // 名前が取れなくても読み込みは続ける
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "shared.jpg";
    }

    @PluginMethod
    public void take(PluginCall call) {
        Intent intent = getActivity().getIntent();
        if (!isShare(intent)) {
            JSObject ret = new JSObject();
            ret.put("files", new JSArray());
            call.resolve(ret);
            return;
        }
        final List<Uri> uris = urisOf(intent);
        // 同じ画像を二度読み込まないよう、受け取り済みにする
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        new Thread(() -> {
            JSArray files = new JSArray();
            ContentResolver cr = getContext().getContentResolver();
            for (Uri uri : uris) {
                try (InputStream in = cr.openInputStream(uri)) {
                    if (in == null) continue;
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
                    JSObject f = new JSObject();
                    f.put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
                    f.put("name", nameOf(cr, uri));
                    String type = cr.getType(uri);
                    f.put("mime", type != null ? type : "image/jpeg");
                    files.put(f);
                } catch (Throwable ignored) {
                    // 読めなかった画像は飛ばす
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        }).start();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isShare(intent)) return;
        getActivity().setIntent(intent);
        notifyListeners("received", new JSObject(), true);
    }
}
