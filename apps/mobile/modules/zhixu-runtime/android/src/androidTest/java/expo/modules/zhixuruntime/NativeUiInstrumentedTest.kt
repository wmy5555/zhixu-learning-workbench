package expo.modules.zhixuruntime

import android.content.Intent
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Opt-in device acceptance against the isolated candidate only. Uses synthetic
 * text and never clears app data or enables an external provider. */
@RunWith(AndroidJUnit4::class)
class NativeUiInstrumentedTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val device = UiDevice.getInstance(instrumentation)
  private val packageName = "com.zhixu.learning.nativeapp"
  private fun find(selector: BySelector): UiObject2 {
    repeat(8) {
      device.findObject(selector)?.let { return it }
      val scroll = device.findObjects(By.scrollable(true)).maxByOrNull {
        it.visibleBounds.width() * it.visibleBounds.height()
      }
      scroll?.scroll(Direction.DOWN, 0.7f)
      device.waitForIdle()
    }
    return device.wait(Until.findObject(selector), 5000) ?: throw AssertionError("Missing control: $selector")
  }
  private fun click(text: String, bottom: Boolean = false) {
    val selector = if (device.hasObject(By.desc(text))) By.desc(text) else By.text(text)
    find(selector)
    val deadline = SystemClock.elapsedRealtime() + 30000
    var pressed = false
    while (!pressed && SystemClock.elapsedRealtime() < deadline) {
      val nodes = device.findObjects(selector)
      var target = if (bottom) nodes.maxByOrNull { it.visibleBounds.bottom } else nodes.firstOrNull()
      repeat(6) { if (target != null && !target!!.isClickable) target = target!!.parent }
      if (target?.isEnabled == true && target?.isClickable == true) {
        target!!.click(); pressed = true
      } else SystemClock.sleep(100)
    }
    assertTrue("Control did not become enabled: $text", pressed)
    device.waitForIdle()
  }
  private fun launch() {
    val intent = Intent().setClassName(packageName, "$packageName.MainActivity")
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    instrumentation.context.startActivity(intent)
    assertTrue("Workbench did not become ready", device.wait(Until.hasObject(By.textContains("今日预算")), 25000))
  }
  private fun enter(label: String, value: String) {
    val field = find(By.desc(label))
    field.click()
    device.executeShellCommand("input keycombination KEYCODE_CTRL_LEFT KEYCODE_A")
    // Real keyboard events exercise React Native's change handler. Unicode
    // input has a separate device acceptance; keep this driver IME-independent.
    require(value.matches(Regex("[A-Za-z0-9 ._-]+")))
    device.executeShellCommand("input text " + value.replace(" ", "%s"))
    assertTrue("Input was not applied: $label", device.wait(Until.hasObject(By.desc(label).text(value)), 5000))
  }
  private fun hideKeyboard() {
    if (Regex("mInputShown=true\\b").containsMatchIn(device.executeShellCommand("dumpsys input_method"))) {
      device.pressBack()
      device.waitForIdle()
    }
  }
  @Test fun offlineCaptureEditBackAndRestart() {
    val output = File(instrumentation.targetContext.getExternalFilesDir(null), "zhixu-native-acceptance").apply { mkdirs() }
    val started = SystemClock.elapsedRealtime()
    device.executeShellCommand("am force-stop $packageName")
    launch()
    val readyMs = SystemClock.elapsedRealtime() - started
    assertTrue(device.takeScreenshot(File(output, "01-today.png")))
    val title = "Native-acceptance-" + System.currentTimeMillis()
    val body = "Offline synthetic source. Keep the original input."
    click("收集", bottom = true)
    enter("标题", title)
    enter("原始资料", body)
    File(output, "input.json").writeText(JSONObject().put("expectedTitle", title).put("expectedBody", body).toString())
    device.takeScreenshot(File(output, "00-entered-input.png"))
    hideKeyboard()
    click("保存原文")
    assertTrue("Capture must navigate to the reader", device.wait(Until.hasObject(By.text("阅读")), 30000))
    assertTrue("Saved title differs from entered input: $title", device.wait(Until.hasObject(By.text(title)), 15000))
    assertTrue(device.wait(Until.hasObject(By.textContains("Offline synthetic source")), 15000))
    assertTrue(device.takeScreenshot(File(output, "02-saved-note.png")))
    click("编辑")
    enter("正文", body + " Unsaved synthetic edit.")
    hideKeyboard()
    device.pressBack()
    assertTrue("Dirty edit must require a decision", device.wait(Until.hasObject(By.text("继续编辑")), 5000))
    click("继续编辑")
    assertTrue(device.takeScreenshot(File(output, "03-draft-preserved.png")))
    hideKeyboard()
    device.pressBack()
    click("放弃修改")
    device.executeShellCommand("am force-stop $packageName")
    launch()
    click("知识库", bottom = true)
    assertTrue("Saved source must survive process restart", device.wait(Until.hasObject(By.text(title)), 15000))
    click(title)
    assertFalse(device.hasObject(By.textContains("Unsaved synthetic edit.")))
    assertTrue(device.takeScreenshot(File(output, "04-reopened.png")))
    File(output, "result.json").writeText(JSONObject().put("synthetic", true)
      .put("initialReadyMs", readyMs).put("capturedTitle", title)
      .put("scope", "offline capture, native read, discard decision, process restart").toString())
  }
}
