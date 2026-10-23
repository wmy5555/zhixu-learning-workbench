package expo.modules.zhixuruntime

import android.system.Os
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class RuntimeInstrumentedTest {
  private lateinit var files: NativeFiles
  private lateinit var root: File
  private val alias = "zhixu.synthetic.test." + UUID.randomUUID()
  @Before fun setup() {
    root = File(InstrumentationRegistry.getInstrumentation().targetContext.noBackupFilesDir, "test-" + UUID.randomUUID())
    files = NativeFiles(root)
  }
  @After fun cleanup() {
    root.deleteRecursively()
    KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
  }
  private fun args(name: String) = JSONObject().put("path", File(root, name).path)
  private fun write(name: String, body: String, exclusive: Boolean = false) = files.call("write",
    args(name).put("data", Base64.encodeToString(body.toByteArray(), Base64.NO_WRAP)).put("exclusive", exclusive))
  @Test fun storesUnicodeAndRetainsExclusiveWrites() {
    write("原文.md", "合成资料\n保留原文", true)
    try { write("原文.md", "不应覆盖", true); fail("must reject") } catch (_: android.system.ErrnoException) { }
    assertEquals("合成资料\n保留原文", File(root, "原文.md").readText())
    files.call("rename", args("原文.md").put("to", File(root, "版本.md").path))
    assertFalse(File(root, "原文.md").exists())
    assertEquals("合成资料\n保留原文", File(root, "版本.md").readText())
    val metadata = files.call("stat", args("版本.md")) as Map<*, *>
    assertTrue((metadata["ino"] as String).toLong() > 0)
    assertTrue((metadata["mtimeNs"] as String).toLong() > 0)
    assertTrue((metadata["ctimeNs"] as String).toLong() > 0)
  }
  @Test fun refusesTraversalAndSymbolicLinks() {
    val outside = File(root.parentFile, "outside-" + UUID.randomUUID()).apply { writeText("untouched") }
    try {
      try { files.checked(File(root, "../" + outside.name).path); fail("must reject") } catch (_: RuntimeFailure) { }
      Os.symlink(outside.path, File(root, "link").path)
      try { files.call("read", args("link")); fail("must reject") } catch (_: RuntimeFailure) { }
      try { files.call("write", args("link").put("data", "")); fail("must reject") } catch (_: RuntimeFailure) { }
      assertEquals("untouched", outside.readText())
      assertEquals("symlink", (files.call("stat", args("link").put("follow", false)) as Map<*, *>)["kind"])
    } finally { outside.delete() }
  }
  @Test fun reportsHardLinksAndProtectsRoot() {
    write("one", "synthetic")
    files.call("link", args("one").put("to", File(root, "two").path))
    assertEquals(2L, ((files.call("stat", args("one")) as Map<*, *>)["nlink"] as Number).toLong())
    try { files.call("remove", JSONObject().put("path", root.path).put("recursive", true)); fail("must reject") }
    catch (_: RuntimeFailure) { }
  }
  @Test fun keystoreRoundTripRejectsTamperingAndMissingKeys() {
    val secrets = DeviceSecrets(alias)
    val a = secrets.seal("合成凭据")
    val b = secrets.seal("合成凭据")
    assertNotEquals(a, b)
    assertEquals("合成凭据", secrets.open(a))
    val tampered = Base64.decode(a, Base64.DEFAULT)
    tampered[tampered.lastIndex] = (tampered.last().toInt() xor 1).toByte()
    try { secrets.open(Base64.encodeToString(tampered, Base64.NO_WRAP)); fail("must reject") } catch (_: RuntimeFailure) { }
    KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    try { secrets.open(a); fail("must reject") } catch (_: RuntimeFailure) { }
  }
  @Test fun repeatedIOReleasesOwnedDescriptors() {
    val before = File("/proc/self/fd").list()!!.size
    repeat(200) {
      write("repeated.md", "合成内容 $it")
      files.call("read", args("repeated.md"))
    }
    val after = File("/proc/self/fd").list()!!.size
    assertTrue("Descriptor growth: $before -> $after", after <= before + 8)
  }
  @Test fun checkedReadBatchSkipsLinksAndRefreshesChangedFiles() {
    write("原文.md", "合成原文甲")
    write(".hidden.md", "hidden")
    write("ignored.txt", "not markdown")
    val outside = File(root.parentFile, "outside-" + UUID.randomUUID()).apply { writeText("outside") }
    try {
      Os.symlink(outside.path, File(root, "escape.md").path)
      val input = JSONObject().put("path", root.path)
      val first = (files.call("scan", input) as List<*>).single() as Map<*, *>
      assertEquals("合成原文甲", String(Base64.decode(first["base64"] as String, Base64.DEFAULT), Charsets.UTF_8))
      input.put("fingerprints", JSONObject().put(first["file"] as String, first["fingerprint"]))
      val same = (files.call("scan", input) as List<*>).single() as Map<*, *>
      assertFalse(same.containsKey("base64"))
      Thread.sleep(if (android.os.Build.VERSION.SDK_INT >= 27) 5 else 1100)
      write("原文.md", "合成原文乙")
      val changed = (files.call("scan", input) as List<*>).single() as Map<*, *>
      assertNotEquals(first["fingerprint"], changed["fingerprint"])
      assertEquals("合成原文乙", String(Base64.decode(changed["base64"] as String, Base64.DEFAULT), Charsets.UTF_8))
      assertEquals("outside", outside.readText())
      try { files.call("scan", args("escape.md")); fail("must reject link root") } catch (_: RuntimeFailure) { }
    } finally { outside.delete() }
  }
}
