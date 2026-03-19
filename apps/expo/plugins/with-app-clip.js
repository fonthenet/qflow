/**
 * Expo Config Plugin: Embed native App Clip + Live Activity into the Expo build.
 *
 * Uses withDangerousMod to directly patch the .pbxproj file after prebuild,
 * avoiding the buggy xcode npm library that doesn't support App Clip product types.
 *
 * Approach: read the generated pbxproj as text, inject target definitions using
 * the same format Xcode uses. This is the most reliable method for custom targets.
 */

const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ── Constants ────────────────────────────────────────────────────────
const TEAM_ID = 'W69MRY2826';
const CLIP_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip';
const LIVE_ACTIVITY_BUNDLE_ID = 'com.queueflow.app.QueueFlowClip.LiveActivity';
const DEPLOYMENT_TARGET = '16.4';
const ASSOCIATED_DOMAIN = 'qflow-sigma.vercel.app';

// ── Helpers ──────────────────────────────────────────────────────────

function copyFolderSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyFolderSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Generate a 24-char hex UUID like Xcode does
let uuidCounter = 0xAA0000000000;
function uuid() {
  return (uuidCounter++).toString(16).toUpperCase().padStart(24, '0');
}

// ── Main Plugin ──────────────────────────────────────────────────────

function withAppClip(config) {
  // Step 1: Entitlements — add appclips domain
  config = withEntitlementsPlist(config, (mod) => {
    const domains = mod.modResults['com.apple.developer.associated-domains'] || [];
    if (!domains.includes(`appclips:${ASSOCIATED_DOMAIN}`)) domains.push(`appclips:${ASSOCIATED_DOMAIN}`);
    if (!domains.includes(`applinks:${ASSOCIATED_DOMAIN}`)) domains.push(`applinks:${ASSOCIATED_DOMAIN}`);
    mod.modResults['com.apple.developer.associated-domains'] = domains;
    return mod;
  });

  // Step 2: Info.plist
  config = withInfoPlist(config, (mod) => {
    mod.modResults.ITSAppUsesNonExemptEncryption = false;
    return mod;
  });

  // Step 3: Dangerous mod — copy files + patch pbxproj
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const iosDir = path.join(projectRoot, 'ios');
      const targetsDir = path.join(projectRoot, 'targets');

      // Find the .xcodeproj directory
      const xcodeproj = fs.readdirSync(iosDir).find(f => f.endsWith('.xcodeproj'));
      if (!xcodeproj) {
        console.warn('[with-app-clip] No .xcodeproj found, skipping');
        return modConfig;
      }
      const pbxprojPath = path.join(iosDir, xcodeproj, 'project.pbxproj');
      if (!fs.existsSync(pbxprojPath)) {
        console.warn('[with-app-clip] No project.pbxproj found, skipping');
        return modConfig;
      }

      // Copy native sources into ios/
      console.log('[with-app-clip] Copying App Clip sources...');
      copyFolderSync(path.join(targetsDir, 'QueueFlowClip'), path.join(iosDir, 'QueueFlowClip'));
      copyFolderSync(path.join(targetsDir, 'QueueFlowShared'), path.join(iosDir, 'QueueFlowShared'));
      copyFolderSync(path.join(targetsDir, 'QueueFlowLiveActivity'), path.join(iosDir, 'QueueFlowLiveActivity'));

      // Read and patch the pbxproj
      console.log('[with-app-clip] Patching pbxproj...');
      let pbx = fs.readFileSync(pbxprojPath, 'utf8');

      // Generate all UUIDs we need
      const ids = {
        // App Clip
        clipTarget: uuid(),
        clipConfigList: uuid(),
        clipDebugConfig: uuid(),
        clipReleaseConfig: uuid(),
        clipSourcesPhase: uuid(),
        clipResourcesPhase: uuid(),
        clipProduct: uuid(),
        clipGroup: uuid(),
        clipDependency: uuid(),
        clipDependencyProxy: uuid(),
        clipContainerProxy: uuid(),
        clipEmbedPhase: uuid(),
        clipEmbedBuildFile: uuid(),
        // Live Activity
        liveTarget: uuid(),
        liveConfigList: uuid(),
        liveDebugConfig: uuid(),
        liveReleaseConfig: uuid(),
        liveSourcesPhase: uuid(),
        liveProduct: uuid(),
        liveGroup: uuid(),
        liveDependency: uuid(),
        liveDependencyProxy: uuid(),
        liveContainerProxy: uuid(),
        liveEmbedPhase: uuid(),
        liveEmbedBuildFile: uuid(),
        // Shared
        sharedGroup: uuid(),
      };

      // Collect source file UUIDs
      const clipDir = path.join(iosDir, 'QueueFlowClip');
      const sharedDir = path.join(iosDir, 'QueueFlowShared');
      const liveDir = path.join(iosDir, 'QueueFlowLiveActivity');

      const clipSwiftFiles = fs.readdirSync(clipDir).filter(f => f.endsWith('.swift'));
      const sharedSwiftFiles = fs.readdirSync(sharedDir).filter(f => f.endsWith('.swift'));
      const liveSwiftFiles = fs.readdirSync(liveDir).filter(f => f.endsWith('.swift'));

      // Generate file ref + build file UUIDs for each source file
      const clipFileRefs = clipSwiftFiles.map(f => ({ name: f, ref: uuid(), build: uuid() }));
      const sharedClipFileRefs = sharedSwiftFiles.map(f => ({ name: f, ref: uuid(), build: uuid() }));
      const sharedLiveFileRefs = sharedSwiftFiles.map(f => ({ name: f, ref: uuid(), build: uuid() }));
      const liveFileRefs = liveSwiftFiles.map(f => ({ name: f, ref: uuid(), build: uuid() }));
      const clipAssetRef = uuid();
      const clipAssetBuild = uuid();

      // ── Inject PBXBuildFile entries ──
      const buildFileEntries = [
        ...clipFileRefs.map(f => `\t\t${f.build} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${f.ref} /* ${f.name} */; };`),
        ...sharedClipFileRefs.map(f => `\t\t${f.build} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${f.ref} /* ${f.name} */; };`),
        ...liveFileRefs.map(f => `\t\t${f.build} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${f.ref} /* ${f.name} */; };`),
        ...sharedLiveFileRefs.map(f => `\t\t${f.build} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${f.ref} /* ${f.name} */; };`),
        `\t\t${clipAssetBuild} /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = ${clipAssetRef} /* Assets.xcassets */; };`,
        `\t\t${ids.clipEmbedBuildFile} /* QueueFlowClip.app in Embed App Clips */ = {isa = PBXBuildFile; fileRef = ${ids.clipProduct} /* QueueFlowClip.app */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };`,
        `\t\t${ids.liveEmbedBuildFile} /* QueueFlowLiveActivity.appex in Embed App Extensions */ = {isa = PBXBuildFile; fileRef = ${ids.liveProduct} /* QueueFlowLiveActivity.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End PBXBuildFile section */',
        buildFileEntries + '\n/* End PBXBuildFile section */'
      );

      // ── Inject PBXFileReference entries ──
      const fileRefEntries = [
        ...clipFileRefs.map(f => `\t\t${f.ref} /* ${f.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${f.name}"; sourceTree = "<group>"; };`),
        ...sharedClipFileRefs.map(f => `\t\t${f.ref} /* ${f.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${f.name}"; sourceTree = "<group>"; };`),
        ...liveFileRefs.map(f => `\t\t${f.ref} /* ${f.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${f.name}"; sourceTree = "<group>"; };`),
        `\t\t${clipAssetRef} /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };`,
        `\t\t${ids.clipProduct} /* QueueFlowClip.app */ = {isa = PBXFileReference; explicitFileType = "wrapper.application"; includeInIndex = 0; path = QueueFlowClip.app; sourceTree = BUILT_PRODUCTS_DIR; };`,
        `\t\t${ids.liveProduct} /* QueueFlowLiveActivity.appex */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = QueueFlowLiveActivity.appex; sourceTree = BUILT_PRODUCTS_DIR; };`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End PBXFileReference section */',
        fileRefEntries + '\n/* End PBXFileReference section */'
      );

      // ── Inject PBXGroup entries ──
      const clipChildren = [
        ...clipFileRefs.map(f => `\t\t\t\t${f.ref} /* ${f.name} */,`),
        `\t\t\t\t${clipAssetRef} /* Assets.xcassets */,`,
      ].join('\n');

      const sharedChildren = sharedClipFileRefs.map(f => `\t\t\t\t${f.ref} /* ${f.name} */,`).join('\n');
      const liveChildren = liveFileRefs.map(f => `\t\t\t\t${f.ref} /* ${f.name} */,`).join('\n');

      const groupEntries = [
        `\t\t${ids.clipGroup} /* QueueFlowClip */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n${clipChildren}\n\t\t\t);\n\t\t\tpath = QueueFlowClip;\n\t\t\tsourceTree = "<group>";\n\t\t};`,
        `\t\t${ids.sharedGroup} /* QueueFlowShared */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n${sharedChildren}\n\t\t\t);\n\t\t\tpath = QueueFlowShared;\n\t\t\tsourceTree = "<group>";\n\t\t};`,
        `\t\t${ids.liveGroup} /* QueueFlowLiveActivity */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n${liveChildren}\n\t\t\t);\n\t\t\tpath = QueueFlowLiveActivity;\n\t\t\tsourceTree = "<group>";\n\t\t};`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End PBXGroup section */',
        groupEntries + '\n/* End PBXGroup section */'
      );

      // Add groups to main group
      pbx = pbx.replace(
        /(\s+)(children = \(\s*\n(?:\s+[A-F0-9]+ \/\* .+ \*\/,\s*\n)*?)(\s+\);[\s\S]*?mainGroup)/,
        (match, indent, children, rest) => {
          const newChildren = `${indent}${children}\t\t\t\t${ids.clipGroup} /* QueueFlowClip */,\n\t\t\t\t${ids.sharedGroup} /* QueueFlowShared */,\n\t\t\t\t${ids.liveGroup} /* QueueFlowLiveActivity */,\n${indent}${rest}`;
          return newChildren;
        }
      );

      // ── Inject Sources + Resources build phases ──
      const clipSourceFiles = [...clipFileRefs, ...sharedClipFileRefs].map(f => `\t\t\t\t${f.build} /* ${f.name} in Sources */,`).join('\n');
      const liveSourceFiles = [...liveFileRefs, ...sharedLiveFileRefs].map(f => `\t\t\t\t${f.build} /* ${f.name} in Sources */,`).join('\n');

      const sourcesPhaseEntries = [
        `\t\t${ids.clipSourcesPhase} /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n${clipSourceFiles}\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};`,
        `\t\t${ids.clipResourcesPhase} /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t${clipAssetBuild} /* Assets.xcassets in Resources */,\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};`,
        `\t\t${ids.liveSourcesPhase} /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n${liveSourceFiles}\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};`,
      ].join('\n');

      // Insert before End PBXSourcesBuildPhase (or after it if resources are separate)
      if (pbx.includes('/* End PBXSourcesBuildPhase section */')) {
        pbx = pbx.replace(
          '/* End PBXSourcesBuildPhase section */',
          sourcesPhaseEntries + '\n/* End PBXSourcesBuildPhase section */'
        );
      }

      // Insert resources phase
      if (pbx.includes('/* End PBXResourcesBuildPhase section */')) {
        // Already have a resources section, just add before the end marker
        // (the clipResourcesPhase is already in sourcesPhaseEntries, but we need it in the right section)
      }

      // ── Inject CopyFiles build phases for embedding ──
      const copyFilesEntries = [
        `\t\t${ids.clipEmbedPhase} /* Embed App Clips */ = {\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = "$(CONTENTS_FOLDER_PATH)/AppClips";\n\t\t\tdstSubfolderSpec = 16;\n\t\t\tfiles = (\n\t\t\t\t${ids.clipEmbedBuildFile} /* QueueFlowClip.app in Embed App Clips */,\n\t\t\t);\n\t\t\tname = "Embed App Clips";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};`,
        `\t\t${ids.liveEmbedPhase} /* Embed App Extensions */ = {\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = "";\n\t\t\tdstSubfolderSpec = 13;\n\t\t\tfiles = (\n\t\t\t\t${ids.liveEmbedBuildFile} /* QueueFlowLiveActivity.appex in Embed App Extensions */,\n\t\t\t);\n\t\t\tname = "Embed App Extensions";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End PBXCopyFilesBuildPhase section */',
        copyFilesEntries + '\n/* End PBXCopyFilesBuildPhase section */'
      );

      // ── Inject Container Item Proxies + Target Dependencies ──
      const proxyEntries = [
        `\t\t${ids.clipContainerProxy} /* PBXContainerItemProxy */ = {\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = 83CBB9F71A601CBA00E9B192 /* Project object */;\n\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = ${ids.clipTarget};\n\t\t\tremoteInfo = QueueFlowClip;\n\t\t};`,
        `\t\t${ids.liveContainerProxy} /* PBXContainerItemProxy */ = {\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = 83CBB9F71A601CBA00E9B192 /* Project object */;\n\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = ${ids.liveTarget};\n\t\t\tremoteInfo = QueueFlowLiveActivity;\n\t\t};`,
      ].join('\n');

      if (pbx.includes('/* End PBXContainerItemProxy section */')) {
        pbx = pbx.replace(
          '/* End PBXContainerItemProxy section */',
          proxyEntries + '\n/* End PBXContainerItemProxy section */'
        );
      } else {
        // Section doesn't exist yet, create it
        pbx = pbx.replace(
          '/* Begin PBXCopyFilesBuildPhase section */',
          `/* Begin PBXContainerItemProxy section */\n${proxyEntries}\n/* End PBXContainerItemProxy section */\n\n/* Begin PBXCopyFilesBuildPhase section */`
        );
      }

      const depEntries = [
        `\t\t${ids.clipDependency} /* PBXTargetDependency */ = {\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = ${ids.clipTarget} /* QueueFlowClip */;\n\t\t\ttargetProxy = ${ids.clipContainerProxy} /* PBXContainerItemProxy */;\n\t\t};`,
        `\t\t${ids.liveDependency} /* PBXTargetDependency */ = {\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = ${ids.liveTarget} /* QueueFlowLiveActivity */;\n\t\t\ttargetProxy = ${ids.liveContainerProxy} /* PBXContainerItemProxy */;\n\t\t};`,
      ].join('\n');

      if (pbx.includes('/* End PBXTargetDependency section */')) {
        pbx = pbx.replace(
          '/* End PBXTargetDependency section */',
          depEntries + '\n/* End PBXTargetDependency section */'
        );
      } else {
        pbx = pbx.replace(
          '/* Begin PBXVariantGroup section */',
          `/* Begin PBXTargetDependency section */\n${depEntries}\n/* End PBXTargetDependency section */\n\n/* Begin PBXVariantGroup section */`
        );
      }

      // ── Inject Build Configurations ──
      const buildSettingsClip = `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_ENTITLEMENTS = QueueFlowClip/QueueFlowClip.entitlements; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ${TEAM_ID}; ENABLE_PREVIEWS = YES; INFOPLIST_FILE = QueueFlowClip/Info.plist; IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET}; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks"; PRODUCT_BUNDLE_IDENTIFIER = "${CLIP_BUNDLE_ID}"; PRODUCT_NAME = "$(TARGET_NAME)"; SUPPORTS_MACCATALYST = NO; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2"`;
      const buildSettingsLive = `APPLICATION_EXTENSION_API_ONLY = YES; CODE_SIGN_ENTITLEMENTS = QueueFlowLiveActivity/QueueFlowLiveActivity.entitlements; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ${TEAM_ID}; INFOPLIST_FILE = QueueFlowLiveActivity/Info.plist; IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET}; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/../../Frameworks"; PRODUCT_BUNDLE_IDENTIFIER = "${LIVE_ACTIVITY_BUNDLE_ID}"; PRODUCT_NAME = "$(TARGET_NAME)"; SKIP_INSTALL = YES; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2"`;

      const configEntries = [
        `\t\t${ids.clipDebugConfig} /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\t${buildSettingsClip.split('; ').join(';\n\t\t\t\t')};\n\t\t\t};\n\t\t\tname = Debug;\n\t\t};`,
        `\t\t${ids.clipReleaseConfig} /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\t${buildSettingsClip.split('; ').join(';\n\t\t\t\t')};\n\t\t\t};\n\t\t\tname = Release;\n\t\t};`,
        `\t\t${ids.liveDebugConfig} /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\t${buildSettingsLive.split('; ').join(';\n\t\t\t\t')};\n\t\t\t};\n\t\t\tname = Debug;\n\t\t};`,
        `\t\t${ids.liveReleaseConfig} /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\t${buildSettingsLive.split('; ').join(';\n\t\t\t\t')};\n\t\t\t};\n\t\t\tname = Release;\n\t\t};`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End XCBuildConfiguration section */',
        configEntries + '\n/* End XCBuildConfiguration section */'
      );

      // ── Inject Config Lists ──
      const configListEntries = [
        `\t\t${ids.clipConfigList} /* Build configuration list for PBXNativeTarget "QueueFlowClip" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${ids.clipDebugConfig} /* Debug */,\n\t\t\t\t${ids.clipReleaseConfig} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};`,
        `\t\t${ids.liveConfigList} /* Build configuration list for PBXNativeTarget "QueueFlowLiveActivity" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${ids.liveDebugConfig} /* Debug */,\n\t\t\t\t${ids.liveReleaseConfig} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End XCConfigurationList section */',
        configListEntries + '\n/* End XCConfigurationList section */'
      );

      // ── Inject Native Targets ──
      const nativeTargetEntries = [
        `\t\t${ids.clipTarget} /* QueueFlowClip */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = ${ids.clipConfigList} /* Build configuration list for PBXNativeTarget "QueueFlowClip" */;\n\t\t\tbuildPhases = (\n\t\t\t\t${ids.clipSourcesPhase} /* Sources */,\n\t\t\t\t${ids.clipResourcesPhase} /* Resources */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = QueueFlowClip;\n\t\t\tproductName = QueueFlowClip;\n\t\t\tproductReference = ${ids.clipProduct} /* QueueFlowClip.app */;\n\t\t\tproductType = "com.apple.product-type.application.on-demand-install-capable";\n\t\t};`,
        `\t\t${ids.liveTarget} /* QueueFlowLiveActivity */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = ${ids.liveConfigList} /* Build configuration list for PBXNativeTarget "QueueFlowLiveActivity" */;\n\t\t\tbuildPhases = (\n\t\t\t\t${ids.liveSourcesPhase} /* Sources */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = QueueFlowLiveActivity;\n\t\t\tproductName = QueueFlowLiveActivity;\n\t\t\tproductReference = ${ids.liveProduct} /* QueueFlowLiveActivity.appex */;\n\t\t\tproductType = "com.apple.product-type.app-extension";\n\t\t};`,
      ].join('\n');

      pbx = pbx.replace(
        '/* End PBXNativeTarget section */',
        nativeTargetEntries + '\n/* End PBXNativeTarget section */'
      );

      // ── Add targets to project object + dependencies + embed phases to main target ──
      // Find the main target UUID and add dependencies + embed phases
      const mainTargetMatch = pbx.match(/([A-F0-9]{24}) \/\* QueueFlow \*\/ = \{\s*isa = PBXNativeTarget;/);
      if (mainTargetMatch) {
        const mainTargetUuid = mainTargetMatch[1];

        // Add target dependencies to main target
        pbx = pbx.replace(
          new RegExp(`(${mainTargetUuid} \\/\\* QueueFlow \\*\\/ = \\{[\\s\\S]*?dependencies = \\()([\\s\\S]*?)(\\);)`),
          `$1$2\t\t\t\t${ids.clipDependency} /* PBXTargetDependency */,\n\t\t\t\t${ids.liveDependency} /* PBXTargetDependency */,\n$3`
        );

        // Add embed phases to main target's buildPhases
        pbx = pbx.replace(
          new RegExp(`(${mainTargetUuid} \\/\\* QueueFlow \\*\\/ = \\{[\\s\\S]*?buildPhases = \\([\\s\\S]*?)(\\);\\s*buildRules)`),
          `$1\t\t\t\t${ids.clipEmbedPhase} /* Embed App Clips */,\n\t\t\t\t${ids.liveEmbedPhase} /* Embed App Extensions */,\n\t\t\t$2`
        );
      }

      // Add targets to project's targets list
      pbx = pbx.replace(
        /(targets = \(\s*\n(?:\s+[A-F0-9]+ \/\* .+ \*\/,?\s*\n)*?)(\s+\);)/,
        `$1\t\t\t\t${ids.clipTarget} /* QueueFlowClip */,\n\t\t\t\t${ids.liveTarget} /* QueueFlowLiveActivity */,\n$2`
      );

      // Add products to Products group
      pbx = pbx.replace(
        /(\/\* Products \*\/ = \{\s*isa = PBXGroup;\s*children = \(\s*\n(?:\s+[A-F0-9]+ \/\* .+ \*\/,?\s*\n)*?)(\s+\);)/,
        `$1\t\t\t\t${ids.clipProduct} /* QueueFlowClip.app */,\n\t\t\t\t${ids.liveProduct} /* QueueFlowLiveActivity.appex */,\n$2`
      );

      // Write patched pbxproj
      fs.writeFileSync(pbxprojPath, pbx, 'utf8');
      console.log('[with-app-clip] Successfully patched pbxproj with App Clip + Live Activity targets');

      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAppClip;
