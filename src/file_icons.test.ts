import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileIcon } from './file_icons.ts';

describe('sidebar file-type icons', () => {
  const images = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff'].map(extension => [
    `assets/image.${extension.toUpperCase()}`,
    'image',
  ]);
  const cases: [string, string | undefined][] = [
    ['Worker.java', 'java'],
    ['worker.py', 'python'],
    ['worker.go', 'go'],
    ['lib.rs', 'rust'],
    ['worker.kt', 'kotlin'],
    ['build.kts', 'kotlin'],
    ['Worker.scala', 'scala'],
    ['worker.c', 'c'],
    ['worker.h', 'c'],
    ['worker.cc', 'cpp'],
    ['worker.hpp', 'cpp'],
    ['Worker.cs', 'csharp'],
    ['worker.rb', 'ruby'],
    ['worker.php', 'php'],
    ['Worker.swift', 'swift'],
    // JSX/TSX must not imply React.
    ...['app.js', 'app.jsx', 'app.mjs', 'app.cjs'].map(name => [name, 'javascript'] as [string, string]),
    ...['app.ts', 'app.tsx', 'app.mts', 'app.cts', 'app.d.ts'].map(name => [name, 'typescript'] as [string, string]),
    ['App.vue', 'vue'],
    ['App.svelte', 'svelte'],
    ['README.md', 'markdown'],
    ['docs.mdx', 'markdown'],
    ['guide.markdown', 'markdown'],
    ['app.html', 'html'],
    ['app.htm', 'html'],
    ['styles.css', 'css'],
    ['styles.scss', 'scss'],
    ['data.json', 'json'],
    ['tsconfig.json', 'json'],
    ['data.jsonc', 'json'],
    ['data.json5', 'json'],
    ['settings.yaml', 'yaml'],
    ['settings.yml', 'yaml'],
    ['pom.xml', 'xml'],
    ['Cargo.toml', 'toml'],
    ['query.sql', 'sql'],
    ['task.sh', 'shell'],
    ['task.zsh', 'shell'],
    ['schema.proto', 'protobuf'],
    ...['BUILD', 'BUILD.bazel', 'WORKSPACE', 'WORKSPACE.bazel', '.bazelrc', '.bazelversion', 'rules.bzl'].map(
      name => [name, 'bazel'] as [string, string],
    ),
    ['Dockerfile', 'docker'],
    ['Containerfile', 'docker'],
    ['Makefile', 'makefile'],
    ['.gitignore', 'git'],
    ['.gitattributes', 'git'],
    ['package.json', 'npm'],
    ['package-lock.json', 'npm'],
    ['Gemfile', 'ruby'],
    ['java/not-python/Main.PY', 'python'],
    ['src/nested/Component.TSX', 'typescript'],
    ['infra/nested/BUILD.BAZEL', 'bazel'],
    ['services/api/Dockerfile', 'docker'],
    ['src/file.java/unknown', undefined],
    ...(images as [string, string][]),
    ['assets/logo.SVG', 'svg'],
    ...[
      '',
      'unknown',
      'file.unknown',
      'file.',
      '.hidden',
      '__proto__',
      'file.__proto__',
      'constructor',
      'file.constructor',
      'toString',
      'file.toString',
      '<img onerror=alert(1)>.unknown',
    ].map(name => [name, undefined] as [string, undefined]),
    ['<img onerror=alert(1)>.py', 'python'],
  ];
  for (const [name, type] of cases) {
    it(`${JSON.stringify(name)} → ${type ?? 'generic fallback'}`, () => assert.equal(fileIcon(name)?.type, type));
  }

  it('uses only bundled, self-contained SVGs without filenames or network references', () => {
    for (const name of ['<script>.java', 'app.tsx', 'lib.rs', 'BUILD.bazel', 'Dockerfile', '.gitignore', 'logo.svg', 'image.jpeg']) {
      const icon = fileIcon(name)?.icon;
      assert.ok(icon?.width && icon.height && icon.body);
      assert.doesNotMatch(icon.body, /<script|<foreignObject|\bon\w+=|\bhref\s*=|<img|<image/i);
    }
    assert.equal(fileIcon('src/new.py')?.icon, fileIcon('old/location.py')?.icon);
    assert.notEqual(fileIcon('src/new.ts')?.icon, fileIcon('old/location.py')?.icon);
  });
});
