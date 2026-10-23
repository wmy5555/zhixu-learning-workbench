package expo.modules.zhixuruntime

import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.ByteString.Companion.decodeBase64
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** The core has already authorized/resolved the target. Dial only that literal
 * address, while OkHttp validates the system trust chain and original hostname.
 * Never retry a chargeable operation, follow redirects, or share cookies. */
internal class PinnedNetwork {
  private val calls = ConcurrentHashMap<String, Call>()
  // cancel() is synchronous but Expo's request() dispatch is asynchronous. Keep
  // bounded early cancellations so cancellation cannot race request registration.
  private val earlyCancelled = LinkedHashSet<String>()
  private val lock = Any()
  private var closed = false
  private val pool = ConnectionPool(0, 1, TimeUnit.SECONDS)
  private val base = OkHttpClient.Builder()
    .proxy(Proxy.NO_PROXY).cookieJar(CookieJar.NO_COOKIES).cache(null)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .protocols(listOf(Protocol.HTTP_1_1)).connectionPool(pool)
    .connectTimeout(30, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS)
    .writeTimeout(180, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()

  internal fun create(args: JSONObject): Call {
    val ip = args.getString("hostname")
    val ipv4 = Regex("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}").matches(ip) && ip.split('.').all { it.toInt() <= 255 }
    val ipv6 = ip.contains(':') && Regex("[a-fA-F0-9:.]+").matches(ip)
    require(ipv4 || ipv6) { "A literal address is required" }
    val pinned = InetAddress.getByName(ip)
    val scheme = when (args.getString("protocol")) { "https:" -> "https"; "http:" -> "http"; else -> error("Invalid protocol") }
    val headers = args.getJSONObject("headers")
    val authority = headers.getString("host")
    val requestPath = args.optString("path", "/")
    require(requestPath.startsWith('/') && !requestPath.startsWith("//") && requestPath.none { it <= ' ' || it == '\\' })
    val url = "$scheme://$authority$requestPath".toHttpUrl()
    require(url.username.isEmpty() && url.password.isEmpty() && url.fragment == null)
    require(url.port == args.getInt("port"))
    if (args.has("servername")) require(args.getString("servername").equals(url.host, true))
    val method = args.optString("method", "GET")
    require(method == "GET" || method == "POST")
    val bytes = args.optString("body", "").decodeBase64()?.toByteArray() ?: error("Invalid body")
    require(bytes.size <= 2 * 1024 * 1024 && (method != "GET" || bytes.isEmpty()))
    val request = Request.Builder().url(url)
    val filtered = setOf("host", "content-length", "connection", "transfer-encoding", "accept-encoding", "proxy-authorization")
    headers.keys().forEach { name ->
      require(Regex("[A-Za-z0-9-]+").matches(name))
      val value = headers.getString(name)
      require(value.none { it == '\r' || it == '\n' || it == '\u0000' })
      if (name.lowercase() !in filtered) request.header(name, value)
    }
    request.header("Accept-Encoding", "identity").header("Connection", "close")
      .method(method, if (method == "POST") bytes.toRequestBody(null) else null)
    val client = base.newBuilder().dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        if (!hostname.equals(url.host, true)) throw IOException("Unexpected hostname")
        return listOf(pinned)
      }
    }).build()
    return client.newCall(request.build())
  }

  fun request(id: String, args: JSONObject, completion: (String) -> Unit) {
    val call = try { create(args) } catch (_: Exception) {
      completion(failure("INVALID_URL", "网络请求参数无效")); return
    }
    synchronized(lock) {
      if (closed || earlyCancelled.remove(id)) {
        completion(failure("CANCELLED", "请求已取消")); return
      }
      if (calls.putIfAbsent(id, call) != null) {
        completion(failure("DUPLICATE_REQUEST", "请求正在执行")); return
      }
    }
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) {
        calls.remove(id, call)
        completion(failure(if (call.isCanceled()) "CANCELLED" else "NETWORK_ERROR",
          if (call.isCanceled()) "请求已取消" else "无法完成通过验证的网络请求"))
      }
      override fun onResponse(call: Call, response: Response) {
        val result = try {
          response.use {
            require(it.header("content-encoding", "identity").equals("identity", true))
            val body = it.body ?: throw IOException("Missing response body")
            if (body.contentLength() > MAX_BODY) throw RuntimeFailure("RESPONSE_TOO_LARGE", "外部响应超过大小限制")
            val bytes = ByteArrayOutputStream()
            body.byteStream().use { input ->
              val buffer = ByteArray(16384)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (bytes.size() + count > MAX_BODY) throw RuntimeFailure("RESPONSE_TOO_LARGE", "外部响应超过大小限制")
                bytes.write(buffer, 0, count)
              }
            }
            val resultHeaders = JSONObject()
            it.headers.names().forEach { name -> resultHeaders.put(name.lowercase(), it.headers.values(name).joinToString(", ")) }
            JSONObject().put("status", it.code).put("headers", resultHeaders)
              .put("body", bytes.toByteArray().toByteString().base64()).toString()
          }
        } catch (error: Exception) {
          failure((error as? RuntimeFailure)?.code ?: "INVALID_RESPONSE", "未能完整接收有效响应")
        }
        calls.remove(id, call)
        // Once a complete response is received, preserve it even if a late cancel
        // races completion. The core ledger needs that evidence to settle costs.
        completion(result)
      }
    })
  }

  fun cancel(id: String) = synchronized(lock) {
    val call = calls[id]
    if (call != null) call.cancel() else {
      earlyCancelled.add(id)
      if (earlyCancelled.size > 256) earlyCancelled.remove(earlyCancelled.first())
    }
  }
  fun close() = synchronized(lock) {
    closed = true
    calls.values.forEach { it.cancel() }
    calls.clear(); earlyCancelled.clear(); pool.evictAll()
  }
  companion object {
    const val MAX_BODY = 3 * 1024 * 1024
    fun failure(code: String, message: String) = JSONObject().put("error", JSONObject().put("code", code).put("message", message)).toString()
  }
}
