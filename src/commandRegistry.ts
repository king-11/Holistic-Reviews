import { shallowRef } from 'vue';
import type { CommandContext } from './shortcuts';

export const registeredPRCommands = shallowRef<Array<() => CommandContext>>([]);
export const commandBarOpen = shallowRef(false);

export function registerPRCommands(getContext: () => CommandContext) {
  registeredPRCommands.value = [...registeredPRCommands.value, getContext];
  return () => (registeredPRCommands.value = registeredPRCommands.value.filter(context => context !== getContext));
}

export const openCommandBar = () => (commandBarOpen.value = true);
