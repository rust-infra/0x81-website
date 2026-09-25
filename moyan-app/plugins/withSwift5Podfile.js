// Config plugin: workaround for Xcode 26.x / Swift 6.2 compiler incompatibility
// with Expo SDK 57 native code.
//
// SDK 57 podspecs declare `swift_version = '6.0'`, but the Swift 6.2.x toolchain
// ships stricter region-based "sending" isolation diagnostics that the SDK 57
// native code doesn't satisfy (e.g. expo-modules-core EventEmitter.swift:
// "sending 'emitter' risks causing data races"), producing hard build errors.
// This plugin injects a post_install hook into the generated Podfile that
// compiles those pods in Swift 5 language mode, downgrading the new diagnostics
// to warnings so the iOS build succeeds.

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# [withSwift5Podfile] Swift 6.2 toolchain workaround';

const SWIFT5_HOOK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        if config.build_settings['SWIFT_VERSION'] == '6.0'
          config.build_settings['SWIFT_VERSION'] = '5.0'
          config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        end
      end
    end
`;

function injectSwift5Hook(podfileContents) {
  if (podfileContents.includes(MARKER)) {
    return podfileContents; // already patched (idempotent)
  }

  const marker = 'post_install do |installer|';
  const index = podfileContents.indexOf(marker);
  if (index === -1) {
    throw new Error(
      'withSwift5Podfile: could not find `post_install do |installer|` in the generated Podfile'
    );
  }

  // Insert the hook just before the closing `end` of the post_install block.
  // The block content is indented deeper than 2 spaces, so the first line
  // matching /^  end$/ after `post_install do` closes the block.
  const rest = podfileContents.slice(index + marker.length);
  const blockClose = rest.search(/\n  end(?=\n)/);
  if (blockClose === -1) {
    throw new Error('withSwift5Podfile: could not find the end of the post_install block');
  }

  const insertAt = index + marker.length + blockClose;
  return (
    podfileContents.slice(0, insertAt) + SWIFT5_HOOK + podfileContents.slice(insertAt)
  );
}

module.exports = function withSwift5Podfile(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      contents = injectSwift5Hook(contents);
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};

module.exports.injectSwift5Hook = injectSwift5Hook;
