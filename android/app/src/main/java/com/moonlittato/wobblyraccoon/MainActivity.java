package com.moonlittato.wobblyraccoon;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Keeps the game genuinely full screen.
 *
 * Setting android:windowFullscreen in styles.xml is not enough: that flag sits
 * on the splash theme, and Capacitor swaps the activity over to
 * AppTheme.NoActionBar once the splash is done, which brings the status bar
 * back. Newer Android versions also ignore the old flag. Hiding the bars
 * through the insets controller works in both cases, and re-applying it on
 * focus keeps them hidden after a swipe or after returning from another app.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        controller.hide(WindowInsetsCompat.Type.systemBars());
        // a swipe brings them back briefly, then they slide away again
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
