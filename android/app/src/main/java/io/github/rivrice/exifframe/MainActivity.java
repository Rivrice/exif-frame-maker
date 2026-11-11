package io.github.rivrice.exifframe;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HeicConverterPlugin.class);
        registerPlugin(IncomingImagePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
