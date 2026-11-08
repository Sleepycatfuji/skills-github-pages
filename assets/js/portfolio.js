(() => {
  // Without JavaScript, all project information stays visible.
  document.querySelectorAll('[data-project-disclosure]').forEach((button) => {
    const region = document.getElementById(button.getAttribute('aria-controls'));
    if (!region) return;

    let animation;
    region.hidden = true;
    button.hidden = false;

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      animation?.cancel();

      if (expanded && region.contains(document.activeElement)) button.focus();
      region.hidden = expanded;
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? button.dataset.moreLabel : button.dataset.lessLabel;

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!expanded && !reduceMotion && typeof region.animate === 'function') {
        animation = region.animate(
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 240, easing: 'ease-out' }
        );
      }
    });
  });

  const menuButton = document.querySelector('.nav-toggle');
  const navigation = document.getElementById(menuButton?.getAttribute('aria-controls'));
  if (!menuButton || !navigation) return;

  const setMenuOpen = (open) => {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.textContent = open ? menuButton.dataset.closeLabel : menuButton.dataset.menuLabel;
    navigation.dataset.menuOpen = String(open);
  };

  setMenuOpen(false);
  menuButton.hidden = false;
  document.documentElement.classList.add('portfolio-enhanced');

  menuButton.addEventListener('click', () => {
    setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navigation.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || menuButton.getAttribute('aria-expanded') !== 'true') return;
    setMenuOpen(false);
    const section = document.getElementById(link.hash.slice(1));
    if (section) {
      section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      setMenuOpen(false);
      menuButton.focus();
    }
  });

  window.matchMedia?.('(max-width: 1100px)').addEventListener('change', () => setMenuOpen(false));
})();
