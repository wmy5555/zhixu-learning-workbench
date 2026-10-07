package io.github.wmy5555.zhixu.sharedtest;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.test.AndroidTestCase;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
            catch (IOException expected) {}
            assertTrue(failed.closed);
        }
        TrackingOutput cancelled = new TrackingOutput(false, false);
        try { SourceDocumentFiles.writeBytes(cancelled, bytes, () -> false); fail("Cancelled export wrote bytes"); }
        catch (IOException expected) {}
        assertEquals(0, cancelled.size());
        assertTrue(cancelled.closed);
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
