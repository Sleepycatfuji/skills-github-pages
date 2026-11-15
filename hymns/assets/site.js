// Shared navigation for the search app and its existing information pages.
(() => {
  const toggle = document.getElementById("menuToggle");
  const navigation = document.getElementById("mainNavigation");
  if (!toggle || !navigation) return;
  const paths = {
    navSearch: '<path d="m3 10 9-8 9 8M5 9v12h14V9M9 21v-8h6v8"/>',
    navHowToUse: '<path d="M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16"/>',
    navAbout: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    navChangelog: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  };
  for (const [id, path] of Object.entries(paths)) {
    const link = document.getElementById(id);
    if (link && !link.querySelector("svg")) {
      link.insertAdjacentHTML("afterbegin", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`);
    }
  }
  function syncLabel() {
    const english = document.documentElement.lang === "en";
    const opened = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-label", english ? (opened ? "Close navigation" : "Open navigation") : (opened ? "Luk navigation" : "Åbn navigation"));
    navigation.setAttribute("aria-label", english ? "Main navigation" : "Hovednavigation");
  }
  function setOpen(opened) {
    navigation.hidden = !opened;
    toggle.setAttribute("aria-expanded", String(opened));
    syncLabel();
  }
  toggle.addEventListener("click", () => setOpen(navigation.hidden));
  document.addEventListener("click", (event) => {
    if (!navigation.hidden && !navigation.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !navigation.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  // Moving focus outside the navigation also dismisses the dropdown.
  document.addEventListener("focusin", (event) => {
    if (!navigation.hidden && !navigation.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  new MutationObserver(syncLabel).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  setOpen(false);
})();
