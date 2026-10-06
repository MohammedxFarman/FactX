try {
  document.documentElement.dataset.theme=localStorage.getItem('factx-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
} catch { document.documentElement.dataset.theme='light'; }
