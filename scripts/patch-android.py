"""Patches the generated Capacitor Android project:
- signs every build with the fixed keystore in /keystore (needed so new APKs update the installed app)
- sets an increasing versionCode (the GitHub run number)
- turns off lint and enables Gradle caching to keep builds fast
"""
import pathlib
import re
import sys

run = sys.argv[1] if len(sys.argv) > 1 else "1"

gradle = pathlib.Path("android/app/build.gradle")
s = gradle.read_text()

if "signingConfigs" not in s:
    block = """
    signingConfigs {
        release {
            storeFile rootProject.file('../keystore/studybuddy.p12')
            storePassword 'studybuddy'
            keyAlias 'studybuddy'
            keyPassword 'studybuddy'
            storeType 'pkcs12'
        }
    }
    lint {
        checkReleaseBuilds false
        abortOnError false
    }
"""
    s = s.replace("android {\n", "android {\n" + block, 1)
    s, n = re.subn(r"(buildTypes\s*\{\s*release\s*\{)", r"\1\n            signingConfig signingConfigs.release", s, count=1)
    if n != 1:
        sys.exit("Could not patch release buildType")

s = re.sub(r"versionCode\s+\d+", f"versionCode {run}", s)
s = re.sub(r'versionName\s+"[^"]*"', 'versionName "6.9.3"', s)
gradle.write_text(s)

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
extra = "\norg.gradle.caching=true\norg.gradle.parallel=true\norg.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8\n"
if "org.gradle.caching" not in p:
    props.write_text(p.rstrip() + "\n" + extra)

print("patched, versionCode", run)

# ---- native Capacitor plugins: PDF renderer + Buddy microphone permission + Buddy screen capture ----
PLUGINS = ["NativePdfPlugin", "BuddyMicPlugin", "BuddyScreenPlugin"]
main = next(pathlib.Path("android/app/src/main/java").rglob("MainActivity.java"), None)
if main is not None and pathlib.Path("native/android/NativePdfPlugin.java").exists():
    pkg = re.search(r"^package\s+([\w.]+);", main.read_text(), re.M).group(1)
    reg = ""
    for name in PLUGINS:
        src = pathlib.Path(f"native/android/{name}.java")
        if not src.exists():
            print("WARNING: missing", src)
            continue
        code = re.sub(r"^package\s+[\w.]+;", f"package {pkg};", src.read_text(), count=1, flags=re.M)
        (main.parent / f"{name}.java").write_text(code)
        reg += f"        registerPlugin({name}.class);\n"
    main.write_text(
        f"""package {pkg};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {{
    @Override
    public void onCreate(Bundle savedInstanceState) {{
{reg}        super.onCreate(savedInstanceState);
    }}
}}
"""
    )
    print("native plugins installed in", pkg)
else:
    print("WARNING: native plugins not installed (source or MainActivity missing)")

# ---- Buddy voice friend: microphone + internet permissions ----
manifest = pathlib.Path("android/app/src/main/AndroidManifest.xml")
if manifest.exists():
    m = manifest.read_text()
    add = ""
    for perm in ("RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "INTERNET"):
        if f"android.permission.{perm}" not in m:
            add += f'    <uses-permission android:name="android.permission.{perm}" />\n'
    if add:
        m = m.replace("<application", add + "    <application", 1)
        manifest.write_text(m)
    print("Buddy permissions ok")
else:
    print("WARNING: AndroidManifest.xml not found, microphone permission not added")
