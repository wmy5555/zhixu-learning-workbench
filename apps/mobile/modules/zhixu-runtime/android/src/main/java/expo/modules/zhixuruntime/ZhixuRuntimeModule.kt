package expo.modules.zhixuruntime

import android.system.ErrnoException
import android.system.OsConstants
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.security.SecureRandom
import java.util.UUID

class ZhixuRuntimeModule : Module() {
  private val files by lazy {
    val context = appContext.reactContext ?: throw RuntimeFailure("NOT_READY", "应用尚未就绪")
    NativeFiles(File(context.noBackupFilesDir, "Zhixu"))
  }
  private val secrets = DeviceSecrets()
  private val network = PinnedNetwork()
  private val random = SecureRandom()

  override fun definition() = ModuleDefinition {
    Name("ZhixuRuntime")
    Constant("root") { files.root.absolutePath }
    Constant("platform") { "android" }
    Function("uuid") { UUID.randomUUID().toString() }
    Function("random") { count: Int ->
      require(count in 1..4096)
      val bytes = ByteArray(count).also { random.nextBytes(it) }
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
    Function("files") { operation: String, input: String ->
      try {
        JSONObject().put("value", JSONObject.wrap(files.call(operation, JSONObject(input)))).toString()
      } catch (error: Exception) {
        val code = when (error) {
          is RuntimeFailure -> error.code
          is ErrnoException -> when (error.errno) {
            OsConstants.ENOENT -> "ENOENT"
            OsConstants.EEXIST -> "EEXIST"
            OsConstants.EACCES -> "EACCES"
            OsConstants.ENOTDIR -> "ENOTDIR"
            OsConstants.EISDIR -> "EISDIR"
            else -> "IO_ERROR"
          }
          else -> "IO_ERROR"
        }
        PinnedNetwork.failure(code, "本地文件操作失败（$code），请保留草稿后重试。")
      }
    }
    Function("sealSecret") { value: String -> secrets.seal(value) }
    Function("openSecret") { value: String -> secrets.open(value) }
    AsyncFunction("resolve") { hostname: String ->
      require(hostname.length in 1..253 && hostname.none { it <= ' ' || it == '/' || it == '\\' })
      InetAddress.getAllByName(hostname).map { mapOf("address" to it.hostAddress, "family" to if (it is Inet4Address) 4 else 6) }
    }
    AsyncFunction("request") { id: String, input: String, promise: Promise ->
      try { network.request(id, JSONObject(input)) { promise.resolve(it) } }
      catch (_: Exception) { promise.resolve(PinnedNetwork.failure("INVALID_URL", "网络请求参数无效")) }
    }
    Function("cancel") { id: String -> network.cancel(id); Unit }
    OnDestroy { network.close() }
  }
}
