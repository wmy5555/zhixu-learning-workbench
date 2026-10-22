Pod::Spec.new do |s|
  s.name = 'ZhixuRuntime'
  s.version = '0.1.0'
  s.summary = 'Local filesystem, credentials and pinned networking for Zhixu'
  s.description = s.summary
  s.author = 'Zhixu contributors'
  s.homepage = 'https://github.com/wmy5555/zhixu-learning-workbench'
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.resource_bundles = { 'ZhixuRuntime_privacy' => ['PrivacyInfo.xcprivacy'] }
  s.frameworks = 'Network', 'Security', 'CryptoKit'
  s.swift_version = '5.9'
end
