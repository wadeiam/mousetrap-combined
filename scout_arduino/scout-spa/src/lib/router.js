// Simple hash-based router for Svelte 4
// Usage: import { currentRoute } from './lib/router.js'

import { writable } from 'svelte/store';

export const currentRoute = writable(window.location.hash.slice(1) || '/');

// Listen for hash changes
window.addEventListener('hashchange', () => {
  const path = window.location.hash.slice(1) || '/';
  currentRoute.set(path);
});

// Navigate programmatically
export function navigate(path) {
  window.location.hash = path;
}

// Link click helper (prevents default, uses hash navigation)
export function link(node) {
  function handleClick(event) {
    const href = node.getAttribute('href');
    if (href && href.startsWith('#/')) {
      event.preventDefault();
      navigate(href.slice(1)); // Remove '#'
    }
  }

  node.addEventListener('click', handleClick);

  return {
    destroy() {
      node.removeEventListener('click', handleClick);
    }
  };
}
