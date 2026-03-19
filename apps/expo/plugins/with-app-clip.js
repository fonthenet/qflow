/**
 * Expo Config Plugin: Embed native App Clip + Live Activity into the Expo build.
 *
 * This plugin runs during `npx expo prebuild` and modifies the generated Xcode
 * project to include the QueueFlowClip (App Clip) and QueueFlowLiveActivity
 * (Widget Extension) targets alongside the main React Native app.
 */

const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ── Constants ────────────────────────────────────────────────────────
const TEAM_ID = 'W69MRY2826';
const CLIP_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip';
const LIVE_ACTIVITY_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip.LiveActivity';
const DEPLOYMENT_TARGET = '16.4';
const ASSOCIATED_DOMAIN = 'qflow-sigma.vercel.app';

// ── Helpers ──────────────────────────────────────────────────────────

function copyFolderToIos(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const item of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyFolderToIos(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function generateUuid() {
  // Generate a 24-char hex UUID matching Xcode's format
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
}

/**
 * Manually add a native target to the pbxproj since the xcode library
 * doesn't support App Clip product types. This does what addTarget() does
 * but with a custom productType string.
 */
function addNativeTarget(proj, name, productType, bundleId) {
  const targetUuid = proj.generateUuid();
  const productUuid = proj.generateUuid();
  const buildConfigListUuid = proj.generateUuid();
  const debugBcUuid = proj.generateUuid();
  const releaseBcUuid = proj.generateUuid();

  // Create build configurations
  const buildConfigs = proj.pbxXCBuildConfigurationSection();
  buildConfigs[debugBcUuid] = {
    isa: 'XCBuildConfiguration',
    buildSettings: {
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
      PRODUCT_NAME: `"$(TARGET_NAME)"`,
      DEVELOPMENT_TEAM: TEAM_ID,
      SWIFT_VERSION: '5.0',
      IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
      TARGETED_DEVICE_FAMILY: '"1,2"',
      CODE_SIGN_STYLE: 'Automatic',
    },
    name: 'Debug',
  };
  buildConfigs[debugBcUuid + '_comment'] = name;

  buildConfigs[releaseBcUuid] = {
    isa: 'XCBuildConfiguration',
    buildSettings: {
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
      PRODUCT_NAME: `"$(TARGET_NAME)"`,
      DEVELOPMENT_TEAM: TEAM_ID,
      SWIFT_VERSION: '5.0',
      IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
      TARGETED_DEVICE_FAMILY: '"1,2"',
      CODE_SIGN_STYLE: 'Automatic',
    },
    name: 'Release',
  };
  buildConfigs[releaseBcUuid + '_comment'] = name;

  // Create build configuration list
  const configLists = proj.pbxXCConfigurationList();
  configLists[buildConfigListUuid] = {
    isa: 'XCConfigurationList',
    buildConfigurations: [
      { value: debugBcUuid, comment: 'Debug' },
      { value: releaseBcUuid, comment: 'Release' },
    ],
    defaultConfigurationIsVisible: 0,
    defaultConfigurationName: 'Release',
  };
  configLists[buildConfigListUuid + '_comment'] = `Build configuration list for PBXNativeTarget "${name}"`;

  // Create native target
  const targets = proj.pbxNativeTargetSection();
  targets[targetUuid] = {
    isa: 'PBXNativeTarget',
    buildConfigurationList: buildConfigListUuid,
    buildPhases: [],
    buildRules: [],
    dependencies: [],
    name: `"${name}"`,
    productName: `"${name}"`,
    productReference: productUuid,
    productType: `"${productType}"`,
  };
  targets[targetUuid + '_comment'] = name;

  // Add product reference
  const fileRefSection = proj.pbxFileReferenceSection();
  fileRefSection[productUuid] = {
    isa: 'PBXFileReference',
    explicitFileType: productType === 'com.apple.product-type.application.on-demand-install-capable'
      ? '"wrapper.application"'
      : '"wrapper.app-extension"',
    includeInIndex: 0,
    path: `"${name}.app"`,
    sourceTree: 'BUILT_PRODUCTS_DIR',
  };
  fileRefSection[productUuid + '_comment'] = `${name}.app`;

  // Add to project's targets array
  const projectObj = proj.getFirstProject().firstProject;
  projectObj.targets.push({ value: targetUuid, comment: name });

  return {
    uuid: targetUuid,
    productUuid,
    debugBcUuid,
    releaseBcUuid,
    buildConfigListUuid,
  };
}

// ── Main Plugin ──────────────────────────────────────────────────────

function withAppClip(config) {
  // Step 1: Add appclips associated domain to main app entitlements
  config = withEntitlementsPlist(config, (mod) => {
    const domains = mod.modResults['com.apple.developer.associated-domains'] || [];
    if (!domains.includes(`appclips:${ASSOCIATED_DOMAIN}`)) {
      domains.push(`appclips:${ASSOCIATED_DOMAIN}`);
    }
    if (!domains.includes(`applinks:${ASSOCIATED_DOMAIN}`)) {
      domains.push(`applinks:${ASSOCIATED_DOMAIN}`);
    }
    mod.modResults['com.apple.developer.associated-domains'] = domains;
    return mod;
  });

  // Step 2: Info.plist
  config = withInfoPlist(config, (mod) => {
    mod.modResults.ITSAppUsesNonExemptEncryption = false;
    return mod;
  });

  // Step 3: Modify Xcode project
  config = withXcodeProject(config, (mod) => {
    const proj = mod.modResults;
    const projectRoot = mod.modRequest.projectRoot;
    const iosDir = path.join(projectRoot, 'ios');
    const targetsDir = path.join(projectRoot, 'targets');

    // Copy source files into ios/ build directory
    const clipDestDir = path.join(iosDir, 'QueueFlowClip');
    const sharedDestDir = path.join(iosDir, 'QueueFlowShared');
    const liveActivityDestDir = path.join(iosDir, 'QueueFlowLiveActivity');

    copyFolderToIos(path.join(targetsDir, 'QueueFlowClip'), clipDestDir);
    copyFolderToIos(path.join(targetsDir, 'QueueFlowShared'), sharedDestDir);
    copyFolderToIos(path.join(targetsDir, 'QueueFlowLiveActivity'), liveActivityDestDir);

    // ── Add App Clip Target (custom product type) ──
    const clipTarget = addNativeTarget(
      proj,
      'QueueFlowClip',
      'com.apple.product-type.application.on-demand-install-capable',
      CLIP_BUNDLE_ID
    );

    // Set App Clip specific build settings
    const allConfigs = proj.pbxXCBuildConfigurationSection();
    for (const bcUuid of [clipTarget.debugBcUuid, clipTarget.releaseBcUuid]) {
      const bc = allConfigs[bcUuid];
      if (bc) {
        bc.buildSettings.ASSETCATALOG_COMPILER_APPICON_NAME = 'AppIcon';
        bc.buildSettings.CODE_SIGN_ENTITLEMENTS = '"QueueFlowClip/QueueFlowClip.entitlements"';
        bc.buildSettings.INFOPLIST_FILE = '"QueueFlowClip/Info.plist"';
        bc.buildSettings.ENABLE_PREVIEWS = 'YES';
        bc.buildSettings.SUPPORTS_MACCATALYST = 'NO';
        bc.buildSettings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/Frameworks"';
      }
    }

    // Add App Clip source files group
    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;

    const clipGroup = proj.addPbxGroup([], 'QueueFlowClip', 'QueueFlowClip');
    proj.addToPbxGroup(clipGroup.uuid, mainGroupKey);

    const clipSwiftFiles = fs.readdirSync(clipDestDir).filter(f => f.endsWith('.swift'));
    for (const file of clipSwiftFiles) {
      proj.addSourceFile(`QueueFlowClip/${file}`, { target: clipTarget.uuid }, clipGroup.uuid);
    }

    // Add shared sources to clip target
    const sharedGroup = proj.addPbxGroup([], 'QueueFlowShared', 'QueueFlowShared');
    proj.addToPbxGroup(sharedGroup.uuid, mainGroupKey);

    const sharedSwiftFiles = fs.readdirSync(sharedDestDir).filter(f => f.endsWith('.swift'));
    for (const file of sharedSwiftFiles) {
      proj.addSourceFile(`QueueFlowShared/${file}`, { target: clipTarget.uuid }, sharedGroup.uuid);
    }

    // Add assets to clip target
    proj.addResourceFile('QueueFlowClip/Assets.xcassets', { target: clipTarget.uuid }, clipGroup.uuid);

    // ── Add Live Activity Extension Target ──
    const liveTarget = addNativeTarget(
      proj,
      'QueueFlowLiveActivity',
      'com.apple.product-type.app-extension',
      LIVE_ACTIVITY_BUNDLE_ID
    );

    // Live Activity specific build settings
    for (const bcUuid of [liveTarget.debugBcUuid, liveTarget.releaseBcUuid]) {
      const bc = allConfigs[bcUuid];
      if (bc) {
        bc.buildSettings.CODE_SIGN_ENTITLEMENTS = '"QueueFlowLiveActivity/QueueFlowLiveActivity.entitlements"';
        bc.buildSettings.INFOPLIST_FILE = '"QueueFlowLiveActivity/Info.plist"';
        bc.buildSettings.APPLICATION_EXTENSION_API_ONLY = 'YES';
        bc.buildSettings.SKIP_INSTALL = 'YES';
        bc.buildSettings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/../../Frameworks"';
      }
    }

    // Add Live Activity source files group
    const liveGroup = proj.addPbxGroup([], 'QueueFlowLiveActivity', 'QueueFlowLiveActivity');
    proj.addToPbxGroup(liveGroup.uuid, mainGroupKey);

    const liveSwiftFiles = fs.readdirSync(liveActivityDestDir).filter(f => f.endsWith('.swift'));
    for (const file of liveSwiftFiles) {
      proj.addSourceFile(`QueueFlowLiveActivity/${file}`, { target: liveTarget.uuid }, liveGroup.uuid);
    }

    // Add shared sources to live activity target
    for (const file of sharedSwiftFiles) {
      proj.addSourceFile(`QueueFlowShared/${file}`, { target: liveTarget.uuid }, sharedGroup.uuid);
    }

    // ── Embed App Clip in main app ──
    const mainTarget = proj.getFirstTarget();
    if (mainTarget) {
      // Embed App Clips build phase
      proj.addBuildPhase(
        [`${clipTarget.productUuid}`],
        'PBXCopyFilesBuildPhase',
        'Embed App Clips',
        mainTarget.firstTarget.uuid,
        'app_clip'
      );

      // Embed App Extensions for Live Activity
      proj.addBuildPhase(
        [`${liveTarget.productUuid}`],
        'PBXCopyFilesBuildPhase',
        'Embed App Extensions',
        mainTarget.firstTarget.uuid,
        'plugins'
      );

      // Add target dependencies
      proj.addTargetDependency(mainTarget.firstTarget.uuid, [clipTarget.uuid]);
      proj.addTargetDependency(mainTarget.firstTarget.uuid, [liveTarget.uuid]);
    }

    return mod;
  });

  return config;
}

module.exports = withAppClip;
