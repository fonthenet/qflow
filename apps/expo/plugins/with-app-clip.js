/**
 * Expo Config Plugin: Embed native App Clip + Live Activity into the Expo build.
 *
 * This plugin runs during `npx expo prebuild` and modifies the generated Xcode
 * project to include the QueueFlowClip (App Clip) and QueueFlowLiveActivity
 * (Widget Extension) targets alongside the main React Native app.
 *
 * Sources live in targets/QueueFlowClip/, targets/QueueFlowShared/, and
 * targets/QueueFlowLiveActivity/ — pure Swift, no external dependencies.
 */

const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ── Constants ────────────────────────────────────────────────────────
const TEAM_ID = 'W69MRY2826';
const PARENT_BUNDLE_ID = 'com.queueflow.app';
const CLIP_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip';
const LIVE_ACTIVITY_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip.LiveActivity';
const DEPLOYMENT_TARGET = '16.4';
const ASSOCIATED_DOMAIN = 'qflow-sigma.vercel.app';

// ── Helpers ──────────────────────────────────────────────────────────

function addBuildPhase(proj, targetKey, name, files, type) {
  const buildPhase = proj.addBuildPhase(
    files,
    type,
    name,
    targetKey,
    undefined,
    undefined
  );
  return buildPhase;
}

function copyFolderToIos(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const item of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyFolderToIos(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Main Plugin ──────────────────────────────────────────────────────

function withAppClip(config) {
  // Step 1: Add appclips associated domain to main app entitlements
  config = withEntitlementsPlist(config, (mod) => {
    const domains = mod.modResults['com.apple.developer.associated-domains'] || [];
    const appClipDomain = `appclips:${ASSOCIATED_DOMAIN}`;
    if (!domains.includes(appClipDomain)) {
      domains.push(appClipDomain);
    }
    // Also ensure applinks is present
    const appLinkDomain = `applinks:${ASSOCIATED_DOMAIN}`;
    if (!domains.includes(appLinkDomain)) {
      domains.push(appLinkDomain);
    }
    mod.modResults['com.apple.developer.associated-domains'] = domains;
    return mod;
  });

  // Step 2: Modify Info.plist to remove encryption export compliance prompt
  config = withInfoPlist(config, (mod) => {
    mod.modResults.ITSAppUsesNonExemptEncryption = false;
    return mod;
  });

  // Step 3: Modify the Xcode project to add App Clip + Live Activity targets
  config = withXcodeProject(config, (mod) => {
    const proj = mod.modResults;
    const projectRoot = mod.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, 'ios');
    const targetsDir = path.join(projectRoot, 'targets');

    // ── Copy source files into ios/ build directory ──
    const clipDestDir = path.join(iosDir, 'QueueFlowClip');
    const sharedDestDir = path.join(iosDir, 'QueueFlowShared');
    const liveActivityDestDir = path.join(iosDir, 'QueueFlowLiveActivity');

    copyFolderToIos(path.join(targetsDir, 'QueueFlowClip'), clipDestDir);
    copyFolderToIos(path.join(targetsDir, 'QueueFlowShared'), sharedDestDir);
    copyFolderToIos(path.join(targetsDir, 'QueueFlowLiveActivity'), liveActivityDestDir);

    // ── Add App Clip Target ──
    const clipTarget = proj.addTarget(
      'QueueFlowClip',
      'application.on-demand-install-capable',
      'QueueFlowClip',
      CLIP_BUNDLE_ID
    );

    // Add App Clip source files
    const clipGroup = proj.addPbxGroup([], 'QueueFlowClip', 'QueueFlowClip');
    const clipGroupKey = clipGroup.uuid;
    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;
    proj.addToPbxGroup(clipGroupKey, mainGroupKey);

    // Add Swift source files to App Clip target
    const clipSwiftFiles = fs.readdirSync(clipDestDir).filter(f => f.endsWith('.swift'));
    for (const file of clipSwiftFiles) {
      proj.addSourceFile(
        `QueueFlowClip/${file}`,
        { target: clipTarget.uuid },
        clipGroupKey
      );
    }

    // Add shared Swift files to App Clip target
    const sharedSwiftFiles = fs.readdirSync(sharedDestDir).filter(f => f.endsWith('.swift'));
    const sharedGroup = proj.addPbxGroup([], 'QueueFlowShared', 'QueueFlowShared');
    const sharedGroupKey = sharedGroup.uuid;
    proj.addToPbxGroup(sharedGroupKey, mainGroupKey);

    for (const file of sharedSwiftFiles) {
      proj.addSourceFile(
        `QueueFlowShared/${file}`,
        { target: clipTarget.uuid },
        sharedGroupKey
      );
    }

    // Add Assets.xcassets to App Clip
    proj.addResourceFile(
      'QueueFlowClip/Assets.xcassets',
      { target: clipTarget.uuid },
      clipGroupKey
    );

    // ── App Clip Build Settings ──
    const clipBuildConfigs = proj.pbxXCBuildConfigurationSection();
    for (const key in clipBuildConfigs) {
      const config = clipBuildConfigs[key];
      if (config.buildSettings && config.name && proj.getBuildProperty('PRODUCT_NAME', config.name, clipTarget.uuid)) {
        // These get set via the target's build configuration list
      }
    }

    // Set build settings for App Clip target
    const clipConfigs = proj.pbxXCConfigurationList()[clipTarget.pbxNativeTarget.buildConfigurationList];
    if (clipConfigs) {
      for (const configRef of clipConfigs.buildConfigurations) {
        const bc = clipBuildConfigs[configRef.value];
        if (bc && bc.buildSettings) {
          bc.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${CLIP_BUNDLE_ID}"`;
          bc.buildSettings.DEVELOPMENT_TEAM = TEAM_ID;
          bc.buildSettings.SWIFT_VERSION = '5.0';
          bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
          bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
          bc.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME = 'AppIcon';
          bc.buildSettings.CODE_SIGN_ENTITLEMENTS = '"QueueFlowClip/QueueFlowClip.entitlements"';
          bc.buildSettings.INFOPLIST_FILE = '"QueueFlowClip/Info.plist"';
          bc.buildSettings.CODE_SIGN_STYLE = 'Automatic';
          bc.buildSettings.PRODUCT_NAME = '"$(TARGET_NAME)"';
          bc.buildSettings.SUPPORTS_MACCATALYST = 'NO';
          bc.buildSettings.ENABLE_PREVIEWS = 'YES';
        }
      }
    }

    // ── Add Live Activity Extension Target ──
    const liveTarget = proj.addTarget(
      'QueueFlowLiveActivity',
      'app-extension',
      'QueueFlowLiveActivity',
      LIVE_ACTIVITY_BUNDLE_ID
    );

    const liveGroup = proj.addPbxGroup([], 'QueueFlowLiveActivity', 'QueueFlowLiveActivity');
    const liveGroupKey = liveGroup.uuid;
    proj.addToPbxGroup(liveGroupKey, mainGroupKey);

    // Add Live Activity Swift sources
    const liveSwiftFiles = fs.readdirSync(liveActivityDestDir).filter(f => f.endsWith('.swift'));
    for (const file of liveSwiftFiles) {
      proj.addSourceFile(
        `QueueFlowLiveActivity/${file}`,
        { target: liveTarget.uuid },
        liveGroupKey
      );
    }

    // Add shared files to Live Activity target too
    for (const file of sharedSwiftFiles) {
      proj.addSourceFile(
        `QueueFlowShared/${file}`,
        { target: liveTarget.uuid },
        sharedGroupKey
      );
    }

    // Live Activity Build Settings
    const liveBuildConfigs = proj.pbxXCBuildConfigurationSection();
    const liveConfigs = proj.pbxXCConfigurationList()[liveTarget.pbxNativeTarget.buildConfigurationList];
    if (liveConfigs) {
      for (const configRef of liveConfigs.buildConfigurations) {
        const bc = liveBuildConfigs[configRef.value];
        if (bc && bc.buildSettings) {
          bc.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${LIVE_ACTIVITY_BUNDLE_ID}"`;
          bc.buildSettings.DEVELOPMENT_TEAM = TEAM_ID;
          bc.buildSettings.SWIFT_VERSION = '5.0';
          bc.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
          bc.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
          bc.buildSettings.CODE_SIGN_ENTITLEMENTS = '"QueueFlowLiveActivity/QueueFlowLiveActivity.entitlements"';
          bc.buildSettings.INFOPLIST_FILE = '"QueueFlowLiveActivity/Info.plist"';
          bc.buildSettings.CODE_SIGN_STYLE = 'Automatic';
          bc.buildSettings.PRODUCT_NAME = '"$(TARGET_NAME)"';
          bc.buildSettings.APPLICATION_EXTENSION_API_ONLY = 'YES';
          bc.buildSettings.SKIP_INSTALL = 'YES';
          bc.buildSettings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/../../Frameworks"';
        }
      }
    }

    // ── Embed App Clip in main target ──
    // Find the main target
    const mainTarget = proj.getFirstTarget();
    if (mainTarget) {
      // Add "Embed App Clips" copy files build phase
      proj.addBuildPhase(
        [],
        'PBXCopyFilesBuildPhase',
        'Embed App Clips',
        mainTarget.firstTarget.uuid,
        'app_clip',
        ''
      );

      // Add "Embed App Extensions" for Live Activity
      proj.addBuildPhase(
        [],
        'PBXCopyFilesBuildPhase',
        'Embed App Extensions',
        mainTarget.firstTarget.uuid,
        'plugins',
        ''
      );
    }

    return mod;
  });

  return config;
}

module.exports = withAppClip;
