# Releasing the Android app to Google Play

The app is published as **SADISS Client**, application ID `net.sadiss_client.app`.

## Prerequisites

- JDK 21 (`java -version`)
- Node 20+
- Android SDK platform 36 installed
- The release keystore, plus `app/android/keystore.properties` (see below)

### keystore.properties

The signing credentials are deliberately not in version control. Copy the example
and fill it in:

```
cp app/android/keystore.properties.example app/android/keystore.properties
```

`storeFile` is resolved relative to `app/android/`. Without this file the release
build stays unsigned and Play rejects the upload — it does not silently fall back
to the debug key.

Keep the keystore file and its password somewhere both maintainers can reach — a
shared password-manager vault, not a folder on one laptop. The original upload key
was lost exactly this way, which cost a two-day key reset.

The current upload key was issued 2026-08-17:

```
SHA-256  17:12:E4:5E:C6:B4:7A:A4:60:7E:20:E7:39:40:B5:F6:D2:BD:53:9D:12:58:DB:27:63:BE:38:DD:AA:25:1B:2C
```

`jarsigner -verify -certs` on a release bundle should report that fingerprint. If it
reports anything else, the build was signed with the wrong key and Play will reject
it.

Play App Signing is enabled for this app, so a lost upload key is recoverable: in
the Play Console under *Protect with Google Play* → *Google Play Store protection*
→ *Protect app signing key*, request a new upload key. Google takes about two days
to activate it, and doing so invalidates the previous one — so only request it once
the old keystore is genuinely gone.

## 1. Bump the version

Two files have to agree:

| file | field |
| --- | --- |
| `app/package.json` | `version` |
| `app/android/app/build.gradle` | `versionName`, `versionCode` |

`versionCode` must be strictly higher than the one already live in Play — Play
rejects a re-used code. Check the current one under *Test and release →
Production*. `versionName` is the human-facing string and should match
`package.json`, which feeds `VITE_APP_VERSION` and the version shown in the UI.

## 2. Build the bundle

```
cd app
npm ci
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

The signed bundle lands at:

```
app/android/app/build/outputs/bundle/release/app-release.aab
```

To sanity-check the signature before uploading:

```
jarsigner -verify -verbose -certs app/android/app/build/outputs/bundle/release/app-release.aab
```

## 3. Upload

1. Play Console → **Test and release** → **Production**
2. **Create new release**
3. Upload the `.aab`
4. Fill in the release notes
5. **Save** → **Review release** → **Start rollout**

Review typically takes a few hours to a few days.

Consider an **Internal testing** track first — same upload flow, but it reaches only
your listed testers and is available within minutes.

## Target API level

Play enforces a minimum `targetSdkVersion` and refuses uploads below it. The
requirement rises every year, roughly one year behind each Android release, so an
app that goes a long time without a release will eventually be blocked from
updating at all.

`targetSdkVersion` lives in `app/android/variables.gradle`. Raising it is not just a
number change — each level brings behaviour changes that need testing on a device
(Android 15 forcing edge-to-edge layout, for example).

## Foreground service

While a phone is joined to a performance, the app runs a foreground service of type
`mediaPlayback` with a silent notification, "SADISS is playing". Without it Android
treats a locked phone's app as cached and reclaims it a few minutes after the screen
locks, and the phone drops out of the piece. The service and its permissions are
declared by the local plugin in `app/plugins/playback-service/`.

Play asks every app that targets Android 14 or later to declare its foreground
service types. Do this once the locked-phone test has passed and before uploading
the bundle that first contains the service:

1. Film the app in use with a second phone or a camera; a screen recording goes black
   when the screen locks. In one take: open SADISS, scan a performance QR code, the
   track starts and sound plays, pull down the notification shade to show "SADISS is
   playing", press the power button and let it play for about 20 seconds, unlock,
   the phone is still joined.
2. Upload the video to YouTube as **Unlisted**.
3. Play Console → the app → **App content** (Google's help page puts it under
   *Monitor and improve* → *App content*; the console may label it *Policy* →
   *App content*) → the **foreground service** declaration.
4. Tick the use case **Media Playback** and fill in:
   - Description: "SADISS turns audience phones into speakers for a live
     performance. After the user joins a performance by scanning its QR code, the
     phone plays its part of the piece as audio streamed from the performance
     server. The foreground service keeps that audio playing when the user locks
     the screen or puts the phone in a pocket."
   - Impact if deferred or interrupted: "The phone goes silent in the middle of the
     performance and drops out of the piece; the user has to unlock the phone and
     rejoin."
   - The video link.
5. Submit the declaration before uploading the bundle. Google's page does not say
   whether a missing declaration blocks the release.

Google's requirements:
https://support.google.com/googleplay/android-developer/answer/13392821

## Developer account inactivity

Google closes developer accounts that stay inactive, which takes the published apps
down with them. Shipping a release resets this. It is a separate policy from the
target API requirement, with its own deadline.
