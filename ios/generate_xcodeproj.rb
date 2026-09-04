#!/usr/bin/env ruby
# Generates ios/KathaApp.xcodeproj — an iOS app target for the KathaApp SwiftUI
# sources, depending on the local KathaKit Swift package. Run from ios/.
require 'xcodeproj'

here = File.expand_path(File.dirname(__FILE__))
proj_path = File.join(here, 'KathaApp.xcodeproj')
File.delete(proj_path) rescue nil
FileUtils.rm_rf(proj_path) rescue nil

project = Xcodeproj::Project.new(proj_path)
target = project.new_target(:application, 'KathaApp', :ios, '17.0')

# Source files (compiled into the app module).
group = project.new_group('KathaApp', 'KathaApp')
Dir[File.join(here, 'KathaApp', '*.swift')].sort.each do |f|
  ref = group.new_reference(File.basename(f))
  target.add_file_references([ref])
end

# Brand imagery and the App Store icon. Keep the catalog as a folder reference
# so newly added image sets are picked up whenever this project is regenerated.
assets_path = File.join(here, 'KathaApp', 'Assets.xcassets')
assets_ref = group.new_reference('Assets.xcassets')
target.resources_build_phase.add_file_reference(assets_ref, true)

# App Store privacy manifest — bundled as a resource so App Review sees it.
privacy_ref = group.new_reference('PrivacyInfo.xcprivacy')
target.resources_build_phase.add_file_reference(privacy_ref, true)

# StoreKit configuration for local/simulator purchases (the five coin packs as
# consumables). Not a bundle resource; the shared scheme below points the run
# action at it so Product.products(for:) resolves without App Store Connect.
storekit_ref = group.new_reference('Katha.storekit')

# The display face (Anton, OFL) — folder reference so the license ships too.
fonts_ref = group.new_reference('Fonts')
target.resources_build_phase.add_file_reference(fonts_ref, true)

# Local Swift package dependency on ../KathaKit (path is relative to the project dir).
local = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
local.relative_path = 'KathaKit'
project.root_object.package_references ||= []
project.root_object.package_references << local

dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
dep.product_name = 'KathaKit'
dep.package = local
target.package_product_dependencies << dep

build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
build_file.product_ref = dep
target.frameworks_build_phase.files << build_file

# Per-configuration settings: the API base comes from Config/{Debug,Release}
# .xcconfig (Info.plist reads $(KATHA_API_BASE)), and each configuration has
# its own plist — Info-Debug.plist allows local networking for the dev Mac,
# Info.plist (Release) carries no ATS exception at all.
config_group = group.new_group('Config', 'Config')
xcconfigs = {}
%w[Debug Release].each do |name|
  xcconfigs[name] = config_group.new_reference("#{name}.xcconfig")
end
config_group.new_reference('Local.xcconfig.example')

# Build settings for a simulator-runnable, unsigned app.
target.build_configurations.each do |cfg|
  s = cfg.build_settings
  cfg.base_configuration_reference = xcconfigs[cfg.name] if xcconfigs[cfg.name]
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'dev.katha.app'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = cfg.name == 'Debug' ? 'KathaApp/Info-Debug.plist' : 'KathaApp/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  # Swift 6 language mode: the app target has the real concurrency
  # (AVFoundation callbacks, notification delegates, StoreKit streams), and
  # every data-race diagnostic is a compile error, not a warning.
  s['SWIFT_VERSION'] = '6.0'
  s['SWIFT_STRICT_CONCURRENCY'] = 'complete'
  s['MARKETING_VERSION'] = '1.0.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  if ENV['KATHA_TEAM'] && !ENV['KATHA_TEAM'].empty?
    # Real-device build: automatic signing under the given team.
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s['DEVELOPMENT_TEAM'] = ENV['KATHA_TEAM']
    s['CODE_SIGN_IDENTITY'] = 'Apple Development'
    # Push capability: signed device builds carry the APNs entitlement so
    # registerForRemoteNotifications yields a real token.
    # Debug talks to the APNs sandbox; Release must carry the production
    # aps-environment or pushes never arrive on TestFlight/App Store builds.
    s['CODE_SIGN_ENTITLEMENTS'] = cfg.name == 'Release' ? 'KathaApp/KathaApp-Release.entitlements'
                                                        : 'KathaApp/KathaApp.entitlements'
  else
    s['CODE_SIGNING_ALLOWED'] = 'NO'
    s['CODE_SIGNING_REQUIRED'] = 'NO'
    s['CODE_SIGN_IDENTITY'] = ''
  end
  s['ENABLE_PREVIEWS'] = 'YES'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'NO'
end

# UI-test bundle (XCUITest) — the e2e suite that drives every screen. It taps
# through the real app against the live core-api; `xcodebuild test` runs it.
ui_target = project.new_target(:ui_test_bundle, 'KathaAppUITests', :ios, '17.0')
ui_group = project.new_group('KathaAppUITests', 'KathaAppUITests')
Dir[File.join(here, 'KathaAppUITests', '*.swift')].sort.each do |f|
  ref = ui_group.new_reference(File.basename(f))
  ui_target.add_file_references([ref])
end
ui_target.add_dependency(target)
ui_target.build_configurations.each do |cfg|
  s = cfg.build_settings
  s['TEST_TARGET_NAME'] = 'KathaApp'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'dev.katha.uitests'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1'
  if ENV['KATHA_TEAM'] && !ENV['KATHA_TEAM'].empty?
    # Device test runs: the UI-test runner must be signed like the app.
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s['DEVELOPMENT_TEAM'] = ENV['KATHA_TEAM']
    s['CODE_SIGN_IDENTITY'] = 'Apple Development'
  else
    s['CODE_SIGNING_ALLOWED'] = 'NO'
    s['CODE_SIGNING_REQUIRED'] = 'NO'
    s['CODE_SIGN_IDENTITY'] = ''
  end
end

project.save

puts "Wrote #{proj_path}"
puts "Targets: #{project.targets.map(&:name).join(', ')}"
puts "Sources: #{target.source_build_phase.files.count} files"
puts "UI tests: #{ui_target.source_build_phase.files.count} files"
puts "Package deps: #{target.package_product_dependencies.map(&:product_name).join(', ')}"

# Shared scheme so xcodebuild -scheme works headlessly (build, run and test),
# with the StoreKit configuration attached to the run action so purchases work
# on a simulator straight away — no Edit Scheme ▸ Run ▸ Options step.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.add_test_target(ui_target)
# xcodeproj has no API for this element, so write the XML Xcode itself writes.
# The identifier is a path relative to the .xcscheme file
# (xcshareddata/xcschemes/ → ../../KathaApp/Katha.storekit).
launch_xml = scheme.launch_action.xml_element
launch_xml.delete_element('StoreKitConfigurationFileReference')
launch_xml.add_element('StoreKitConfigurationFileReference',
                       'identifier' => '../../KathaApp/Katha.storekit')
scheme.save_as(proj_path, 'KathaApp', true)
puts "Scheme: KathaApp (shared, with test action + StoreKit config)"
