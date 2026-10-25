import { defineNuxtRouteMiddleware, navigateTo } from 'nuxt/app';
import { parsePRUrl, prPath } from '../../src/github';

// Links from before PR routes carried the PR as `/?pr=<url>`; an unparseable one just lands on the inbox.
export default defineNuxtRouteMiddleware(to => {
  if (to.path !== '/' || typeof to.query.pr !== 'string') return;
  try {
    return navigateTo({ path: prPath(parsePRUrl(to.query.pr)), hash: to.hash }, { replace: true });
  } catch {
    return;
  }
});
