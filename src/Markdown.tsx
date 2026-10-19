import { computed, defineComponent } from 'vue';
import { renderMarkdown } from './markdown';

export default defineComponent(
  (props: { body: string; baseUrl?: string }) => {
    const html = computed(() => renderMarkdown(props.body, props.baseUrl));
    // renderMarkdown sanitizes tags, attributes, and URLs.
    return () => <div class="markdown-body" innerHTML={html.value} />;
  },
  { props: ['body', 'baseUrl'] },
);
