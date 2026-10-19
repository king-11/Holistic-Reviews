import bazel from '@iconify-icons/vscode-icons/file-type-bazel.js';
import c from '@iconify-icons/vscode-icons/file-type-c.js';
import cpp from '@iconify-icons/vscode-icons/file-type-cpp.js';
import csharp from '@iconify-icons/vscode-icons/file-type-csharp.js';
import css from '@iconify-icons/vscode-icons/file-type-css.js';
import docker from '@iconify-icons/vscode-icons/file-type-docker.js';
import git from '@iconify-icons/vscode-icons/file-type-git.js';
import go from '@iconify-icons/vscode-icons/file-type-go.js';
import html from '@iconify-icons/vscode-icons/file-type-html.js';
import image from '@iconify-icons/vscode-icons/file-type-image.js';
import java from '@iconify-icons/vscode-icons/file-type-java.js';
import javascript from '@iconify-icons/vscode-icons/file-type-js-official.js';
import json from '@iconify-icons/vscode-icons/file-type-json.js';
import kotlin from '@iconify-icons/vscode-icons/file-type-kotlin.js';
import makefile from '@iconify-icons/vscode-icons/file-type-makefile.js';
import markdown from '@iconify-icons/vscode-icons/file-type-markdown.js';
import npm from '@iconify-icons/vscode-icons/file-type-npm.js';
import php from '@iconify-icons/vscode-icons/file-type-php.js';
import protobuf from '@iconify-icons/vscode-icons/file-type-protobuf.js';
import python from '@iconify-icons/vscode-icons/file-type-python.js';
import ruby from '@iconify-icons/vscode-icons/file-type-ruby.js';
import rust from '@iconify-icons/vscode-icons/file-type-rust.js';
import scala from '@iconify-icons/vscode-icons/file-type-scala.js';
import scss from '@iconify-icons/vscode-icons/file-type-scss.js';
import shell from '@iconify-icons/vscode-icons/file-type-shell.js';
import sql from '@iconify-icons/vscode-icons/file-type-sql.js';
import svelte from '@iconify-icons/vscode-icons/file-type-svelte.js';
import svg from '@iconify-icons/vscode-icons/file-type-svg.js';
import swift from '@iconify-icons/vscode-icons/file-type-swift.js';
import toml from '@iconify-icons/vscode-icons/file-type-toml.js';
import typescript from '@iconify-icons/vscode-icons/file-type-typescript-official.js';
import vue from '@iconify-icons/vscode-icons/file-type-vue.js';
import xml from '@iconify-icons/vscode-icons/file-type-xml.js';
import yaml from '@iconify-icons/vscode-icons/file-type-yaml.js';

const icons = {
  bazel,
  c,
  cpp,
  csharp,
  css,
  docker,
  git,
  go,
  html,
  image,
  java,
  javascript,
  json,
  kotlin,
  makefile,
  markdown,
  npm,
  php,
  protobuf,
  python,
  ruby,
  rust,
  scala,
  scss,
  shell,
  sql,
  svelte,
  svg,
  swift,
  toml,
  typescript,
  vue,
  xml,
  yaml,
};
type FileType = keyof typeof icons;

const extensions = new Map<string, FileType>([
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['js', 'javascript'],
  ['jsx', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['java', 'java'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['scala', 'scala'],
  ['py', 'python'],
  ['pyi', 'python'],
  ['pyw', 'python'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['c', 'c'],
  ['h', 'c'],
  ['cpp', 'cpp'],
  ['cc', 'cpp'],
  ['cxx', 'cpp'],
  ['hpp', 'cpp'],
  ['hxx', 'cpp'],
  ['cs', 'csharp'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['swift', 'swift'],
  ['html', 'html'],
  ['htm', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['sass', 'scss'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['json5', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['xml', 'xml'],
  ['toml', 'toml'],
  ['md', 'markdown'],
  ['mdx', 'markdown'],
  ['markdown', 'markdown'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['fish', 'shell'],
  ['sql', 'sql'],
  ['bzl', 'bazel'],
  ['bazel', 'bazel'],
  ['proto', 'protobuf'],
  ['svg', 'svg'],
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['avif', 'image'],
  ['ico', 'image'],
  ['bmp', 'image'],
  ['tif', 'image'],
  ['tiff', 'image'],
]);

const filenames = new Map<string, FileType>([
  ['dockerfile', 'docker'],
  ['containerfile', 'docker'],
  ['makefile', 'makefile'],
  ['gnumakefile', 'makefile'],
  ['build', 'bazel'],
  ['workspace', 'bazel'],
  ['.bazelrc', 'bazel'],
  ['.bazelversion', 'bazel'],
  ['.gitignore', 'git'],
  ['.gitattributes', 'git'],
  ['.gitmodules', 'git'],
  ['package.json', 'npm'],
  ['package-lock.json', 'npm'],
  ['.npmrc', 'npm'],
  ['gemfile', 'ruby'],
  ['rakefile', 'ruby'],
]);

export function fileIcon(filename: string) {
  const name = filename.split('/').at(-1)?.toLowerCase() || '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const type = filenames.get(name) || extensions.get(extension);
  return type ? { type, icon: icons[type] } : undefined;
}
