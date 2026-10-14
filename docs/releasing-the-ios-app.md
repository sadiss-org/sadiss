# Releasing the iOS app to the App Store

The app is published as **SADISS Client** by Amfortas Informationstechnologie
GmbH, team ID `986USD9QRX`. Its bundle identifier is `net.sadiss.app`. A bundle
ID cannot be changed after publishing: changing it creates a *different* app
with a new store listing and abandons the existing one.

Builds are made on a GitHub-hosted Mac by
[`.github/workflows/ios-testflight.yml`](../.github/workflows/ios-testflight.yml),
so no local Mac is needed. The workflow builds the web app, archives it, signs
it and uploads it to TestFlight. From there it is submitted for review in App
Store Connect.

## 1. Bump the version

| file | field |
| --- | --- |
| `app/package.json` | `version` |
| `app/ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (twice: Debug and Release) |

`MARKETING_VERSION` is the user-visible version and should match `package.json`
and the Android `versionName`.

The build number is not edited by hand. The workflow sets it to the run number
of the repository it runs in, plus 3 for the builds uploaded from a fork before
the repository had its own secrets. It only has to be unique within one
`MARKETING_VERSION`, but moving the workflow to a different repository restarts
the run numbers at 1, and App Store Connect rejects a build number it has
already seen for that version.

## 2. Build and upload

The workflow runs in whichever repository holds the secrets below. On a
personal-account repository only the owner can set secrets, so a maintainer
without that access runs it from their own fork. A fork does not follow the
main repository by itself, so sync it first:

```
gh repo sync <owner>/sadiss
gh workflow run ios-testflight.yml -R <owner>/sadiss
gh run watch -R <owner>/sadiss
```

A run takes about 4 minutes. Apple then processes the build for 5–15 minutes
before it appears under the app's **TestFlight** tab.

### Secrets

| secret | value |
| --- | --- |
| `APP_STORE_CONNECT_API_KEY` | contents of the `AuthKey_<key id>.p8` file |
| `APP_STORE_CONNECT_KEY_ID` | the key ID, also in the `.p8` filename |
| `APP_STORE_CONNECT_ISSUER_ID` | shown above the key list in App Store Connect |

Keys are created in App Store Connect → Users and Access → Integrations → App
Store Connect API, a page only Admins and the Account Holder can open. The key
must have the **Admin** role. An App Manager key archives fine but fails the
upload with `Cloud signing permission error`, because creating the distribution
certificate needs Admin. The `.p8` file can be downloaded once only.

With the key in place, signing is automatic: Xcode creates the certificate and
provisioning profile on the runner. Nothing signing-related is stored in the
repository.

## 3. Submit

1. App Store Connect → the app → **+ Version**
2. Enter the version number, select the uploaded build
3. Fill in "What's New"
4. **Add for Review** → **Submit**

Review usually takes a day or two. For TestFlight only, add testers under
**TestFlight → Internal Testing** instead.

## Building on a Mac instead

| requirement | why |
| --- | --- |
| Mac with **Apple Silicon** (M1 or later) | Xcode 26 does not run on Intel |
| **macOS 26.2** or later | required by Xcode 26.6 |
| **Xcode 26** or later | App Store Connect requirement since 2026-04-28 |
| CocoaPods 1.15+ | older versions break against recent Xcode |

```
cd app
npm ci
npm run build
npx cap sync ios
cd ios/App
pod install
```

Open `app/ios/App/App.xcworkspace` (the **workspace**, not the `.xcodeproj`, or
the pods will not be linked), select **Any iOS Device**, then **Product →
Archive** → **Distribute App → App Store Connect**. Set
`CURRENT_PROJECT_VERSION` by hand to a build number not yet used for this
version.

## Deployment target

`IPHONEOS_DEPLOYMENT_TARGET` lives in the Xcode project and is mirrored by the
`platform :ios` line in `app/ios/App/Podfile`. Both must agree.

It is pinned by the pods, not by choice: every Capacitor 8 pod declares a
deployment target of 15.0. Raising the Capacitor major version is what moves this
number, and it drops support for older iPhones each time.

## Things that block a submission

- **Apple Developer Program membership** must be current. If it lapses the app is
  delisted.
- **Age rating questionnaire**: Apple has required updated answers since
  2026-01-31. An unanswered questionnaire interrupts submission.
- **App access**: the app is unusable without a QR code from a live performance,
  so a reviewer cannot reach any functionality unaided. If review is rejected for
  this, provide instructions and a QR code pointing at a performance that stays
  reachable for the duration of the review.
