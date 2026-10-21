export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2026-09-01',
  telemetry: false,
  devtools: { enabled: false },
  devServer: { host: '0.0.0.0', port: 5173 },
  // Pre-bundled so the dev server doesn't reload the page the first time a loader appears.
  vite: { optimizeDeps: { include: ['@lottiefiles/dotlottie-vue'] } },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Holistic Reviews - A little more focus',
      meta: [
        { name: 'theme-color', content: '#f7f5f0' },
        {
          name: 'description',
          content: 'A focused pull request review workspace. Read diffs, leave comments, and submit reviews with GitHub.',
        },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
});
