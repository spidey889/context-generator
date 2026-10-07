// Resolve the theme before first paint so light-preference users don't
    // see a dark flash. The toolbar script below re-applies with UI state.
    (function () {
      try {
        var theme = null;
        try {
          var param = new URLSearchParams(window.location.search).get('theme');
          if (param === 'light' || param === 'dark') theme = param;
          if (new URLSearchParams(window.location.search).get('embed') === '1') {
            document.documentElement.setAttribute('data-embed', 'true');
          }
          if (new URLSearchParams(window.location.search).get('present') === '1') {
            document.documentElement.setAttribute('data-present', 'true');
          }
        } catch (_) {}
        if (!theme) {
          try { theme = localStorage.getItem('archify-theme'); } catch (_) {}
        }
        if (theme !== 'light' && theme !== 'dark') {
          theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', theme);
      } catch (_) {}
    })();
