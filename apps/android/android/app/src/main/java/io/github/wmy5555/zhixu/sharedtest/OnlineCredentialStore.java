package io.github.wmy5555.zhixu.sharedtest;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM key stays in Android Keystore. Hardware backing is device-dependent. */
final class OnlineCredentialStore {
    private final String alias;
    OnlineCredentialStore(String alias) { this.alias = alias; }
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias(alias)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build()); gen.generateKey();
        }
        return (SecretKey) ks.getKey(alias, null);
    }
    byte[] encrypt(byte[] value) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key()); c.updateAAD(alias.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] iv = c.getIV(), body = c.doFinal(value), out = new byte[1 + iv.length + body.length];
        out[0] = (byte) iv.length; System.arraycopy(iv, 0, out, 1, iv.length); System.arraycopy(body, 0, out, iv.length + 1, body.length); return out;
    }
    byte[] decrypt(byte[] value) throws Exception {
        if (value.length < 30 || value[0] != 12) throw OnlineSupport.fail("CREDENTIAL_ERROR", "在线凭据无法解密，请重新配置。");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(value, 1, 13)));
        c.updateAAD(alias.getBytes(java.nio.charset.StandardCharsets.UTF_8)); return c.doFinal(Arrays.copyOfRange(value, 13, value.length));
    }
    void deleteForTests() throws Exception { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(alias); }
}
