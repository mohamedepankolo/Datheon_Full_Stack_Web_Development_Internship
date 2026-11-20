// Independent theme switch: no changes to original navigation or scripts.
(function () {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const initial = 'dark';
  function render(theme) {
    root.dataset.theme = theme;
    button.querySelector('ion-icon').setAttribute('name', theme === 'dark' ? 'sunny-outline' : 'moon-outline');
    button.querySelector('span').textContent = theme === 'dark' ? 'Light' : 'Dark';
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    button.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  render(initial);
  button.addEventListener('click', function () {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    render(next);

  });
})();
