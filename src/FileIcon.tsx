import { ArrowRight, FileCode2, Plus } from '@lucide/vue';
import { fileIcon } from './file_icons';

export default function FileIcon(props: { filename: string }) {
  const file = fileIcon(props.filename);
  // Only static, bundled VSCode icon data can reach this SVG.
  return file ? (
    <svg
      width="16"
      height="16"
      viewBox={`0 0 ${file.icon.width || 16} ${file.icon.height || 16}`}
      data-file-type={file.type}
      aria-hidden="true"
      innerHTML={file.icon.body}
    />
  ) : (
    <FileCode2 size={16} data-file-type="unknown" aria-hidden="true" />
  );
}

// The Changes tab's mark, also used where a comment links back to its diff.
export function FileCodeIcon() {
  return (
    <span class="changes-icon">
      <ArrowRight size={12} />
      <Plus size={9} />
    </span>
  );
}
