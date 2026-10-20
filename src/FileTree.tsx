import { computed, defineComponent, nextTick, onMounted, onUnmounted, shallowRef, useId, watch } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import { pop, slide } from './motion';
import { unrefElement } from '@vueuse/core';
import { Check, ChevronRight, ChevronsDownUp, Folder, FolderOpen, ListFilter, PanelLeftClose, X } from '@lucide/vue';
import type { ChangedFile } from './github';
import { IconButton, Loader, SearchField, useWidth, Dismiss } from './ui';
import { fileStatus, fileStatuses, toggleFileStatus, type FileStatus } from './file_filters';
import FileIcon from './FileIcon';
import styles from './FileTree.module.css';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: ChangedFile;
}
function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const file of files) {
    let parent = root;
    const parts = file.filename.split('/');
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let node = parent.children.find(child => child.name === name);
      if (!node) {
        node = { name, path, children: [] };
        parent.children.push(node);
      }
      if (i === parts.length - 1) node.file = file;
      parent = node;
    });
  }
  function compact(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .map(node => {
        while (!node.file && node.children.length === 1 && !node.children[0].file) {
          node = { ...node.children[0], name: `${node.name}/${node.children[0].name}` };
        }
        return { ...node, children: compact(node.children) };
      })
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
  }
  return compact(root.children);
}

type Props = {
  loading: boolean;
  files: ChangedFile[];
  allFiles: ChangedFile[];
  selected: string;
  viewed: Set<string>;
  onSelect: (filename: string) => void;
  query: string;
  onQuery: (value: string) => void;
  onClose: () => void;
  statuses: FileStatus[];
  onStatuses: (statuses: FileStatus[]) => void;
  onClearFilters: () => void;
};

export default defineComponent(
  (props: Props) => {
    const { width, handle } = useWidth('files', 272, 'right');
    const folders = shallowRef<Set<string>>(new Set());
    const allClosed = shallowRef(false);
    const filterOpen = shallowRef(false);
    const filterId = useId();
    const filterButton = shallowRef<HTMLButtonElement>();
    const filterMenu = shallowRef();
    const tree = computed(() => buildTree(props.files));
    const counts = computed(() => {
      const counts = { added: 0, modified: 0, renamed: 0, deleted: 0 };
      for (const file of props.allFiles) counts[fileStatus(file.status).value]++;
      return counts;
    });
    function closeFilters() {
      filterOpen.value = false;
      filterButton.value?.focus();
    }
    watch(filterOpen, open => {
      if (open)
        void nextTick(() => {
          if (filterOpen.value) unrefElement(filterMenu)?.querySelector('button')?.focus();
        });
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && filterOpen.value) {
        event.preventDefault();
        event.stopPropagation();
        closeFilters();
      }
    };
    onMounted(() => document.addEventListener('keydown', keydown, true));
    onUnmounted(() => document.removeEventListener('keydown', keydown, true));
    const additions = () => props.files.reduce((n, file) => n + file.additions, 0);
    const deletions = () => props.files.reduce((n, file) => n + file.deletions, 0);
    function toggleFolder(path: string) {
      if (allClosed.value) {
        allClosed.value = false;
        folders.value = new Set(tree.value.map(node => node.path).filter(other => other !== path));
        return;
      }
      const next = new Set(folders.value);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      folders.value = next;
    }
    function node(item: TreeNode, depth: number): unknown {
      if (item.file) {
        const status = fileStatus(item.file.status);
        return (
          <button
            key={item.path}
            class={`tree-file ${props.selected === item.path ? 'selected' : ''} ${props.viewed.has(item.path) ? 'viewed' : ''}`}
            data-file-status={status.value}
            style={{ 'padding-left': `${27 + depth * 15}px` }}
            title={`${status.label} · ${item.path}${item.file.previous_filename ? ` (was ${item.file.previous_filename})` : ''}`}
            onClick={() => props.onSelect(item.path)}
          >
            <FileIcon filename={item.path} />
            <span>{item.name}</span>
            <span class={`ml-auto text-xs ${styles['font-semibold']} pl-2 shrink-0`} aria-label={status.label}>
              {status.letter}
            </span>
          </button>
        );
      }
      const open = (!allClosed.value && !folders.value.has(item.path)) || !!props.query;
      return [
        <button
          key={item.path}
          class="tree-folder"
          style={{ 'padding-left': `${12 + depth * 15}px` }}
          title={`${open ? 'Collapse' : 'Expand'} ${item.path}`}
          aria-expanded={open}
          onClick={() => toggleFolder(item.path)}
        >
          <ChevronRight size={13} class={open ? 'rotated' : ''} />
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{item.name}</span>
        </button>,
        open && item.children.map(child => node(child, depth + 1)),
      ];
    }
    return () => {
      const viewedCount = props.files.filter(file => props.viewed.has(file.filename)).length;
      return (
        <motion.aside {...slide(-8)} class="file-sidebar" aria-label="Changed files" style={{ width: `${width.value}px` }}>
          {handle('Resize changed files')}
          <div class="file-sidebar-title">
            <strong>Changed files</strong>
            <span class="text-xs text-muted">{props.files.length}</span>
            <div class="spacer" />
            <div class="popover-anchor">
              <button
                ref={filterButton}
                type="button"
                class={`icon-button ${props.statuses.length ? 'active' : ''}`}
                title="Filter files by Git status"
                aria-label="Filter files by Git status"
                aria-haspopup="dialog"
                aria-expanded={filterOpen.value}
                aria-controls={filterId}
                onClick={() => {
                  filterOpen.value = !filterOpen.value;
                }}
              >
                <ListFilter size={15} />
              </button>
              {filterOpen.value && <Dismiss onClose={closeFilters} />}
              <AnimatePresence>
                {filterOpen.value && (
                  <motion.div
                    key="filters"
                    {...pop()}
                    ref={filterMenu}
                    id={filterId}
                    class="popover file-status-popover"
                    role="dialog"
                    aria-label="Filter by Git status"
                  >
                    <div class="popover-title">Filter by Git status</div>
                    <p
                      class={`pt-0 ${styles['pb-2']} px-2 text-muted text-xs leading-normal ${styles['border-b']} ${styles['border-b-border']} mb-1`}
                    >
                      Alt/Option-click to show only one status
                    </p>
                    {fileStatuses.map(status => (
                      <button
                        key={status.value}
                        type="button"
                        class={`${styles['status-filter-option']}`}
                        data-file-status={status.value}
                        title={`Toggle ${status.label.toLowerCase()} files; Alt/Option-click to show only this status`}
                        aria-pressed={props.statuses.includes(status.value)}
                        onClick={(event: MouseEvent) => props.onStatuses(toggleFileStatus(props.statuses, status.value, event.altKey))}
                      >
                        <span class={`${styles['status-filter-badge']}`}>{status.letter}</span>
                        <span>{status.label}</span>
                        <span class="ml-auto text-muted text-xs" title="Files with this status in the current comparison">
                          {counts.value[status.value]}
                        </span>
                        <span class={`w-4 text-accent`}>{props.statuses.includes(status.value) && <Check size={14} />}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      class={`${styles['status-filter-clear']}`}
                      title="Show all Git statuses"
                      disabled={!props.statuses.length}
                      onClick={() => props.onStatuses([])}
                    >
                      <X size={14} />
                      Clear filter
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <IconButton
              label={allClosed.value ? 'Expand all folders' : 'Collapse all folders'}
              onClick={() => {
                allClosed.value = !allClosed.value;
                folders.value = new Set<string>();
              }}
            >
              <ChevronsDownUp size={14} />
            </IconButton>
            <IconButton label="Hide file sidebar" onClick={props.onClose}>
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
          <SearchField
            id="file-search"
            class="file-search"
            label="Search file names"
            placeholder="Find a file…"
            clearLabel="Clear file search"
            value={props.query}
            onInput={props.onQuery}
          >
            <kbd>/</kbd>
          </SearchField>
          {props.statuses.length > 0 && (
            <div class={`${styles['file-filter-summary']}`}>
              <span>
                {fileStatuses
                  .filter(status => props.statuses.includes(status.value))
                  .map(status => status.label)
                  .join(' · ')}
              </span>
              <button
                type="button"
                title="Clear the Git status filter"
                aria-label="Clear Git status filter"
                onClick={() => props.onStatuses([])}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div class={`overflow-auto min-h-20 flex-1 pb-4`}>
            {props.files.length ? (
              tree.value.map(item => node(item, 0))
            ) : props.loading ? (
              <Loader label="Loading files…" />
            ) : (
              <div class={`${styles['tree-empty']}`}>
                No files match your filters.
                <button class="text-button" title="Clear Git status, filename, and diff-content filters" onClick={props.onClearFilters}>
                  Clear filters
                </button>
              </div>
            )}
          </div>
          <div class={`${styles['diff-summary']}`}>
            <h4>Diff summary</h4>
            <div>
              <span>Files changed</span>
              <strong>{props.files.length}</strong>
            </div>
            <div>
              <span>Additions</span>
              <strong class="additions">+{additions().toLocaleString()}</strong>
            </div>
            <div>
              <span>Deletions</span>
              <strong class="deletions">−{deletions().toLocaleString()}</strong>
            </div>
            <div class={`${styles['review-progress-label']}`}>
              <span>Viewed</span>
              <strong>
                {viewedCount} / {props.files.length}
              </strong>
            </div>
            <div class={`${styles['progress-track']}`}>
              <div style={{ width: `${props.files.length ? (viewedCount / props.files.length) * 100 : 0}%` }} />
            </div>
          </div>
          <div class={`${styles['powered-by']}`}>
            <span class="status-dot" />
            Powered by Diffs<span>↗</span>
          </div>
        </motion.aside>
      );
    };
  },
  {
    props: [
      'loading',
      'files',
      'allFiles',
      'selected',
      'viewed',
      'onSelect',
      'query',
      'onQuery',
      'onClose',
      'statuses',
      'onStatuses',
      'onClearFilters',
    ],
  },
);
