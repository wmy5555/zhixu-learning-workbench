package io.github.wmy5555.zhixu.sharedtest;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZhixuLocalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
