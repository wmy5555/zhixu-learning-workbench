package expo.modules.zhixuruntime

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class PinnedNetworkTest {
  private lateinit var server: MockWebServer
  private lateinit var network: PinnedNetwork
  @Before fun setup() { server = MockWebServer(); server.start(); network = PinnedNetwork() }
  @After fun cleanup() { network.close(); server.shutdown() }
  private fun input() = JSONObject().put("hostname", "127.0.0.1").put("protocol", "http:")
    .put("port", server.port).put("method", "GET").put("path", "/evidence")
    .put("body", "").put("headers", JSONObject().put("host", "approved.invalid:${server.port}"))
  private fun request(args: JSONObject = input(), id: String = "test"): JSONObject {
    val result = CompletableFuture<String>()
    network.request(id, args) { result.complete(it) }
    return JSONObject(result.get(15, TimeUnit.SECONDS))
  }
  @Test fun usesOnlyPinnedAddressAndOriginalHost() {
    server.enqueue(MockResponse().setBody("verified"))
    assertEquals(200, request().getInt("status"))
    val recorded = server.takeRequest(2, TimeUnit.SECONDS)!!
    assertEquals("approved.invalid:${server.port}", recorded.getHeader("Host"))
    assertEquals("identity", recorded.getHeader("Accept-Encoding"))
    assertEquals("/evidence", recorded.path)
  }
  @Test fun doesNotFollowRedirectsOrPersistCookies() {
    server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", server.url("/private"))
      .addHeader("Set-Cookie", "session=synthetic"))
    server.enqueue(MockResponse().setBody("second"))
    assertEquals(302, request().getInt("status"))
    assertEquals(1, server.requestCount)
    assertEquals(200, request(id = "second").getInt("status"))
    server.takeRequest()
    assertNull(server.takeRequest().getHeader("Cookie"))
  }
  @Test fun interruptedChargeableRequestIsNotRetried() {
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
    val args = input().put("method", "POST").put("body", "c3ludGhldGlj")
    assertTrue(request(args).has("error"))
    assertEquals(1, server.requestCount)
  }
  @Test fun rejectsOversizedResponseBeforeReadingIt() {
    server.enqueue(MockResponse().setHeader("Content-Length", PinnedNetwork.MAX_BODY + 1))
    assertEquals("RESPONSE_TOO_LARGE", request().getJSONObject("error").getString("code"))
  }
  @Test fun earlyCancellationPreventsSending() {
    network.cancel("early")
    assertEquals("CANCELLED", request(id = "early").getJSONObject("error").getString("code"))
    assertEquals(0, server.requestCount)
  }
  @Test fun rejectsUnpinnedNamesAndHeaderInjection() {
    assertEquals("INVALID_URL", request(input().put("hostname", "localhost")).getJSONObject("error").getString("code"))
    val args = input()
    args.getJSONObject("headers").put("Authorization", "synthetic\r\nInjected: yes")
    assertEquals("INVALID_URL", request(args).getJSONObject("error").getString("code"))
    assertEquals(0, server.requestCount)
  }
}
