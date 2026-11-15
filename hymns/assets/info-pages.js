// Static information pages share the search app's language preference.
(() => {
  const labels = {
    da: {
      appTitle: "Salme- og Koralbogssøgning",
      navSearch: "Søg",
      navHowToUse: "Sådan bruger du appen",
      navAbout: "Om appen",
      navChangelog: "Versionshistorik",
      navigation: "Hovednavigation",
      language: "Sprog",
      skip: "Spring til indhold",
    },
    en: {
      appTitle: "Danish Hymn → Chorale Finder",
      navSearch: "Search",
      navHowToUse: "How to Use",
      navAbout: "About",
      navChangelog: "Version History",
      navigation: "Main navigation",
      language: "Language",
      skip: "Skip to content",
    },
  };
  const pageTitleKeys = {
    about: "navAbout",
    "how-to-use": "navHowToUse",
    changelog: "navChangelog",
  };
  let language = "da";
  try {
    const saved = localStorage.getItem("appLanguage");
    if (saved === "da" || saved === "en") language = saved;
  } catch {
    // The pages remain usable when browser storage is unavailable.
  }

  function applyLanguage() {
    const text = labels[language];
    document.documentElement.lang = language;
    for (const key of ["appTitle", "navSearch", "navHowToUse", "navAbout", "navChangelog"]) {
      document.getElementById(key).textContent = text[key];
    }
    const title = text[pageTitleKeys[document.body.dataset.infoPage]];
    document.getElementById("pageTitle").textContent = title;
    document.title = `${title} · ${text.appTitle}`;
    document.querySelector(".site-nav").setAttribute("aria-label", text.navigation);
    document.querySelector(".toolbar-group").setAttribute("aria-label", text.language);
    document.querySelector(".skip-link").textContent = text.skip;
    document.querySelectorAll("[data-info-language]").forEach((element) => {
      element.hidden = element.dataset.infoLanguage !== language;
    });
    document.getElementById("langDaButton").setAttribute("aria-pressed", String(language === "da"));
    document.getElementById("langEnButton").setAttribute("aria-pressed", String(language === "en"));
  }

  for (const [id, code] of [["langDaButton", "da"], ["langEnButton", "en"]]) {
    document.getElementById(id).addEventListener("click", () => {
      language = code;
      try {
        localStorage.setItem("appLanguage", language);
      } catch {
        // Language switching also works without persistent storage.
      }
      applyLanguage();
    });
  }
  applyLanguage();
})();
