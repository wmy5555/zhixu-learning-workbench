package io.github.wmy5555.zhixu.sharedtest;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.XmlResourceParser;
import android.test.AndroidTestCase;
import org.xmlpull.v1.XmlPullParser;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Read the installed APK's effective manifest and compiled backup rules. */
@SuppressWarnings("deprecation")
public class AndroidPrivacyTest extends AndroidTestCase {
    public void testInstalledPrototypeHasNoNetworkPermissionOrAutomaticBackup() throws Exception {
        assertEquals(0, getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        String[] permissions = getContext().getPackageManager().getPackageInfo(
            getContext().getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
        if (permissions != null) assertFalse(Arrays.asList(permissions).contains("android.permission.INTERNET"));
    }

    public void testCloudAndDeviceTransferExcludeEveryStorageDomain() throws Exception {
        Set<String> domains = new HashSet<>(Arrays.asList("root", "file", "database", "sharedpref", "external",
            "device_root", "device_file", "device_database", "device_sharedpref"));
        Map<String, Set<String>> exclusions = new HashMap<>();
        String mode = null;
        try (XmlResourceParser rules = getContext().getResources().getXml(R.xml.data_extraction_rules)) {
            for (int event = rules.next(); event != XmlPullParser.END_DOCUMENT; event = rules.next()) {
                if (event == XmlPullParser.START_TAG) {
                    String name = rules.getName();
                    if ("cloud-backup".equals(name) || "device-transfer".equals(name)) {
                        mode = name;
                        exclusions.put(mode, new HashSet<>());
                    } else if (mode != null && "exclude".equals(name)) {
                        String path = rules.getAttributeValue(null, "path");
                        if (".".equals(path) || "./".equals(path)) exclusions.get(mode).add(rules.getAttributeValue(null, "domain"));
                    }
                } else if (event == XmlPullParser.END_TAG && rules.getName().equals(mode)) mode = null;
            }
        }
        for (String required : Arrays.asList("cloud-backup", "device-transfer")) {
            assertNotNull("Missing backup mode: " + required, exclusions.get(required));
            assertTrue("Backup mode may expose a storage domain: " + required, exclusions.get(required).containsAll(domains));
        }
    }
}
