package io.github.wmy5555.zhixu.sharedtest;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.test.AndroidTestCase;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONObject;

/** Exercises synthetic streams only, without opening a picker or touching installed source data. */
@SuppressWarnings("deprecation")
public class SourceDocumentFilesTest extends AndroidTestCase {
    public void testUtf8BomAndShortReadsPreserveOriginalText() throws Exception {
        String text = "# 合成资料\n\n原文  \n第二行😀\n";
        byte[] bytes = ("\ufeff" + text).getBytes(StandardCharsets.UTF_8);
        InputStream stream = new ByteArrayInputStream(bytes) {
            private boolean first = true;
            @Override public synchronized int read(byte[] buffer, int offset, int length) {
                if (first) { first = false; return 0; }
                return super.read(buffer, offset, Math.min(1, length));
            }
        };
        assertEquals(text, SourceDocumentFiles.readUtf8(stream, bytes.length));
    }

    public void testInvalidUtf8AndEmptyDocumentsAreRejected() throws Exception {
        rejectText(new byte[] { (byte) 0xc0, (byte) 0xaf }, "VALIDATION");
        rejectText(new byte[] { (byte) 0xe4, (byte) 0xb8 }, "VALIDATION");
        rejectText(new byte[] { (byte) 0xed, (byte) 0xa0, (byte) 0x80 }, "VALIDATION");
        rejectText("\ufeff \r\n\t".getBytes(StandardCharsets.UTF_8), "VALIDATION");
        rejectText(new byte[0], "VALIDATION");
    }

    public void testBoundedReadAcceptsExactLimitAndStopsAtOneExtraByte() throws Exception {
        byte[] exact = new byte[SourceDocumentFiles.MAX_SOURCE_BYTES];
        Arrays.fill(exact, (byte) 'x');
        assertEquals(exact.length, SourceDocumentFiles.readUtf8(new ByteArrayInputStream(exact), exact.length).length());
        final int[] consumed = { 0 };
        InputStream infinite = new InputStream() {
            @Override public int read() { consumed[0]++; return 'x'; }
            @Override public int read(byte[] buffer, int offset, int length) {
                Arrays.fill(buffer, offset, offset + length, (byte) 'x');
                consumed[0] += length;
                return length;
            }
        };
        try { SourceDocumentFiles.readUtf8(infinite, 7); fail("Over-limit input accepted"); }
        catch (LocalSourceStore.StoreException exception) { assertEquals("FILE_TOO_LARGE", exception.code); }
        assertEquals(8, consumed[0]);
    }

    public void testSupplierReadFailuresPropagateWithoutReturningPartialText() throws Exception {
        InputStream broken = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("Synthetic read failure"); }
        };
        try { SourceDocumentFiles.readUtf8(broken, 20); fail("Partial read accepted"); }
        catch (IOException expected) {}
    }

    public void testFileNamesRequireSupportedExtensionWithoutPathOrControls() throws Exception {
        assertEquals("资料.MD", SourceDocumentFiles.validateName("资料.MD", false));
        assertEquals("备份.JSON", SourceDocumentFiles.validateName("备份.JSON", true));
        for (String name : new String[] { "", "../资料.md", "folder\\资料.txt", "资料.md.exe", "资料.md\n", "资料.json" }) {
            try { SourceDocumentFiles.validateName(name, false); fail("Unsafe or unsupported name accepted"); }
            catch (LocalSourceStore.StoreException exception) { assertEquals("VALIDATION", exception.code); }
        }
        try { SourceDocumentFiles.validateName("资料.md", true); fail("Source file accepted as backup"); }
        catch (LocalSourceStore.StoreException expected) {}
    }

    public void testPickerSelectionRequiresOneContentDocument() throws Exception {
        Uri uri = Uri.parse("content://synthetic.provider/document/one");
        assertEquals(uri, SourceDocumentFiles.selectedDocument(new Intent().setData(uri)));
        Intent singleClip = new Intent().setData(uri);
        singleClip.setClipData(ClipData.newRawUri("synthetic", uri));
        assertEquals(uri, SourceDocumentFiles.selectedDocument(singleClip));
        ClipData multiple = ClipData.newRawUri("synthetic", uri);
        multiple.addItem(new ClipData.Item(Uri.parse("content://synthetic.provider/document/two")));
        Intent multipleSelection = new Intent().setData(uri);
        multipleSelection.setClipData(multiple);
        for (Intent intent : new Intent[] { new Intent(), new Intent().setData(Uri.parse("file:///synthetic.md")),
            new Intent().setData(Uri.parse("https://example.invalid/synthetic.md")), multipleSelection }) {
            try { SourceDocumentFiles.selectedDocument(intent); fail("Non-single content selection accepted"); }
            catch (LocalSourceStore.StoreException exception) { assertEquals("VALIDATION", exception.code); }
        }
    }

    public void testExchangeIncludesOnlyPortableSourceFieldsAndPreservesBody() throws Exception {
        String title = "引号\"、换行\n和\\反斜杠";
        String body = "---\n普通正文原样保留\n---\n";
        JSONObject meta = new JSONObject().put("author", "作者\"\n").put("platform", "合成平台")
            .put("url", 123).put("privacy", "local").put("stage", "reference").put("credentials", "synthetic");
        JSONObject note = new JSONObject().put("title", title).put("body", body).put("meta", meta)
            .put("id", "private-id").put("hash", "private-hash").put("learning", "private-state");
        String text = new String(SourceDocumentFiles.sourceExchange(note), StandardCharsets.UTF_8);
        assertTrue(text.startsWith("---\n"));
        int separator = text.indexOf("\n---\n", 4);
        JSONObject header = new JSONObject(text.substring(4, separator));
        assertEquals(4, header.length());
        assertEquals("zhixu-source-exchange", header.getString("format"));
        assertEquals(1, header.getInt("version"));
        assertEquals(title, header.getString("title"));
        assertEquals(2, header.getJSONObject("source").length());
        assertEquals(meta.getString("author"), header.getJSONObject("source").getString("author"));
        assertEquals(body, text.substring(separator + 5));
    }

    public void testExportRequiresFlushAndCloseAndCancellationStopsWriting() throws Exception {
        byte[] bytes = "合成导出正文".getBytes(StandardCharsets.UTF_8);
        TrackingOutput output = new TrackingOutput(false, false);
        SourceDocumentFiles.writeBytes(output, bytes, () -> true);
        assertTrue(Arrays.equals(bytes, output.toByteArray()));
        assertTrue(output.flushed);
        assertTrue(output.closed);
        for (TrackingOutput failed : new TrackingOutput[] { new TrackingOutput(true, false), new TrackingOutput(false, true) }) {
            try { SourceDocumentFiles.writeBytes(failed, bytes, () -> true); fail("Failed export reported success"); }
            catch (SourceDocumentFiles.DocumentWriteException expected) {
                assertEquals(failed.failFlush ? "flush" : "close", expected.stage);
            }
            assertTrue(failed.closed);
        }
        TrackingOutput cancelled = new TrackingOutput(false, false);
        try { SourceDocumentFiles.writeBytes(cancelled, bytes, () -> false); fail("Cancelled export wrote bytes"); }
        catch (IOException expected) {}
        assertEquals(0, cancelled.size());
        assertTrue(cancelled.closed);
    }

    public void testLostPayloadOrCancellationNeverOpensAndTruncatesDocument() throws Exception {
        final int[] opens = { 0 };
        SourceDocumentFiles.OutputOpener opener = () -> { opens[0]++; return new TrackingOutput(false, false); };
        try { SourceDocumentFiles.writeDocument(opener, null, () -> true); fail("Lost payload opened a document"); }
        catch (SourceDocumentFiles.DocumentWriteException exception) { assertEquals("payload", exception.stage); }
        try { SourceDocumentFiles.writeDocument(opener, new byte[] { 'x' }, () -> false); fail("Cancelled export opened a document"); }
        catch (SourceDocumentFiles.DocumentWriteException exception) { assertEquals("before-open", exception.stage); }
        assertEquals(0, opens[0]);
    }

    public void testOpenFailureDiagnosticContainsOnlyStageAndExceptionClasses() throws Exception {
        String privateMessage = "synthetic-content://provider/private-path?private-body";
        try {
            SourceDocumentFiles.writeDocument(() -> {
                throw new IOException(privateMessage, new SecurityException(privateMessage));
            }, new byte[] { 'x' }, () -> true);
            fail("Provider open failure reported success");
        } catch (SourceDocumentFiles.DocumentWriteException exception) {
            assertEquals("open-output", exception.stage);
            String diagnostic = SourceDocumentFiles.failureDiagnostic("export", exception);
            assertEquals("stage=open-output exception=IOException cause=SecurityException", diagnostic);
            assertFalse(diagnostic.contains(privateMessage));
        }
    }

    public void testProviderPartialWriteFailureClosesOutputAndReportsWriteStage() throws Exception {
        final boolean[] closed = { false };
        ByteArrayOutputStream partial = new ByteArrayOutputStream();
        OutputStream broken = new OutputStream() {
            @Override public void write(int value) throws IOException {
                partial.write(value);
                throw new IOException("Synthetic provider write failure");
            }
            @Override public void close() { closed[0] = true; }
        };
        try { SourceDocumentFiles.writeDocument(() -> broken, new byte[] { 'x', 'y' }, () -> true); fail("Partial write accepted"); }
        catch (SourceDocumentFiles.DocumentWriteException exception) { assertEquals("write", exception.stage); }
        assertEquals(1, partial.size());
        assertTrue(closed[0]);
    }

    public void testExchangeAcceptsCommonWebUrlsAndRetainsEverySourceField() throws Exception {
        for (String url : new String[] { "https://example.invalid/article?q=one%20two#段落", "http://127.0.0.1:4318/source",
            "HTTPS://EXAMPLE.INVALID/中文路径", "https://例子.测试/资料", "http://[::1]:4318/source", "" }) {
            JSONObject meta = new JSONObject().put("platform", "原平台").put("author", "原作者").put("url", url)
                .put("date", "2026-10-07").put("locator", "第 3 段").put("topic", "原主题");
            JSONObject note = exchangeNote(meta);
            JSONObject header = exchangeHeader(SourceDocumentFiles.sourceExchange(note));
            assertEquals(meta.toString(), header.getJSONObject("source").toString());
            assertEquals(meta.toString(), note.getJSONObject("meta").toString());
        }
    }

    public void testExchangeRejectsLegacyInvalidUrlsBeforeProducingDocument() throws Exception {
        for (String url : new String[] { "ftp://example.invalid/source", "javascript:alert(1)", "旧版任意来源字符串",
            "https://", "https:///source", "http://:4318/source", "http://example.invalid:65536/",
            "http://999.1.1.1/", "http://example.123/", "https://bad host.invalid/", "https://example.invalid/\0" }) {
            JSONObject meta = new JSONObject().put("url", url).put("author", "需保留的作者");
            JSONObject note = exchangeNote(meta);
            try { SourceDocumentFiles.sourceExchange(note); fail("Invalid URL produced an exchange document"); }
            catch (LocalSourceStore.StoreException exception) {
                assertEquals("VALIDATION", exception.code);
                assertTrue(exception.getMessage().contains("资料编辑"));
                assertTrue(exception.getMessage().contains("HTTP 或 HTTPS"));
            }
            assertEquals(url, note.getJSONObject("meta").getString("url"));
            assertEquals("需保留的作者", note.getJSONObject("meta").getString("author"));
        }
    }

    public void testExchangeUrlLengthUsesStoredCodePointLimit() throws Exception {
        String prefix = "https://example.invalid/";
        StringBuilder url = new StringBuilder(prefix);
        while (url.length() < 2048) url.append('x');
        assertEquals(url.toString(), exchangeHeader(SourceDocumentFiles.sourceExchange(
            exchangeNote(new JSONObject().put("url", url.toString())))).getJSONObject("source").getString("url"));
        url.append('x');
        try { SourceDocumentFiles.sourceExchange(exchangeNote(new JSONObject().put("url", url.toString()))); fail("Overlong URL accepted"); }
        catch (LocalSourceStore.StoreException exception) { assertEquals("VALIDATION", exception.code); }
        StringBuilder unicodeUrl = new StringBuilder(prefix);
        while (unicodeUrl.codePointCount(0, unicodeUrl.length()) < 2048) unicodeUrl.append("😀");
        assertEquals(unicodeUrl.toString(), exchangeHeader(SourceDocumentFiles.sourceExchange(
            exchangeNote(new JSONObject().put("url", unicodeUrl.toString())))).getJSONObject("source").getString("url"));
    }

    private static JSONObject exchangeNote(JSONObject meta) throws Exception {
        return new JSONObject().put("title", "合成导出资料").put("body", "原正文保持不变。\n").put("meta", meta);
    }

    private static JSONObject exchangeHeader(byte[] bytes) throws Exception {
        String text = new String(bytes, StandardCharsets.UTF_8);
        return new JSONObject(text.substring(4, text.indexOf("\n---\n", 4)));
    }

    private static final class TrackingOutput extends ByteArrayOutputStream {
        boolean flushed;
        boolean closed;
        final boolean failFlush;
        final boolean failClose;
        TrackingOutput(boolean failFlush, boolean failClose) { this.failFlush = failFlush; this.failClose = failClose; }
        @Override public void flush() throws IOException {
            flushed = true;
            if (failFlush) throw new IOException("Synthetic flush failure");
        }
        @Override public void close() throws IOException {
            closed = true;
            if (failClose) throw new IOException("Synthetic close failure");
        }
    }

    private void rejectText(byte[] bytes, String code) throws Exception {
        try { SourceDocumentFiles.readUtf8(new ByteArrayInputStream(bytes), 1024); fail("Invalid text accepted"); }
        catch (LocalSourceStore.StoreException exception) { assertEquals(code, exception.code); }
    }
}
