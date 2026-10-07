var Archify = {};
    var archifyI18nData = (function () {
      var node = document.getElementById('archify-i18n-data');
      try { return JSON.parse(node ? node.textContent : '{}'); }
      catch (_) { return { locale: 'en', messages: {} }; }
    })();
    Archify.locale = archifyI18nData.locale || 'en';

    function viewerText(key, values) {
      var messages = archifyI18nData.messages || {};
      var template = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : key;
      return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, function (match, name) {
        return values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match;
      });
    }

    function viewerCount(key, count, values) {
      var suffix = Number(count) === 1 ? '.one' : '.other';
      var payload = Object.assign({}, values || {}, { count: count });
      return viewerText(key + suffix, payload);
    }

    function viewerKindLabel(value) {
      var normalized = String(value || 'node').toLowerCase();
      var knownKey = 'viewer.kind.' + normalized;
      var known = viewerText(knownKey);
      if (known !== knownKey) return known;
      return normalized
        .replace(/messagebus/gi, 'message bus')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
    }

    function hasDrawableGeometry(element) {
      if (!element) return false;
      var geometries = /^(path|line|polyline)$/i.test(element.tagName)
        ? [element]
        : Array.prototype.slice.call(element.querySelectorAll('path, line, polyline'));
      return geometries.some(function (geometry) {
        var source = geometry.tagName.toLowerCase() === 'path'
          ? geometry.getAttribute('d')
          : geometry.tagName.toLowerCase() === 'polyline'
            ? geometry.getAttribute('points')
            : [geometry.getAttribute('x1'), geometry.getAttribute('y1'), geometry.getAttribute('x2'), geometry.getAttribute('y2')].join(' ');
        if (!source || /(?:^|[^a-z])(?:nan|infinity)(?:[^a-z]|$)/i.test(source) || typeof geometry.getTotalLength !== 'function') return false;
        try {
          var length = Number(geometry.getTotalLength());
          return Number.isFinite(length) && length > 0;
        } catch (_) {
          return false;
        }
      });
    }

    /* ============================================================
       Visual style try-on — one topology, four bundled presets.
       The reader's choice is intentionally session-only: it updates the
       live page and canonical SVG together, but never rewrites the source,
       URL, or a later diagram's authored default.
       ============================================================ */
    Archify.preset = (function () {
      var PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];
      var LABELS = {
        classic: viewerText('viewer.preset.classic.short'),
        'signal-flow': viewerText('viewer.preset.flow.short'),
        blueprint: viewerText('viewer.preset.blueprint'),
        editorial: viewerText('viewer.preset.editorial')
      };
      var html = document.documentElement;
      var svg = document.querySelector('.diagram-container svg');
      var btn = document.getElementById('btn-preset');
      var label = document.getElementById('preset-label');
      var menu = document.getElementById('preset-menu');
      var options = function () {
        return Array.prototype.slice.call(menu.querySelectorAll('[data-preset-value]'));
      };
      var authored = PRESETS.indexOf(html.getAttribute('data-preset')) >= 0
        ? html.getAttribute('data-preset')
        : 'classic';

      function current() {
        var value = html.getAttribute('data-preset');
        return PRESETS.indexOf(value) >= 0 ? value : authored;
      }
      function nextAfter(preset) {
        return PRESETS[(PRESETS.indexOf(preset) + 1) % PRESETS.length];
      }
      function apply(preset) {
        if (html.getAttribute('data-embed') === 'true') return false;
        if (PRESETS.indexOf(preset) < 0) return false;
        html.setAttribute('data-preset', preset);
        svg.setAttribute('data-preset', preset);
        btn.setAttribute('data-preset-option', preset);
        label.textContent = LABELS[preset];
        btn.setAttribute('aria-label', viewerText('viewer.preset.current', { style: LABELS[preset] }));
        btn.title = viewerText('viewer.preset.choose.title');
        options().forEach(function (option) {
          var selected = option.getAttribute('data-preset-value') === preset;
          option.setAttribute('aria-checked', String(selected));
        });
        return true;
      }
      function cycle() { return apply(nextAfter(current())); }

      function isOpen() { return menu.classList.contains('open'); }
      function open(focusLast) {
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        menu.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        var available = options();
        var selected = available.find(function (option) { return option.getAttribute('aria-checked') === 'true'; });
        var target = focusLast ? available[available.length - 1] : (selected || available[0]);
        if (target) target.focus();
        return true;
      }
      function close(focusTrigger) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        if (focusTrigger) btn.focus();
        return false;
      }

      apply(authored);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(false);
        else open(false);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen()) open(e.key === 'ArrowUp');
        }
      });
      document.addEventListener('click', function (e) {
        if (!menu.contains(e.target) && e.target !== btn) close(false);
      });
      menu.addEventListener('click', function (e) {
        var option = e.target.closest('[data-preset-value]');
        if (!option || !menu.contains(option)) return;
        if (apply(option.getAttribute('data-preset-value'))) close(true);
      });
      menu.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        if (e.key === 'Tab') { close(false); return; }
        var available = options();
        var active = available.indexOf(document.activeElement);
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (available.length) available[(active + 1 + available.length) % available.length].focus();
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (available.length) available[(active - 1 + available.length) % available.length].focus();
            break;
          case 'Home':
            e.preventDefault();
            if (available[0]) available[0].focus();
            break;
          case 'End':
            e.preventDefault();
            if (available.length) available[available.length - 1].focus();
            break;
        }
      });
      return { cycle: cycle, apply: apply, current: current, authored: authored, open: open, close: close, isOpen: isOpen };
    })();

    /* ============================================================
       Theme toggle — persists to localStorage, respects system pref
       ============================================================ */

    Archify.theme = (function () {
      var STORAGE_KEY = 'archify-theme';
      var html = document.documentElement;
      var btn = document.getElementById('btn-theme');
      var label = document.getElementById('theme-label');

      // localStorage can throw (blocked cookies, sandboxed iframes); the whole
      // script element dies on an uncaught error, so guard every access.
      function readStored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
      }
      function writeStored(value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (_) {}
      }
      function urlOverride() {
        // URL param wins (useful for deterministic screenshots / share links)
        try {
          var param = new URLSearchParams(window.location.search).get('theme');
          if (param === 'light' || param === 'dark') return param;
        } catch (_) {}
        return null;
      }

      function resolveInitial() {
        var fromUrl = urlOverride();
        if (fromUrl) return fromUrl;
        var saved = readStored();
        if (saved === 'light' || saved === 'dark') return saved;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }

      function apply(theme) {
        html.setAttribute('data-theme', theme);
        label.textContent = viewerText(theme === 'dark' ? 'viewer.theme.dark' : 'viewer.theme.light');
        btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      }

      function toggle() {
        var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        writeStored(next);
      }

      apply(resolveInitial());
      btn.addEventListener('click', toggle);

      // Follow live OS theme changes while the user has no explicit preference.
      try {
        var media = window.matchMedia('(prefers-color-scheme: light)');
        var onChange = function (e) {
          var saved = readStored();
          if (urlOverride() || saved === 'light' || saved === 'dark') return;
          apply(e.matches ? 'light' : 'dark');
        };
        if (media.addEventListener) media.addEventListener('change', onChange);
        else if (media.addListener) media.addListener(onChange);
      } catch (_) {}

      return { toggle: toggle };
    })();

    /* ============================================================
       Export — Share Card / PNG / JPEG / WebP / SVG / WebM and clipboard

       Raster exports are always rendered at 4x source resolution for
       maximum sharpness. The trick: we set the serialized SVG's
       `width`/`height` to viewBox * 4 so the browser rasterizes the
       vectors at that resolution natively. drawImage then draws at
       the image's natural size (no upscaling = no blur).

       JPEG/WebP paint the current theme's background explicitly since
       those formats have no alpha channel.
       ============================================================ */
    (function () {
      var RASTER_SCALE = 4;
      var MOTION_DURATION = 6000;
      var MOTION_FPS = 30;
      var SHARE_CARD_WIDTH = 1200;
      var SHARE_CARD_HEIGHT = 630;
      var SHARE_CARD_PADDING = 40;
      var SHARE_CARD_HEADER = 124;

      function exportError(key, values) {
        var error = new Error(viewerText(key, values));
        error.archifyViewerMessage = true;
        return error;
      }

      function exportMessage(error) {
        return error && error.archifyViewerMessage
          ? error.message
          : viewerText('viewer.export.unknown');
      }

      function diagramFilename() {
        var title = (document.title || 'diagram')
          .replace(/\s+Architecture(\s+Diagram)?$/i, '')
          .replace(/\s+Diagram$/i, '')
          .trim();
        return title.replace(/[^a-z0-9_\-]+/gi, '-')
                    .toLowerCase()
                    .replace(/^-+|-+$/g, '') || 'diagram';
      }

      function currentBg() {
        return getComputedStyle(document.body).backgroundColor || '#ffffff';
      }

      function cleanExportClone(clone) {
        // View transforms and neighborhood focus are HTML exploration state,
        // never part of a downloaded full-diagram artifact.
        clone.style.removeProperty('transform');
        clone.style.removeProperty('clip-path');
        clone.removeAttribute('data-view-scale');
        clone.removeAttribute('data-focus-active');
        clone.removeAttribute('data-reach-active');
        clone.removeAttribute('data-lens-active');
        clone.removeAttribute('data-lens-flow-count');
        clone.removeAttribute('data-lens-flow-density');
        clone.removeAttribute('data-legend-preview-active');
        clone.removeAttribute('data-relationship-preview-active');
        clone.removeAttribute('data-relationship-direct-active');
        clone.removeAttribute('data-relationship-pin-active');
        clone.removeAttribute('data-intent-trace-active');
        clone.removeAttribute('data-route-picking');
        clone.removeAttribute('data-route-active');
        clone.removeAttribute('data-route-journey');
        clone.removeAttribute('data-share-route');
        clone.removeAttribute('data-share-reach');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-intent-trace-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-probe-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-journey-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-semantic-lens-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-bridge-runtime]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-kind]'), function (el) {
          el.removeAttribute('data-legend-kind');
          el.removeAttribute('data-legend-label');
          el.removeAttribute('data-legend-count');
          el.removeAttribute('data-legend-zero');
          el.removeAttribute('data-legend-selected');
          el.removeAttribute('role');
          el.removeAttribute('tabindex');
          el.removeAttribute('aria-label');
          el.removeAttribute('aria-pressed');
          el.removeAttribute('aria-haspopup');
          el.removeAttribute('aria-controls');
          el.removeAttribute('aria-expanded');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-bridge]'), function (el) {
          el.removeAttribute('data-legend-bridge');
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-pulse-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-hit-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-source-evidence-beacon]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-source-evidence-count]'), function (el) {
          var originalLabel = el.getAttribute('data-source-evidence-original-label');
          if (originalLabel == null || originalLabel === '') el.removeAttribute('aria-label');
          else el.setAttribute('aria-label', originalLabel);
          el.removeAttribute('data-source-evidence-count');
          el.removeAttribute('data-source-evidence-original-label');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-focus-match], [data-focus-selected]'), function (el) {
          el.removeAttribute('data-focus-match');
          el.removeAttribute('data-focus-selected');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-reach-match], [data-reach-origin], [data-reach-depth]'), function (el) {
          el.removeAttribute('data-reach-match');
          el.removeAttribute('data-reach-origin');
          el.removeAttribute('data-reach-depth');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-lens-match], [data-lens-selected], [data-lens-peer]'), function (el) {
          el.removeAttribute('data-lens-match');
          el.removeAttribute('data-lens-selected');
          el.removeAttribute('data-lens-peer');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer]'), function (el) {
          el.removeAttribute('data-legend-preview-match');
          el.removeAttribute('data-legend-preview-selected');
          el.removeAttribute('data-legend-preview-peer');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-preview], [data-relationship-preview-node], [data-relationship-preview-source], [data-relationship-preview-target]'), function (el) {
          el.removeAttribute('data-relationship-preview');
          el.removeAttribute('data-relationship-preview-node');
          el.removeAttribute('data-relationship-preview-source');
          el.removeAttribute('data-relationship-preview-target');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-intent-trace-match], [data-intent-trace-selected]'), function (el) {
          el.removeAttribute('data-intent-trace-match');
          el.removeAttribute('data-intent-trace-selected');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-match], [data-route-start], [data-route-end], [data-route-step], [data-route-candidate], [data-route-journey-state], [data-route-journey-current]'), function (el) {
          el.removeAttribute('data-route-match');
          el.removeAttribute('data-route-start');
          el.removeAttribute('data-route-end');
          el.removeAttribute('data-route-step');
          el.removeAttribute('data-route-candidate');
          el.removeAttribute('data-route-journey-state');
          el.removeAttribute('data-route-journey-current');
          el.style.removeProperty('--route-step');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle]'), function (el) {
          el.removeAttribute('data-share-route-match');
          el.removeAttribute('data-share-route-step');
          el.removeAttribute('data-share-route-start');
          el.removeAttribute('data-share-route-end');
          el.removeAttribute('data-share-route-middle');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-share-reach-match], [data-share-reach-origin], [data-share-reach-depth]'), function (el) {
          el.removeAttribute('data-share-reach-match');
          el.removeAttribute('data-share-reach-origin');
          el.removeAttribute('data-share-reach-depth');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-detail], [data-detail-anchor]'), function (el) {
          el.removeAttribute('data-detail');
          el.removeAttribute('data-detail-anchor');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-node-id][aria-pressed]'), function (el) {
          el.setAttribute('aria-pressed', 'false');
        });
        return !clone.hasAttribute('data-view-scale') &&
          !clone.hasAttribute('data-focus-active') &&
          !clone.hasAttribute('data-reach-active') &&
          !clone.hasAttribute('data-lens-active') &&
          !clone.hasAttribute('data-lens-flow-count') &&
          !clone.hasAttribute('data-lens-flow-density') &&
          !clone.hasAttribute('data-legend-preview-active') &&
          !clone.hasAttribute('data-relationship-preview-active') &&
          !clone.hasAttribute('data-relationship-direct-active') &&
          !clone.hasAttribute('data-intent-trace-active') &&
          !clone.hasAttribute('data-route-picking') &&
          !clone.hasAttribute('data-route-active') &&
          !clone.hasAttribute('data-route-journey') &&
          !clone.hasAttribute('data-share-route') &&
          !clone.hasAttribute('data-share-reach') &&
          !clone.style.getPropertyValue('transform') &&
          !clone.style.getPropertyValue('clip-path') &&
          clone.querySelectorAll('[data-focus-match], [data-focus-selected], [data-reach-match], [data-reach-origin], [data-reach-depth], [data-semantic-lens-overlay], [data-lens-match], [data-lens-selected], [data-lens-peer], [data-legend-bridge], [data-legend-kind], [data-legend-bridge-runtime], [data-legend-count], [data-legend-zero], [data-legend-selected], [data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer], [data-relationship-hit-overlay], [data-relationship-pulse-overlay], [data-relationship-preview], [data-relationship-preview-node], [data-relationship-preview-source], [data-relationship-preview-target], [data-intent-trace-overlay], [data-intent-trace-match], [data-intent-trace-selected], [data-route-probe-overlay], [data-route-journey-overlay], [data-route-match], [data-route-start], [data-route-end], [data-route-step], [data-route-candidate], [data-route-journey-state], [data-route-journey-current], [data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle], [data-share-reach-match], [data-share-reach-origin], [data-share-reach-depth], [data-source-evidence-beacon], [data-source-evidence-count], [data-source-evidence-original-label], [data-detail], [data-detail-anchor]').length === 0;
      }


      /**
       * Serialize the main SVG into a standalone document.
       *
       * Two modes:
       * - Default (opts.autoTheme=false) — locks the serialized SVG to the
       *   viewer's current theme. Used by the raster pipeline
       *   (PNG/JPEG/WebP/clipboard) because canvas rasterization needs
       *   deterministic colors; a raster cannot react to
       *   prefers-color-scheme after encoding.
       * - theme=auto — emits BOTH dark and light variable sets plus a
       *   `@media (prefers-color-scheme)` rule so the resulting SVG
       *   self-themes when embedded in GitHub READMEs or other hosts that
       *   expose a color scheme. Used for the default "Download SVG".
       * - theme=light|dark — locks the standalone SVG to the requested
       *   theme, independently of its source Viewer and host OS themes.
       */
      function applyRouteSnapshot(clone, snapshot) {
        if (!snapshot || !Array.isArray(snapshot.nodeIds) || !Array.isArray(snapshot.edges) ||
            snapshot.nodeIds.length < 2 || snapshot.edges.length !== snapshot.nodeIds.length - 1 ||
            snapshot.hops !== snapshot.edges.length ||
            !snapshot.source || !snapshot.target ||
            snapshot.source.id !== snapshot.nodeIds[0] ||
            snapshot.target.id !== snapshot.nodeIds[snapshot.nodeIds.length - 1]) return false;

        clone.removeAttribute('data-animation');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-animate]'), function (element) {
          element.removeAttribute('data-animate');
          element.style.removeProperty('--step');
        });

        var cloneNodes = Array.prototype.slice.call(clone.querySelectorAll('[data-node-id]'));
        var cloneEdges = Array.prototype.slice.call(clone.querySelectorAll('[data-edge-key]'));
        var nodeIds = Object.create(null);
        var edgeKeys = Object.create(null);
        var nodeMatches = [];
        var edgeMatches = [];

        for (var nodeIndex = 0; nodeIndex < snapshot.nodeIds.length; nodeIndex++) {
          var nodeId = snapshot.nodeIds[nodeIndex];
          if (typeof nodeId !== 'string' || !nodeId || nodeIds[nodeId]) return false;
          var matchedNodes = cloneNodes.filter(function (candidate) {
            return candidate.getAttribute('data-node-id') === nodeId;
          });
          if (matchedNodes.length !== 1) return false;
          nodeIds[nodeId] = true;
          nodeMatches.push(matchedNodes);
        }

        for (var edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex++) {
          var edge = snapshot.edges[edgeIndex];
          var fromId = snapshot.nodeIds[edgeIndex];
          var toId = snapshot.nodeIds[edgeIndex + 1];
          if (!edge || typeof edge.key !== 'string' || !edge.key || edgeKeys[edge.key] ||
              edge.from !== fromId || edge.to !== toId) return false;
          var matchedEdges = cloneEdges.filter(function (candidate) {
            return candidate.getAttribute('data-edge-key') === edge.key;
          });
          var drawableMatches = matchedEdges.filter(hasDrawableGeometry);
          if (!matchedEdges.length || drawableMatches.length !== 1 || !matchedEdges.every(function (candidate) {
            return candidate.getAttribute('data-edge-from') === edge.from &&
              candidate.getAttribute('data-edge-to') === edge.to &&
              (candidate.getAttribute('data-edge-id') || '') === (edge.id || '');
          })) return false;
          edgeKeys[edge.key] = true;
          edgeMatches.push(matchedEdges);
        }

        clone.setAttribute('data-share-route', '');
        nodeMatches.forEach(function (matches, step) {
          matches.forEach(function (element) {
            element.setAttribute('data-share-route-match', '');
            element.setAttribute('data-share-route-step', String(step));
            if (step === 0) element.setAttribute('data-share-route-start', '');
            else if (step === snapshot.nodeIds.length - 1) element.setAttribute('data-share-route-end', '');
            else element.setAttribute('data-share-route-middle', '');
          });
        });
        edgeMatches.forEach(function (matches, step) {
          matches.forEach(function (element) {
            element.setAttribute('data-share-route-match', '');
            element.setAttribute('data-share-route-step', String(step));
          });
        });

        return clone.hasAttribute('data-share-route') &&
          !clone.hasAttribute('data-animation') &&
          !clone.hasAttribute('data-route-active') &&
          !clone.hasAttribute('data-route-journey') &&
          clone.querySelectorAll('[data-animate], [data-route-match], [data-route-step], [data-route-start], [data-route-end], [data-route-journey-state], [data-route-journey-current], [data-route-journey-overlay]').length === 0 &&
          clone.querySelectorAll('[data-share-route-match]').length ===
            nodeMatches.reduce(function (count, matches) { return count + matches.length; }, 0) +
            edgeMatches.reduce(function (count, matches) { return count + matches.length; }, 0);
      }

      function applyReachSnapshot(clone, snapshot) {
        if (!snapshot || (snapshot.direction !== 'upstream' && snapshot.direction !== 'downstream') ||
            !snapshot.origin || typeof snapshot.origin.id !== 'string' || !snapshot.origin.id ||
            typeof snapshot.origin.label !== 'string' || !snapshot.origin.label.trim() ||
            !Array.isArray(snapshot.nodeIds) || snapshot.nodeIds.length < 2 ||
            !Array.isArray(snapshot.edges) || !snapshot.edges.length ||
            !snapshot.depths || typeof snapshot.depths !== 'object' ||
            !Number.isInteger(snapshot.maxDepth) || snapshot.maxDepth < 1 ||
            snapshot.nodeIds[0] !== snapshot.origin.id) return false;

        clone.removeAttribute('data-animation');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-animate]'), function (element) {
          element.removeAttribute('data-animate');
          element.style.removeProperty('--step');
        });

        var cloneNodes = Array.prototype.slice.call(clone.querySelectorAll('[data-node-id]'));
        var cloneEdges = Array.prototype.slice.call(clone.querySelectorAll('[data-edge-key]'));
        var nodeIds = Object.create(null);
        var edgeKeys = Object.create(null);
        var nodeMatches = [];
        var edgeMatches = [];
        var measuredMaxDepth = 0;

        for (var nodeIndex = 0; nodeIndex < snapshot.nodeIds.length; nodeIndex++) {
          var nodeId = snapshot.nodeIds[nodeIndex];
          var depth = snapshot.depths[nodeId];
          if (typeof nodeId !== 'string' || !nodeId || nodeIds[nodeId] ||
              !Number.isInteger(depth) || depth < 0 || depth > snapshot.maxDepth ||
              (nodeId === snapshot.origin.id ? depth !== 0 : depth < 1)) return false;
          var matchedNodes = cloneNodes.filter(function (candidate) {
            return candidate.getAttribute('data-node-id') === nodeId;
          });
          if (matchedNodes.length !== 1) return false;
          nodeIds[nodeId] = true;
          measuredMaxDepth = Math.max(measuredMaxDepth, depth);
          nodeMatches.push({ elements: matchedNodes, id: nodeId, depth: depth });
        }
        if (measuredMaxDepth !== snapshot.maxDepth) return false;

        for (var edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex++) {
          var edge = snapshot.edges[edgeIndex];
          if (!edge || typeof edge.key !== 'string' || !edge.key || edgeKeys[edge.key] ||
              !nodeIds[edge.from] || !nodeIds[edge.to] ||
              !Number.isInteger(edge.depth) || edge.depth < 1 || edge.depth > snapshot.maxDepth ||
              edge.depth !== Math.max(snapshot.depths[edge.from], snapshot.depths[edge.to])) return false;
          var matchedEdges = cloneEdges.filter(function (candidate) {
            return candidate.getAttribute('data-edge-key') === edge.key;
          });
          var drawableMatches = matchedEdges.filter(hasDrawableGeometry);
          if (!matchedEdges.length || drawableMatches.length !== 1 || !matchedEdges.every(function (candidate) {
            return candidate.getAttribute('data-edge-from') === edge.from &&
              candidate.getAttribute('data-edge-to') === edge.to &&
              (candidate.getAttribute('data-edge-id') || '') === (edge.id || '');
          })) return false;
          edgeKeys[edge.key] = true;
          edgeMatches.push({ elements: matchedEdges, depth: edge.depth });
        }

        clone.setAttribute('data-share-reach', snapshot.direction);
        nodeMatches.forEach(function (match) {
          match.elements.forEach(function (element) {
            element.setAttribute('data-share-reach-match', '');
            element.setAttribute('data-share-reach-depth', String(match.depth));
            if (match.id === snapshot.origin.id) element.setAttribute('data-share-reach-origin', '');
          });
        });
        edgeMatches.forEach(function (match) {
          match.elements.forEach(function (element) {
            element.setAttribute('data-share-reach-match', '');
            element.setAttribute('data-share-reach-depth', String(match.depth));
          });
        });

        return clone.getAttribute('data-share-reach') === snapshot.direction &&
          !clone.hasAttribute('data-animation') &&
          !clone.hasAttribute('data-reach-active') &&
          clone.querySelectorAll('[data-animate], [data-reach-match], [data-reach-origin], [data-reach-depth]').length === 0 &&
          clone.querySelectorAll('[data-share-reach-origin]').length === 1 &&
          clone.querySelectorAll('[data-share-reach-match]').length ===
            nodeMatches.reduce(function (count, match) { return count + match.elements.length; }, 0) +
            edgeMatches.reduce(function (count, match) { return count + match.elements.length; }, 0);
      }

      function serializeSvg(scale, opts) {
        // scale: multiplier (integer unless the figure is oversized) for intrinsic SVG pixel dimensions used by
        // the raster path. Defaults to 1 (natural size) for SVG download.
        scale = scale || 1;
        opts = opts || {};
        var requestedTheme = opts.theme || (opts.autoTheme === true ? 'auto' : null);
        if (requestedTheme && requestedTheme !== 'auto' && requestedTheme !== 'light' && requestedTheme !== 'dark') {
          throw new Error('Unsupported SVG theme: ' + requestedTheme);
        }
        var autoTheme = requestedTheme === 'auto';
        var svg = document.querySelector('.diagram-container svg');
        var clone = svg.cloneNode(true);

        var canonicalStateClean = cleanExportClone(clone);

        var vb = svg.viewBox.baseVal;
        var finiteSvgDimensions = Number.isFinite(vb.x) && Number.isFinite(vb.y) &&
          Number.isFinite(vb.width) && Number.isFinite(vb.height) && vb.width > 0 && vb.height > 0;
        var routeStateClean = opts.routeSnapshot
          ? canonicalStateClean && finiteSvgDimensions && applyRouteSnapshot(clone, opts.routeSnapshot)
          : null;
        var reachStateClean = opts.reachSnapshot
          ? canonicalStateClean && finiteSvgDimensions && !opts.routeSnapshot && applyReachSnapshot(clone, opts.reachSnapshot)
          : null;
        // Scale width/height so the browser rasterizes the vectors at target
        // resolution directly. viewBox stays unchanged so coordinates don't
        // shift. This is the key to sharp rasters — do NOT scale later via
        // canvas upscaling.
        clone.setAttribute('width', vb.width * scale);
        clone.setAttribute('height', vb.height * scale);
        // Keep copied Viewer layout rules from overriding the export's size.
        clone.style.width = vb.width * scale + 'px';
        clone.style.height = vb.height * scale + 'px';
        clone.style.minWidth = '0';
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Only the SVG-relevant rules: semantic classes, markers, and the
        // theme variable blocks. Toolbar/cards/print CSS can never apply
        // inside a standalone SVG and would only bloat the export.
        var hostStyle = (function () {
          var out = [];
          Array.prototype.forEach.call(document.styleSheets, function (sheet) {
            var rules;
            try { rules = sheet.cssRules; } catch (_) { return; } // cross-origin
            if (!rules) return;
            Array.prototype.forEach.call(rules, function (rule) {
              if (rule.type === 7 && /^archify-/.test(rule.name || '')) {
                out.push(rule.cssText);
                return;
              }
              if (rule.type !== 1) return; // plain style rules only
              var sel = rule.selectorText || '';
              if (/(^|,)\s*(svg|:root|\[data-theme|\[data-preset|\.c-|\.t-|\.a-|\.m-)/.test(sel)) {
                out.push(rule.cssText);
              } else if (opts.figure && sel.indexOf('.diagram-container > svg') !== -1) {
                // Figures look like the Viewer canvas: keep its preset/theme paint
                // (quiet grid, lifted nodes) by rescoping matching rules to svg.
                var scoped = sel.split(',').map(function (part) {
                  var at = part.indexOf('.diagram-container > svg');
                  if (at === -1) return null;
                  var prefix = part.slice(0, at).trim();
                  try { if (prefix && !document.documentElement.matches(prefix)) return null; } catch (_) { return null; }
                  return 'svg' + part.slice(at + '.diagram-container > svg'.length);
                }).filter(Boolean);
                if (scoped.length) out.push(scoped.join(', ') + ' { ' + rule.style.cssText + ' }');
              }
            });
          });
          return out.join('\n');
        })();

        // Derive the variable list from the stylesheet so newly added theme
        // variables can never be missed by the export pipeline again
        // (--lane-fill/--lane-stroke once were).
        var varNames = (function () {
          var seen = {};
          var names = [];
          (hostStyle.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) || []).forEach(function (n) {
            if (!seen[n]) { seen[n] = true; names.push(n); }
          });
          return names;
        })();

        // Resolve the full variable set for a given data-theme via an
        // off-DOM probe, independent of what the viewer is currently set to.
        function resolveVars(themeAttr) {
          var probe = document.createElement('div');
          probe.setAttribute('data-theme', themeAttr);
          probe.setAttribute('data-preset', document.documentElement.getAttribute('data-preset') || 'classic');
          probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;';
          document.body.appendChild(probe);
          try {
            var c = getComputedStyle(probe);
            return {
              background: c.getPropertyValue('--bg').trim(),
              vars: varNames.map(function (n) {
                return n + ': ' + c.getPropertyValue(n).trim() + ';';
              }).join(' ')
            };
          } finally {
            document.body.removeChild(probe);
          }
        }

        // Keep the same font bytes, character coverage, and attribution in
        // standalone SVGs and the SVG images used by every raster export.
        var fontCss = document.getElementById('archify-fonts').textContent;

        var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        // Cover the real viewBox: auto-cropped canvases start below y=0, and a
        // 100% rect anchored at the origin left an unpainted band at the bottom.
        bgRect.setAttribute('x', vb.x);
        bgRect.setAttribute('y', vb.y);
        bgRect.setAttribute('width', vb.width);
        bgRect.setAttribute('height', vb.height);

        if (autoTheme) {
          // Dual-theme SVG. Dark is the default (so hosts without
          // prefers-color-scheme still render), light swaps in via media
          // query, and svg[data-theme="..."] still lets downstream
          // consumers force a specific theme.
          var darkTheme = resolveVars('dark');
          var lightTheme = resolveVars('light');

          style.textContent =
            fontCss + "\n" +
            "svg { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace; }\n" +
            hostStyle + "\n" +
            ":root, svg { " + darkTheme.vars + " }\n" +
            "@media (prefers-color-scheme: light) { :root, svg { " + lightTheme.vars + " } }\n" +
            "svg[data-theme=\"light\"] { " + lightTheme.vars + " }\n" +
            "svg[data-theme=\"dark\"] { " + darkTheme.vars + " }\n" +
            "rect.c-bg-rect { fill: var(--bg); }\n";

          // Don't lock the serialized SVG to the viewer's current theme.
          clone.removeAttribute('data-theme');
          // Background follows the CSS variable, not a fixed color, so it
          // swaps with the media query.
          bgRect.setAttribute('class', 'c-bg-rect');
        } else {
          // Raster exports keep the viewer's current theme. Explicit SVG
          // exports instead select their own stable light/dark source.
          var lockedTheme = requestedTheme || document.documentElement.getAttribute('data-theme') || 'dark';
          var resolvedTheme = requestedTheme && resolveVars(lockedTheme);
          var computed = getComputedStyle(document.documentElement);
          var vars = resolvedTheme ? resolvedTheme.vars : varNames.map(function (n) {
            return n + ': ' + computed.getPropertyValue(n).trim() + ';';
          }).join(' ');

          // IMPORTANT: inject the resolved variables AFTER hostStyle,
          // otherwise hostStyle's ":root, [data-theme=\"dark\"] { ... }" rule
          // overrides our chosen theme via later-in-cascade equal-specificity.
          // Keep this order.
          style.textContent =
            fontCss + "\n" +
            "svg { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace; }\n" +
            hostStyle + "\n" +
            ":root, svg { " + vars + " }\n";

          if (requestedTheme) clone.setAttribute('data-theme', lockedTheme);
          bgRect.setAttribute('fill', (resolvedTheme ? resolvedTheme.background : computed.getPropertyValue('--bg').trim()) || '#ffffff');
        }

        if (opts.routeSnapshot) {
          style.textContent += "\nsvg[data-share-route] [data-node-id], svg[data-share-route] [data-edge-from], svg[data-share-route] [data-graph-role=\"automatic-crossover-underlay\"] { opacity: 0.18; }\n" +
            "svg[data-share-route] [data-share-route-match], svg[data-share-route] [data-graph-role=\"automatic-crossover\"]:has(> [data-share-route-match]) > [data-graph-role=\"automatic-crossover-underlay\"] { opacity: 1; }\n" +
            "svg[data-share-route] [data-share-route-start] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 3; stroke-dasharray: 5 3; }\n" +
            "svg[data-share-route] [data-share-route-middle] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 2.2; }\n" +
            "svg[data-share-route] [data-share-route-end] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 3.4; stroke-dasharray: 1 0; }\n";
        }
        if (opts.reachSnapshot) {
          style.textContent += "\nsvg[data-share-reach] [data-node-id], svg[data-share-reach] [data-edge-from], svg[data-share-reach] [data-graph-role=\"automatic-crossover-underlay\"] { opacity: 0.14; }\n" +
            "svg[data-share-reach] [data-share-reach-match], svg[data-share-reach] [data-graph-role=\"automatic-crossover\"]:has(> [data-share-reach-match]) > [data-graph-role=\"automatic-crossover-underlay\"] { opacity: 1; }\n" +
            "svg[data-share-reach] [data-edge-from][data-share-reach-match] { stroke-width: 1.55; }\n" +
            "svg[data-share-reach=\"upstream\"] [data-share-reach-origin] > :is(rect, circle, polygon):not(.c-mask) { stroke: var(--database-stroke); stroke-width: 3.4; stroke-dasharray: 5 3; }\n" +
            "svg[data-share-reach=\"downstream\"] [data-share-reach-origin] > :is(rect, circle, polygon):not(.c-mask) { stroke: var(--backend-stroke); stroke-width: 3.4; stroke-dasharray: 1 0; }\n" +
            "svg[data-preset=\"blueprint\"][data-share-reach] [data-share-reach-origin], svg[data-preset=\"blueprint\"][data-share-reach] [data-edge-from][data-share-reach-match] { filter: none; }\n";
        }

        // Figures draw the diagram on a painted canvas card, like the Viewer.
        if (opts.figure) bgRect.setAttribute('fill', 'none');

        clone.insertBefore(style, clone.firstChild);
        clone.insertBefore(bgRect, style.nextSibling);

        // The XML declaration pins UTF-8: without it, consumers that guess an
        // encoding instead of defaulting to UTF-8 mangle non-ASCII text.
        return {
          svgString: '<?xml version="1.0" encoding="UTF-8"?>\n' +
            new XMLSerializer().serializeToString(clone),
          width: vb.width * scale,
          height: vb.height * scale,
          canonicalStateClean: canonicalStateClean,
          routeStateClean: routeStateClean,
          reachStateClean: reachStateClean
        };
      }

      function download(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }

      // Conservative upper bound on total canvas pixels. Older Safari on iOS
      // silently produces a blank canvas above ~16 Mpx; Chrome / Firefox /
      // desktop Safari are far higher but start failing on memory-constrained
      // devices. We pick the largest integer scale in {4,3,2,1} whose target
      // pixel count fits under this cap; a figure too large even at 1x is
      // downscaled to fit rather than allocating an oversized canvas.
      var MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

      function pickSafeScale(vbW, vbH) {
        for (var s = RASTER_SCALE; s >= 1; s--) {
          if (vbW * s * vbH * s <= MAX_CANVAS_PIXELS) return s;
        }
        return Math.sqrt(MAX_CANVAS_PIXELS / (vbW * vbH)) * 0.999;
      }

      // Raster exports reproduce the Viewer page without its controls: the
      // title row with its accent dot, then the diagram on the same rounded
      // canvas card (fill, hairline, shadow, dot field). CSS pixels.
      var FIGURE_MARGIN = 28;
      var FIGURE_CARD_PADDING = 24;
      var FIGURE_TITLE_SIZE = 24;
      var FIGURE_SUBTITLE_SIZE = 14;

      function figureLayout(vb) {
        var titleNode = document.querySelector('.header h1');
        var subtitleNode = document.querySelector('.header .subtitle');
        var container = document.querySelector('.diagram-container');
        var root = getComputedStyle(document.documentElement);
        var card = container ? getComputedStyle(container) : null;
        var title = titleNode ? titleNode.textContent.trim() : '';
        var subtitle = subtitleNode ? subtitleNode.textContent.trim() : '';
        var header = title ? 32 + (subtitle ? 24 : 0) + 18 : 0;
        var cardWidth = vb.width + FIGURE_CARD_PADDING * 2;
        var cardHeight = vb.height + FIGURE_CARD_PADDING * 2;
        var cardFill = card && card.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(card.backgroundColor)
          ? card.backgroundColor : (root.getPropertyValue('--panel').trim() || 'transparent');
        return {
          title: title,
          subtitle: subtitle,
          family: titleNode ? getComputedStyle(titleNode).fontFamily : 'sans-serif',
          text: root.getPropertyValue('--text').trim() || '#111827',
          muted: root.getPropertyValue('--text-muted').trim() || '#64748b',
          accent: root.getPropertyValue('--frontend-stroke').trim() || '#0891b2',
          bg: root.getPropertyValue('--bg').trim() || currentBg(),
          cardFill: cardFill,
          cardBorder: root.getPropertyValue('--panel-border').trim() || 'transparent',
          dot: card && /radial-gradient/.test(card.backgroundImage) ? (root.getPropertyValue('--canvas-dot').trim() || '') : '',
          light: (document.documentElement.getAttribute('data-theme') || 'dark') === 'light',
          header: header,
          cardWidth: cardWidth,
          cardHeight: cardHeight,
          width: cardWidth + FIGURE_MARGIN * 2,
          height: cardHeight + FIGURE_MARGIN * 2 + header
        };
      }

      function paintFigure(ctx, layout) {
        var m = FIGURE_MARGIN;
        ctx.fillStyle = layout.bg;
        ctx.fillRect(0, 0, layout.width, layout.height);
        if (layout.title) {
          var titleMid = m + 16;
          ctx.fillStyle = layout.accent;
          ctx.globalAlpha = 0.16;
          ctx.beginPath(); ctx.arc(m + 5, titleMid, 9, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(m + 5, titleMid, 5, 0, Math.PI * 2); ctx.fill();
          ctx.textBaseline = 'middle';
          ctx.fillStyle = layout.text;
          ctx.fillText(fitCanvasText(ctx, layout.title, layout.width - m * 2 - 22, FIGURE_TITLE_SIZE, 14, '650', layout.family), m + 22, titleMid + 1);
          if (layout.subtitle) {
            ctx.fillStyle = layout.muted;
            ctx.fillText(fitCanvasText(ctx, layout.subtitle, layout.width - m * 2, FIGURE_SUBTITLE_SIZE, 11, '400', layout.family), m, titleMid + 30);
          }
          ctx.textBaseline = 'alphabetic';
        }
        var x = m, y = m + layout.header, w = layout.cardWidth, h = layout.cardHeight, r = 16;
        function cardPath() {
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
          else ctx.rect(x, y, w, h);
        }
        ctx.save();
        if (layout.light) {
          ctx.shadowColor = 'rgba(15, 23, 42, 0.08)';
          ctx.shadowBlur = 28;
          ctx.shadowOffsetY = 10;
        }
        cardPath();
        ctx.fillStyle = layout.bg;
        ctx.fill();
        ctx.restore();
        cardPath();
        ctx.fillStyle = layout.cardFill;
        ctx.fill();
        if (layout.dot) {
          ctx.save();
          cardPath();
          ctx.clip();
          ctx.fillStyle = layout.dot;
          for (var dy = y + 1; dy < y + h; dy += 20) {
            for (var dx = x + 1; dx < x + w; dx += 20) {
              ctx.beginPath(); ctx.arc(dx, dy, 1, 0, Math.PI * 2); ctx.fill();
            }
          }
          ctx.restore();
        }
        cardPath();
        ctx.strokeStyle = layout.cardBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        return { x: x + FIGURE_CARD_PADDING, y: y + FIGURE_CARD_PADDING };
      }

      function rasterize(format) {
        // Serialize at a safe scale (RASTER_SCALE=4 by default, reduced if the
        // resulting canvas would exceed MAX_CANVAS_PIXELS). The SVG itself is
        // rasterized at target resolution natively; drawImage draws at natural
        // size — no upsampling blur.
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var layout = figureLayout(vb);
        var scale = pickSafeScale(layout.width, layout.height);
        var data = serializeSvg(scale, { figure: true });
        var svgBlob = new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' });
        var svgUrl = URL.createObjectURL(svgBlob);

        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = Math.round(layout.width * scale);
              canvas.height = Math.round(layout.height * scale);
              var ctx = canvas2dOrThrow(canvas, format);
              // Paint in CSS pixels; the SVG image is already rendered at scale,
              // so drawing it at CSS size under this transform stays 1:1.
              ctx.setTransform(scale, 0, 0, scale, 0, 0);
              var origin = paintFigure(ctx, layout);
              ctx.drawImage(img, origin.x, origin.y, vb.width, vb.height);
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              URL.revokeObjectURL(svgUrl);
              var mime = format === 'jpeg' ? 'image/jpeg' :
                         format === 'webp' ? 'image/webp' : 'image/png';
              var quality = format === 'png' ? undefined : 0.95;
              canvas.toBlob(function (blob) {
                if (!blob) reject(exportError('viewer.export.error.toBlobNull', { label: format }));
                else resolve(blob);
              }, mime, quality);
            } catch (error) {
              URL.revokeObjectURL(svgUrl);
              reject(error);
            }
          };
          img.onerror = function (e) {
            URL.revokeObjectURL(svgUrl);
            reject(e);
          };
          img.src = svgUrl;
        });
      }

      function fitCanvasText(ctx, text, maxWidth, startSize, minSize, weight, fontFamily) {
        var value = String(text || '').trim();
        var size = startSize;
        var family = fontFamily || "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        while (size > minSize) {
          ctx.font = (weight || '600') + ' ' + size + 'px ' + family;
          if (ctx.measureText(value).width <= maxWidth) return value;
          size -= 1;
        }
        ctx.font = (weight || '600') + ' ' + minSize + 'px ' + family;
        if (ctx.measureText(value).width <= maxWidth) return value;
        var suffix = '\u2026';
        while (value.length > 1 && ctx.measureText(value + suffix).width > maxWidth) {
          value = value.slice(0, -1);
        }
        return value + suffix;
      }

      function canvas2dOrThrow(canvas, label) {
        if (!canvas || typeof canvas.getContext !== 'function') {
          throw exportError('viewer.export.error.canvasUnavailable', { label: label });
        }
        var ctx = canvas.getContext('2d');
        if (!ctx) throw exportError('viewer.export.error.contextUnavailable', { label: label });
        if (typeof canvas.toBlob !== 'function') throw exportError('viewer.export.error.toBlobUnavailable', { label: label });
        return ctx;
      }

      function renderShareCard(options) {
        var routeSnapshot = options.routeSnapshot || null;
        var reachSnapshot = options.reachSnapshot || null;
        if (routeSnapshot && reachSnapshot) return Promise.reject(exportError('viewer.export.error.variantsCombined'));
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var sourceScale = Math.min(2, pickSafeScale(vb.width, vb.height));
        var data = serializeSvg(sourceScale, { routeSnapshot: routeSnapshot, reachSnapshot: reachSnapshot, figure: true });
        if (!data.canonicalStateClean) return Promise.reject(exportError('viewer.export.error.viewerState'));
        if (routeSnapshot && !data.routeStateClean) return Promise.reject(exportError('viewer.export.error.routeState'));
        if (reachSnapshot && !data.reachStateClean) return Promise.reject(exportError('viewer.export.error.reachState'));
        var svgBlob = new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' });
        var svgUrl = URL.createObjectURL(svgBlob);

        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = SHARE_CARD_WIDTH;
              canvas.height = SHARE_CARD_HEIGHT;
              var ctx = canvas2dOrThrow(canvas, viewerText('viewer.export.shareCard'));
              var computed = getComputedStyle(document.documentElement);
              var bg = computed.getPropertyValue('--bg').trim() || currentBg();
              var text = computed.getPropertyValue('--text').trim() || '#ffffff';
              var muted = computed.getPropertyValue('--text-muted').trim() || '#94a3b8';
              var border = computed.getPropertyValue('--panel-border').trim() || '#334155';
              var accentProperty = reachSnapshot
                ? (reachSnapshot.direction === 'upstream' ? '--database-stroke' : '--backend-stroke')
                : '--frontend-stroke';
              var accent = computed.getPropertyValue(accentProperty).trim() || '#22d3ee';
              var titleNode = document.querySelector('.header h1');
              var title = titleNode ? titleNode.textContent : document.title;
              var directionLabel = reachSnapshot
                ? viewerText('viewer.export.direction.' + reachSnapshot.direction)
                : '';
              var subtitle = routeSnapshot
                ? viewerCount('viewer.export.card.routeSummary', routeSnapshot.hops, {
                    source: routeSnapshot.source.label,
                    target: routeSnapshot.target.label
                  })
                : viewerText('viewer.export.card.reachSummary', {
                    direction: directionLabel,
                    origin: reachSnapshot.origin.label,
                    nodes: viewerCount('viewer.export.card.node', reachSnapshot.nodeIds.length - 1),
                    links: viewerCount('viewer.export.card.link', reachSnapshot.edges.length),
                    hops: viewerCount('viewer.export.card.hop', reachSnapshot.maxDepth)
                  });
              var cardLabel = routeSnapshot
                ? viewerText('viewer.export.card.routeBadge', {
                    hops: viewerCount('viewer.export.card.hop', routeSnapshot.hops).toUpperCase()
                  })
                : viewerText('viewer.export.card.reachBadge', { direction: directionLabel.toUpperCase() });

              var family = titleNode ? getComputedStyle(titleNode).fontFamily : 'sans-serif';
              var panelFill = bg;

              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

              // Header: a short accent rule and badge over the title and summary.
              ctx.fillStyle = accent;
              ctx.fillRect(SHARE_CARD_PADDING, 34, 28, 3);
              ctx.textBaseline = 'alphabetic';
              ctx.font = '600 12px ' + family;
              ctx.textAlign = 'right';
              ctx.fillStyle = muted;
              ctx.fillText(cardLabel, SHARE_CARD_WIDTH - SHARE_CARD_PADDING, 40);
              ctx.textAlign = 'left';

              ctx.fillStyle = text;
              var fittedTitle = fitCanvasText(ctx, title, SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2 - 260, 30, 18, '650', family);
              ctx.fillText(fittedTitle, SHARE_CARD_PADDING, 74);

              ctx.fillStyle = muted;
              var fittedSubtitle = fitCanvasText(ctx, subtitle, SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2, 15, 12, '400', family);
              ctx.fillText(fittedSubtitle, SHARE_CARD_PADDING, 99);

              // The diagram sits on one soft rounded panel with an even inset.
              var panelX = SHARE_CARD_PADDING;
              var panelY = SHARE_CARD_HEADER;
              var panelWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;
              var panelHeight = SHARE_CARD_HEIGHT - SHARE_CARD_HEADER - SHARE_CARD_PADDING;
              var inset = 18;
              ctx.beginPath();
              if (typeof ctx.roundRect === 'function') ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 14);
              else ctx.rect(panelX, panelY, panelWidth, panelHeight);
              ctx.fillStyle = panelFill;
              ctx.fill();
              ctx.strokeStyle = border;
              ctx.lineWidth = 1;
              ctx.stroke();

              var availableWidth = panelWidth - inset * 2;
              var availableHeight = panelHeight - inset * 2;
              var fit = Math.min(availableWidth / data.width, availableHeight / data.height);
              var drawWidth = data.width * fit;
              var drawHeight = data.height * fit;
              var drawX = panelX + inset + (availableWidth - drawWidth) / 2;
              var drawY = panelY + inset + (availableHeight - drawHeight) / 2;
              ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
              URL.revokeObjectURL(svgUrl);

              canvas.toBlob(function (blob) {
                if (!blob) reject(exportError('viewer.export.error.toBlobNull', { label: viewerText('viewer.export.shareCard') }));
                else resolve(blob);
              }, 'image/png');
            } catch (error) {
              URL.revokeObjectURL(svgUrl);
              reject(error);
            }
          };
          img.onerror = function (e) {
            URL.revokeObjectURL(svgUrl);
            reject(e);
          };
          img.src = svgUrl;
        });
      }

      function rasterizeShareCard(options) {
        options = options || {};
        if (options.variant !== 'route' && options.variant !== 'reach') {
          return Promise.reject(exportError('viewer.export.unknownVariant', { variant: options.variant }));
        }
        if (options.variant === 'route') {
          var routeSnapshot = Archify.routeProbe && Archify.routeProbe.exportSnapshot();
          if (!routeSnapshot) return Promise.reject(exportError('viewer.export.routeRequired'));
          return renderShareCard({ routeSnapshot: routeSnapshot });
        }
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        if (!snapshot) return Promise.reject(exportError('viewer.export.reachRequired'));
        return renderShareCard({ reachSnapshot: snapshot });
      }

      function motionMimeType() {
        if (typeof MediaRecorder === 'undefined') return '';
        var candidates = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
        ];
        for (var i = 0; i < candidates.length; i++) {
          if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
      }

      function canRecordMotion() {
        var svg = document.querySelector('.diagram-container svg');
        return !!(svg && svg.getAttribute('data-animation') === 'trace' &&
          typeof MediaRecorder !== 'undefined' && motionMimeType() &&
          typeof HTMLCanvasElement !== 'undefined' &&
          typeof HTMLCanvasElement.prototype.captureStream === 'function');
      }

      // Record the live CSS animation without Puppeteer, ffmpeg, or a network
      // dependency. SVG files loaded through Image are commonly rasterized as
      // one cached bitmap, so repeatedly drawing that Image does not reliably
      // advance its CSS animation. Keep one crisp static SVG background, then
      // render an explicit time-varying signal scene over the real authored
      // relationship geometry on every captured canvas frame.
      function recordWebm(options) {
        options = options || {};
        if (!canRecordMotion()) {
          return Promise.reject(exportError('viewer.export.error.webmRequirements'));
        }
        var duration = Math.max(250, Number(options.duration) || MOTION_DURATION);
        var fps = Math.max(1, Number(options.fps) || MOTION_FPS);
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var scale = Math.min(1, 1280 / vb.width);
        var data = serializeSvg(scale);
        var sourceUrl = URL.createObjectURL(new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' }));

        function createMotionScene(root) {
          var rootMatrix = root.getCTM ? root.getCTM() : null;

          function pointInRoot(element, point) {
            if (!rootMatrix || !element.getCTM || !point.matrixTransform) return { x: point.x, y: point.y };
            try {
              var elementMatrix = element.getCTM();
              if (!elementMatrix) return { x: point.x, y: point.y };
              var mapped = point.matrixTransform(rootMatrix.inverse().multiply(elementMatrix));
              return { x: mapped.x, y: mapped.y };
            } catch (_) {
              return { x: point.x, y: point.y };
            }
          }

          function samplesFor(element) {
            if (typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') return [];
            var length;
            try { length = element.getTotalLength(); } catch (_) { return []; }
            if (!Number.isFinite(length) || length <= 0) return [];
            var count = Math.max(12, Math.min(72, Math.ceil(length / 12)));
            var points = [];
            for (var i = 0; i <= count; i++) {
              points.push(pointInRoot(element, element.getPointAtLength(length * i / count)));
            }
            return points;
          }

          function authoredStep(element, fallback) {
            var raw = element.style.getPropertyValue('--step') || getComputedStyle(element).getPropertyValue('--step');
            var value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
          }

          var edges = Array.prototype.slice.call(root.querySelectorAll('[data-animate="edge"]')).map(function (element, index) {
            var computed = getComputedStyle(element);
            return {
              points: samplesFor(element),
              color: computed.stroke && computed.stroke !== 'none' ? computed.stroke : '#22d3ee',
              width: Math.max(1.5, parseFloat(computed.strokeWidth) || 1.5),
              delay: Math.min(12, authoredStep(element, index)) * 0.16
            };
          }).filter(function (edge) { return edge.points.length > 1; });

          var nodes = Array.prototype.slice.call(root.querySelectorAll('[data-node-id][data-animate="node"]')).map(function (element, index) {
            var box;
            try { box = element.getBBox(); } catch (_) { return null; }
            var painted = element.querySelector('[class*="c-"]') || element;
            var computed = getComputedStyle(painted);
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              color: computed.stroke && computed.stroke !== 'none' ? computed.stroke : '#22d3ee',
              delay: Math.min(12, authoredStep(element, index)) * 0.16
            };
          }).filter(Boolean);

          return { edges: edges, nodes: nodes, x: vb.x, y: vb.y, width: vb.width, height: vb.height };
        }

        function pointAlong(points, progress) {
          var scaled = Math.max(0, Math.min(1, progress)) * (points.length - 1);
          var index = Math.min(points.length - 2, Math.floor(scaled));
          var mix = scaled - index;
          return {
            x: points[index].x + (points[index + 1].x - points[index].x) * mix,
            y: points[index].y + (points[index + 1].y - points[index].y) * mix
          };
        }

        function roundedRectPath(ctx, x, y, width, height, radius) {
          var r = Math.max(0, Math.min(radius, width / 2, height / 2));
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + width - r, y);
          ctx.quadraticCurveTo(x + width, y, x + width, y + r);
          ctx.lineTo(x + width, y + height - r);
          ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
          ctx.lineTo(x + r, y + height);
          ctx.quadraticCurveTo(x, y + height, x, y + height - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }

        function drawMotionFrame(ctx, backgroundImage, motionScene, elapsed) {
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.drawImage(backgroundImage, 0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.save();
          ctx.scale(ctx.canvas.width / motionScene.width, ctx.canvas.height / motionScene.height);
          ctx.translate(-motionScene.x, -motionScene.y);

          motionScene.edges.forEach(function (edge) {
            var duration = 1.75;
            var progress = (elapsed - edge.delay) / duration;
            if (progress < 0 || progress > 1) return;
            var head = Math.max(0, Math.min(1, progress));
            var tail = Math.max(0, head - 0.24);
            var opacity = Math.sin(Math.PI * Math.min(1, progress));

            ctx.save();
            ctx.strokeStyle = edge.color;
            ctx.fillStyle = edge.color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(3.2, edge.width * 2.2);
            ctx.globalAlpha = 0.42 + opacity * 0.5;
            ctx.shadowColor = edge.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            for (var i = 0; i <= 14; i++) {
              var trailPoint = pointAlong(edge.points, tail + (head - tail) * i / 14);
              if (i === 0) ctx.moveTo(trailPoint.x, trailPoint.y);
              else ctx.lineTo(trailPoint.x, trailPoint.y);
            }
            ctx.stroke();

            var point = pointAlong(edge.points, head);
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });

          motionScene.nodes.forEach(function (node) {
            var progress = (elapsed - node.delay) / 2.6;
            if (progress < 0 || progress > 1) return;
            var pulse = Math.sin(Math.PI * progress);
            if (pulse <= 0.02) return;
            ctx.save();
            ctx.strokeStyle = node.color;
            ctx.lineWidth = 1.4 + pulse * 1.8;
            ctx.globalAlpha = pulse * 0.5;
            ctx.shadowColor = node.color;
            ctx.shadowBlur = 12 * pulse;
            var inset = 2 + pulse * 3;
            roundedRectPath(ctx, node.x - inset, node.y - inset, node.width + inset * 2, node.height + inset * 2, 8);
            ctx.stroke();
            ctx.restore();
          });

          ctx.restore();
        }

        var motionScene = createMotionScene(svg);

        return new Promise(function (resolve, reject) {
          var backgroundImage = new Image();
          backgroundImage.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(2, Math.round(data.width / 2) * 2);
            canvas.height = Math.max(2, Math.round(data.height / 2) * 2);
            var ctx = canvas.getContext('2d');
            var stream = canvas.captureStream(fps);
            var mime = motionMimeType();
            var recorder;
            try {
              recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
            } catch (err) {
              URL.revokeObjectURL(sourceUrl);
              stream.getTracks().forEach(function (track) { track.stop(); });
              reject(err);
              return;
            }
            var chunks = [];
            var raf = 0;
            var stopped = false;
            var startedAt = performance.now();
            function cleanup() {
              if (stopped) return;
              stopped = true;
              cancelAnimationFrame(raf);
              URL.revokeObjectURL(sourceUrl);
              stream.getTracks().forEach(function (track) { track.stop(); });
            }
            function draw(now) {
              var elapsed = Math.max(0, ((Number(now) || performance.now()) - startedAt) / 1000);
              drawMotionFrame(ctx, backgroundImage, motionScene, elapsed);
              raf = requestAnimationFrame(draw);
            }
            recorder.ondataavailable = function (event) {
              if (event.data && event.data.size) chunks.push(event.data);
            };
            recorder.onerror = function (event) {
              cleanup();
              reject(event.error || exportError('viewer.export.error.mediaRecorder'));
            };
            recorder.onstop = function () {
              cleanup();
              var blob = new Blob(chunks, { type: recorder.mimeType || mime });
              if (!blob.size) reject(exportError('viewer.export.error.emptyWebm'));
              else resolve(blob);
            };
            drawMotionFrame(ctx, backgroundImage, motionScene, 0);
            recorder.start(250);
            startedAt = performance.now();
            raf = requestAnimationFrame(draw);
            setTimeout(function () {
              if (recorder.state === 'inactive') return;
              // Chromium normally emits the final chunk during stop(), but
              // some embedded browser shells need an explicit encoder flush
              // first. Keep the short grace window bounded and harmless for
              // browsers that already delivered timeslice chunks.
              try { recorder.requestData(); } catch (_) {}
              setTimeout(function () {
                if (recorder.state !== 'inactive') recorder.stop();
              }, 120);
            }, duration);
          };
          backgroundImage.onerror = function () {
            URL.revokeObjectURL(sourceUrl);
            reject(exportError('viewer.export.error.webmBackground'));
          };
          backgroundImage.src = sourceUrl;
        });
      }

      var menu = document.getElementById('export-menu');
      var btn = document.getElementById('btn-export');
      var routeShareItem = menu.querySelector('button[data-action="route-share-card"]');
      var reachShareItem = menu.querySelector('button[data-action="reach-share-card"]');
      var items = function () {
        return Array.prototype.slice.call(menu.querySelectorAll('button[role="menuitem"]'));
      };

      function syncRouteShareItem() {
        var snapshot = Archify.routeProbe && typeof Archify.routeProbe.exportSnapshot === 'function'
          ? Archify.routeProbe.exportSnapshot()
          : null;
        routeShareItem.hidden = !snapshot;
        routeShareItem.disabled = !snapshot;
        return snapshot;
      }

      function syncReachShareItem() {
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        reachShareItem.hidden = !snapshot;
        reachShareItem.disabled = !snapshot;
        return snapshot;
      }

      // ---- Clipboard support ----------------------------------------------
      function canCopyImage() {
        return typeof ClipboardItem !== 'undefined' &&
               navigator.clipboard &&
               typeof navigator.clipboard.write === 'function';
      }

      // ---- Raster format detection ----------------------------------------
      // canvas.toBlob('image/webp') silently returns a PNG on browsers without
      // WebP encoding (older Safari), so detect explicitly.
      function supports(format) {
        if (format === 'svg' || format === 'svg-light' || format === 'svg-dark' || format === 'png') return true;
        if (format === 'webm') return canRecordMotion();
        var mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        try {
          var c = document.createElement('canvas');
          c.width = c.height = 2;
          return c.toDataURL(mime).indexOf('data:' + mime) === 0;
        } catch (_) { return false; }
      }

      // Gray out unsupported items.
      items().forEach(function (it) {
        if (it.dataset.format && !supports(it.dataset.format)) {
          it.disabled = true;
          it.title = viewerText('viewer.export.unsupported');
        }
        if (it.dataset.action === 'copy' && !canCopyImage()) {
          it.disabled = true;
          it.title = viewerText('viewer.export.clipboardUnsupported');
        }
      });

      // ---- Toast ----------------------------------------------------------
      // A live region only announces CHANGES to an existing node, so the toast
      // element is created once up front and updated in place.
      var toastEl = document.createElement('div');
      toastEl.className = 'archify-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
      var toastTimer = null;

      function toast(msg) {
        toastEl.textContent = '';
        requestAnimationFrame(function () {
          toastEl.textContent = msg;
          toastEl.classList.add('show');
        });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1500);
      }

      function open(focusLast) {
        if (Archify.preset && Archify.preset.isOpen()) Archify.preset.close(false);
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.isOpen()) Archify.semanticLens.close({ restoreFocus: false });
        syncRouteShareItem();
        syncReachShareItem();
        menu.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        var available = items().filter(function (i) { return !i.hidden && !i.disabled; });
        var target = focusLast ? available[available.length - 1] : available[0];
        if (target) target.focus();
      }
      function close(focusTrigger) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        if (focusTrigger) btn.focus();
      }
      function isOpen() { return menu.classList.contains('open'); }

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(false);
        else open();
      });
      // APG menu-button pattern: ArrowDown/ArrowUp on the trigger opens the menu.
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen()) open(e.key === 'ArrowUp');
        }
      });
      document.addEventListener('click', function (e) {
        if (!menu.contains(e.target) && e.target !== btn) close(false);
      });

      // Keyboard navigation inside the menu.
      //   Menu items: Up/Down, Home/End.
      //   Esc closes + returns focus to trigger; Tab closes.
      menu.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        if (e.key === 'Tab')    { close(false); return; }

        var available = items().filter(function (i) { return !i.hidden && !i.disabled; });
        var current = available.indexOf(document.activeElement);
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (available.length) available[(current + 1 + available.length) % available.length].focus();
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (available.length) available[(current - 1 + available.length) % available.length].focus();
            break;
          case 'Home':
            e.preventDefault();
            if (available[0]) available[0].focus();
            break;
          case 'End':
            e.preventDefault();
            if (available.length) available[available.length - 1].focus();
            break;
        }
      });

      function runExport(format) {
        if (['svg', 'svg-light', 'svg-dark', 'png', 'jpeg', 'webp', 'webm'].indexOf(format) === -1) {
          return Promise.reject(exportError('viewer.export.unsupported'));
        }
        var base = diagramFilename();
        var svgTheme = format === 'svg' ? 'auto' :
          format === 'svg-light' ? 'light' :
          format === 'svg-dark' ? 'dark' : null;
        close(true);
        clearExportReceipt();
        if (format === 'webm') toast(viewerText('viewer.export.recording'));
        return (svgTheme
          ? Promise.resolve(serializeSvg(1, { theme: svgTheme })).then(function (d) {
              var blob = new Blob([d.svgString], { type: 'image/svg+xml;charset=utf-8' });
              recordExportReceipt('svg', blob, d.canonicalStateClean);
              download(blob, base + (svgTheme === 'auto' ? '' : '-' + svgTheme) + '.svg');
            })
          : format === 'webm'
            ? recordWebm().then(function (blob) {
                document.documentElement.setAttribute('data-last-motion-bytes', String(blob.size));
                recordExportReceipt('webm', blob, true);
                download(blob, base + '.webm');
                toast(viewerText('viewer.export.downloadedWebm'));
              })
          : rasterize(format).then(function (blob) {
              recordExportReceipt(format, blob, true);
              download(blob, base + '.' + format);
            })
        ).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : format;
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', format);
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          if (format === 'webm') {
            var motionItem = menu.querySelector('button[data-format="webm"]');
            if (motionItem) {
              motionItem.disabled = true;
              motionItem.title = viewerText('viewer.export.motionUnavailable');
              motionItem.style.opacity = '0.5';
            }
            toast(viewerText('viewer.export.webmUnavailable'));
            return;
          }
          alert(viewerText('viewer.export.failed', { message: message }));
        });
      }

      function runRouteShareCard() {
        close(false);
        clearExportReceipt();
        var snapshot = Archify.routeProbe && Archify.routeProbe.exportSnapshot();
        var blobPromise = snapshot
          ? renderShareCard({ routeSnapshot: snapshot })
          : Promise.reject(exportError('viewer.export.routeRequired'));
        return blobPromise.then(function (blob) {
          recordExportReceipt('share-card', blob, false, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }, 'route', true);
          download(blob, diagramFilename() + '-route-share-card.png');
          toast(viewerText('viewer.export.downloadedRoute'));
          return blob;
        }).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : 'share-card';
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', 'share-card');
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          alert(viewerText('viewer.export.routeFailed', { message: message }));
        });
      }

      function runReachShareCard() {
        close(false);
        clearExportReceipt();
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        var blobPromise = snapshot
          ? renderShareCard({ reachSnapshot: snapshot })
          : Promise.reject(exportError('viewer.export.reachRequired'));
        return blobPromise.then(function (blob) {
          recordExportReceipt('share-card', blob, false, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }, 'reach', false, true);
          download(blob, diagramFilename() + '-' + snapshot.direction + '-reach-share-card.png');
          toast(viewerText('viewer.export.downloadedReach'));
          return blob;
        }).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : 'share-card';
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', 'share-card');
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          alert(viewerText('viewer.export.reachFailed', { message: message }));
        });
      }

      // A compact, machine-readable receipt for local QA and generated proof
      // galleries. It exposes no diagram contents, only the completed format,
      // byte count, and whether temporary viewer state was excluded.
      function recordExportReceipt(format, blob, canonical, dimensions, variant, routeStateClean, reachStateClean) {
        document.documentElement.setAttribute('data-last-export-format', format);
        document.documentElement.setAttribute('data-last-export-bytes', String(blob.size));
        document.documentElement.setAttribute('data-last-export-canonical', canonical ? 'true' : 'false');
        if (variant) {
          document.documentElement.setAttribute('data-last-export-variant', variant);
        } else {
          document.documentElement.removeAttribute('data-last-export-variant');
        }
        if (routeStateClean === true) {
          document.documentElement.setAttribute('data-last-export-route-state-clean', 'true');
        } else {
          document.documentElement.removeAttribute('data-last-export-route-state-clean');
        }
        if (reachStateClean === true) {
          document.documentElement.setAttribute('data-last-export-reach-state-clean', 'true');
        } else {
          document.documentElement.removeAttribute('data-last-export-reach-state-clean');
        }
        if (dimensions) {
          document.documentElement.setAttribute('data-last-export-width', String(dimensions.width));
          document.documentElement.setAttribute('data-last-export-height', String(dimensions.height));
        } else {
          document.documentElement.removeAttribute('data-last-export-width');
          document.documentElement.removeAttribute('data-last-export-height');
        }
      }

      function clearExportReceipt() {
        document.documentElement.removeAttribute('data-last-export-format');
        document.documentElement.removeAttribute('data-last-export-bytes');
        document.documentElement.removeAttribute('data-last-export-canonical');
        document.documentElement.removeAttribute('data-last-export-width');
        document.documentElement.removeAttribute('data-last-export-height');
        document.documentElement.removeAttribute('data-last-export-variant');
        document.documentElement.removeAttribute('data-last-export-route-state-clean');
        document.documentElement.removeAttribute('data-last-export-reach-state-clean');
        document.documentElement.removeAttribute('data-last-export-error-format');
        document.documentElement.removeAttribute('data-last-export-error');
      }

      function writePngToClipboard(blobPromise) {
        // WebKit requires ClipboardItem to be constructed synchronously inside
        // the user gesture. Chromium accepts the same pending Promise<Blob>;
        // engines that reject promise values fall back to an awaited Blob.
        try {
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        } catch (_) {
          return blobPromise.then(function (blob) {
            return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          });
        }
      }

      function runCopy() {
        close(true);
        clearExportReceipt();
        if (!canCopyImage()) {
          alert(viewerText('viewer.export.clipboardUnsupported.short'));
          return;
        }
        var blobPromise = rasterize('png');
        return writePngToClipboard(blobPromise).then(function () {
          toast(viewerText('viewer.export.copiedPng'));
        }).catch(function (err) {
          console.error(err);
          alert(viewerText('viewer.export.copyFailed', {
            message: exportMessage(err)
          }));
        });
      }

      menu.addEventListener('click', function (e) {
        var routeShareCardBtn = e.target.closest('button[data-action="route-share-card"]');
        if (routeShareCardBtn && !routeShareCardBtn.disabled && !routeShareCardBtn.hidden) { runRouteShareCard(); return; }

        var reachShareCardBtn = e.target.closest('button[data-action="reach-share-card"]');
        if (reachShareCardBtn && !reachShareCardBtn.disabled && !reachShareCardBtn.hidden) { runReachShareCard(); return; }

        var copyBtn = e.target.closest('button[data-action="copy"]');
        if (copyBtn && !copyBtn.disabled) { runCopy(); return; }

        var formatBtn = e.target.closest('button[data-format]');
        if (formatBtn && !formatBtn.disabled) { runExport(formatBtn.dataset.format); }
      });

      Archify.motion = { canRecord: canRecordMotion, recordWebm: recordWebm };
      Archify.exportMenu = {
        open: open,
        close: close,
        isOpen: isOpen,
        run: runExport,
        shareCard: rasterizeShareCard,
        downloadRouteShareCard: runRouteShareCard,
        downloadReachShareCard: runReachShareCard,
        syncRouteShare: syncRouteShareItem,
        syncReachShare: syncReachShareItem
      };

      // Auto-open on page load for demo/screenshot purposes: ?openExport=1
      // Wait for fonts (so the menu doesn't flash before typography lands)
      // and paint before opening. Fallback timeout for browsers without the
      // Font Loading API.
      try {
        if (new URLSearchParams(window.location.search).get('openExport') === '1') {
          var openWhenReady = function () {
            requestAnimationFrame(function () { requestAnimationFrame(open); });
          };
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(openWhenReady);
          } else {
            setTimeout(openWhenReady, 200);
          }
        }
      } catch (_) {}
    })();


    /* ============================================================
       Motion Governor — one reader switch and one motion budget. Ambient
       trace yields to the strongest semantic owner; Still also parks bounded
       viewer signals without discarding their static meaning.
       ============================================================ */
    Archify.motionGovernor = (function () {
      var STORAGE_KEY = 'archify-motion';
      var html = document.documentElement;
      var svg = document.querySelector('.diagram-container svg');
      var btn = document.getElementById('btn-motion');
      var label = document.getElementById('motion-label');
      var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var capable = !!(svg && svg.getAttribute('data-animation') === 'trace');
      var readerPaused = false;
      var suspensions = Object.create(null);
      var explicitOwner = '';
      var owner = '';
      var ownerToken = 0;
      var ownerCleanup = null;
      var lastEffectivePaused = null;
      var ambientStarted = false;
      var ambientPending = new Set();

      function detachAmbientBoundary() {
        if (!svg) return;
        svg.removeEventListener('animationend', onAmbientBoundary, true);
        svg.removeEventListener('animationcancel', onAmbientBoundary, true);
      }
      function settleAmbient(reason) {
        if (!capable) return false;
        ambientStarted = true;
        ambientPending.clear();
        detachAmbientBoundary();
        html.setAttribute('data-ambient-motion', 'settled');
        html.setAttribute('data-ambient-settle-reason', reason || 'complete');
        return true;
      }
      function onAmbientBoundary(event) {
        if (!ambientPending.has(event.target)) return;
        ambientPending.delete(event.target);
        if (!ambientPending.size) settleAmbient('complete');
      }
      function startAmbient() {
        if (ambientStarted || !capable) return false;
        ambientStarted = true;
        ambientPending = new Set(Array.prototype.slice.call(svg.querySelectorAll('[data-animate="edge"], [data-animate="node"]')));
        if (!ambientPending.size) return settleAmbient('empty');
        svg.addEventListener('animationend', onAmbientBoundary, true);
        svg.addEventListener('animationcancel', onAmbientBoundary, true);
        html.setAttribute('data-ambient-motion', 'running');
        html.removeAttribute('data-ambient-settle-reason');
        return true;
      }

      function readStored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
      }
      function writeStored() {
        try {
          if (readerPaused) localStorage.setItem(STORAGE_KEY, 'still');
          else localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
      }
      function reducedMotion() {
        return !!(motionQuery && motionQuery.matches);
      }
      function hasSuspension() {
        return Object.keys(suspensions).length > 0;
      }
      function effectivePaused() {
        return readerPaused || reducedMotion() || hasSuspension();
      }
      function ownerLabel(value) {
        if (value === 'route') return viewerText('viewer.owner.route');
        if (value === 'lens') return viewerText('viewer.owner.lens');
        if (value === 'relationship') return viewerText('viewer.owner.relationship');
        if (value === 'intent') return viewerText('viewer.owner.intent');
        if (value === 'focus') return viewerText('viewer.owner.focus');
        if (value === 'legend') return viewerText('viewer.owner.legend');
        return viewerText('viewer.owner.reader');
      }
      function render() {
        if (!capable) return;
        var systemPaused = reducedMotion();
        var paused = effectivePaused();
        html.setAttribute('data-motion', paused ? 'still' : 'live');
        if (paused || owner || html.hasAttribute('data-embed') || html.hasAttribute('data-share-playback') || html.hasAttribute('data-document-hidden')) {
          settleAmbient('suppressed');
        } else if (!ambientStarted) {
          startAmbient();
        }
        btn.setAttribute('aria-pressed', paused ? 'false' : 'true');
        btn.disabled = systemPaused;
        label.textContent = viewerText(paused ? 'viewer.motion.still' : 'viewer.motion.live');
        if (paused && lastEffectivePaused !== true && Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: systemPaused ? 'reduced-motion' : (hasSuspension() ? 'hidden' : 'still') });
        }
        lastEffectivePaused = paused;
        if (Archify.routeProbe && typeof Archify.routeProbe.syncMotion === 'function') Archify.routeProbe.syncMotion();
        if (systemPaused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.reduced'));
          btn.title = viewerText('viewer.motion.reduced');
        } else if (hasSuspension()) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.hidden'));
          btn.title = viewerText('viewer.motion.hidden');
        } else if (paused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.resume'));
          btn.title = viewerText('viewer.motion.resume');
        } else if (owner) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.yielding', { owner: ownerLabel(owner) }));
          btn.title = viewerText('viewer.motion.yielding.title', { owner: ownerLabel(owner) });
        } else {
          btn.setAttribute('aria-label', viewerText('viewer.motion.pause'));
          btn.title = viewerText('viewer.motion.pause');
        }
      }
      function setPaused(next, options) {
        options = options || {};
        readerPaused = !!next;
        if (options.persist !== false) writeStored();
        render();
        return readerPaused;
      }
      function publishOwner() {
        owner = explicitOwner || deriveOwner();
        if (owner) html.setAttribute('data-motion-owner', owner);
        else html.removeAttribute('data-motion-owner');
        render();
        return owner;
      }
      function deriveOwner() {
        if (!svg) return '';
        if (svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active')) return 'route';
        if (svg.hasAttribute('data-lens-active')) return 'lens';
        if (svg.hasAttribute('data-relationship-preview-active')) return 'relationship';
        if (svg.hasAttribute('data-intent-trace-active')) return 'intent';
        if (svg.hasAttribute('data-focus-active')) return 'focus';
        if (svg.hasAttribute('data-legend-preview-active')) return 'legend';
        return '';
      }
      function clearClaim(preempted) {
        var cleanup = ownerCleanup;
        ownerCleanup = null;
        explicitOwner = '';
        if (preempted && cleanup) {
          try { cleanup(); } catch (_) {}
        }
      }
      function claim(next, cleanup) {
        if (!capable || !next) return 0;
        clearClaim(true);
        ownerToken += 1;
        explicitOwner = next;
        ownerCleanup = typeof cleanup === 'function' ? cleanup : null;
        publishOwner();
        return ownerToken;
      }
      function release(token) {
        if (!capable || token !== ownerToken || !explicitOwner) return false;
        clearClaim(false);
        ownerToken += 1;
        publishOwner();
        return true;
      }
      function suspend(reason) {
        var key = String(reason || 'runtime');
        var active = true;
        suspensions[key] = (suspensions[key] || 0) + 1;
        render();
        return function () {
          if (!active) return false;
          active = false;
          if (suspensions[key] > 1) suspensions[key] -= 1;
          else delete suspensions[key];
          render();
          return true;
        };
      }
      function syncVisibility() {
        if (document.hidden) {
          suspensions.visibility = true;
          html.setAttribute('data-document-hidden', 'true');
        } else {
          delete suspensions.visibility;
          html.removeAttribute('data-document-hidden');
        }
        render();
      }

      if (!capable) {
        btn.hidden = true;
        html.removeAttribute('data-motion-capable');
        html.removeAttribute('data-motion');
        html.removeAttribute('data-motion-owner');
        html.removeAttribute('data-ambient-motion');
        html.removeAttribute('data-ambient-settle-reason');
        return {
          capable: false,
          pause: function () { return false; },
          resume: function () { return false; },
          toggle: function () { return false; },
          setMode: function () { return 'still'; },
          mode: function () { return 'still'; },
          claim: function () { return 0; },
          release: function () { return false; },
          suspend: function () { return function () { return false; }; },
          isPaused: function () { return true; },
          owner: function () { return ''; }
        };
      }

      html.setAttribute('data-motion-capable', 'true');
      btn.hidden = false;
      readerPaused = readStored() === 'still';
      btn.addEventListener('click', function () { setPaused(!readerPaused); });
      if (motionQuery) {
        if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', render);
        else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(render);
      }
      document.addEventListener('visibilitychange', syncVisibility);
      if (document.documentElement.getAttribute('data-embed') !== 'true' && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && svg instanceof Node) {
        var ownerObserver = new MutationObserver(function () { publishOwner(); });
        ownerObserver.observe(svg, {
          attributes: true,
          attributeFilter: [
            'data-route-picking', 'data-route-active',
            'data-lens-active', 'data-relationship-preview-active', 'data-intent-trace-active',
            'data-focus-active', 'data-legend-preview-active'
          ]
        });
      }
      syncVisibility();
      publishOwner();
      render();

      return {
        capable: true,
        pause: function () { return setPaused(true); },
        resume: function () { return setPaused(false); },
        toggle: function () { return setPaused(!readerPaused); },
        setMode: function (next, options) {
          setPaused(next === 'still', options);
          return effectivePaused() ? 'still' : 'live';
        },
        mode: function () { return effectivePaused() ? 'still' : 'live'; },
        claim: claim,
        release: release,
        suspend: suspend,
        isPaused: effectivePaused,
        owner: function () { return owner; }
      };
    })();

    /* Verified repository evidence is emitted only after the renderer checks
       the authored GitHub revision, source blobs, and optional line ranges
       against the explicit --repo-root. It remains outside the SVG so every
       canonical visual export stays free of repository paths. */
    Archify.sourceEvidence = (function () {
      var element = document.getElementById('archify-source-evidence-data');
      var payload = null;
      var svgNamespace = 'http://www.w3.org/2000/svg';
      if (element) {
        try {
          var parsed = JSON.parse(element.textContent || 'null');
          if (parsed && parsed.verified === true && parsed.repository && parsed.nodes) payload = parsed;
        } catch (_) {}
      }
      function installBeacons() {
        if (!payload) return 0;
        var svg = document.querySelector('.diagram-container svg');
        if (!svg) return 0;
        var installed = 0;
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
          var id = node.getAttribute('data-node-id');
          var sources = payload.nodes[id];
          if (!Array.isArray(sources) || !sources.length || node.querySelector('[data-source-evidence-beacon]')) return;
          var shape = node.querySelector('[data-animate="node"]') || node.querySelector('[class*="c-"]');
          var box;
          try { box = (shape || node).getBBox(); } catch (_) { return; }
          if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || box.width < 36) return;

          var count = sources.length;
          var label = viewerCount('viewer.passport.beacon', count);
          var beacon = document.createElementNS(svgNamespace, 'g');
          beacon.classList.add('source-evidence-beacon');
          beacon.setAttribute('data-source-evidence-beacon', '');
          beacon.setAttribute('aria-hidden', 'true');
          var brandOffset = node.hasAttribute('data-node-brand') ? 22 : 0;
          var title = document.createElementNS(svgNamespace, 'title');
          title.textContent = label;
          var plate = document.createElementNS(svgNamespace, 'rect');
          plate.setAttribute('height', '13');
          plate.setAttribute('rx', '6.5');
          var text = document.createElementNS(svgNamespace, 'text');
          text.setAttribute('y', '9.4');
          text.textContent = viewerText('viewer.passport.sourceMarker') + ' ' + count;
          beacon.appendChild(title);
          beacon.appendChild(plate);
          beacon.appendChild(text);
          node.appendChild(beacon);

          // Measure the real glyph advance, then clamp the plate between 24
          // and 36px; a still-wider label is squeezed with textLength so the
          // badge never overlaps the neighbouring brand mark or sigil.
          var textWidth = 16;
          try {
            var measured = text.getComputedTextLength();
            if (Number.isFinite(measured) && measured > 0) textWidth = measured;
          } catch (_) {}
          var plateWidth = Math.min(36, Math.max(24, textWidth + 8));
          if (textWidth > plateWidth - 8) {
            text.setAttribute('textLength', String(plateWidth - 8));
            text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
          }
          plate.setAttribute('width', String(plateWidth));
          text.setAttribute('x', String(plateWidth / 2));
          beacon.setAttribute('transform', 'translate(' + (box.x + box.width - 6 - brandOffset - plateWidth) + ' ' + (box.y + 4.5) + ')');

          var originalLabel = node.getAttribute('aria-label') || '';
          node.setAttribute('data-source-evidence-count', String(count));
          node.setAttribute('data-source-evidence-original-label', originalLabel);
          node.setAttribute('aria-label', (originalLabel ? originalLabel + ', ' : '') + viewerCount('viewer.passport.sourceCount', count));
          installed += 1;
        });
        return installed;
      }
      return {
        available: function () { return Boolean(payload); },
        repository: function () { return payload ? payload.repository : null; },
        node: function (id) {
          var sources = payload && payload.nodes ? payload.nodes[id] : null;
          return Array.isArray(sources) ? sources.slice() : [];
        },
        installBeacons: installBeacons
      };
    })();
    Archify.sourceEvidence.installBeacons();

    /* ============================================================
       Explore — stable-ID neighborhood focus + dependency-free pan/zoom.
       Renderer IDs become deep-linkable semantic hooks without turning the
       standalone artifact into a canvas editor.
       ============================================================ */
    Archify.focus = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var chip = document.getElementById('focus-chip');
      var label = document.getElementById('focus-label');
      var detail = document.getElementById('focus-detail');
      var kind = document.getElementById('focus-kind');
      var context = document.getElementById('focus-context');
      var tag = document.getElementById('focus-tag');
      var semanticId = document.getElementById('focus-id');
      var evidence = document.getElementById('focus-evidence');
      var repositoryLink = document.getElementById('focus-repository');
      var evidenceLinks = document.getElementById('focus-evidence-links');
      var summary = document.getElementById('focus-summary');
      var reachSection = document.getElementById('focus-reach');
      var reachStatus = document.getElementById('focus-reach-status');
      var upstreamBtn = document.getElementById('btn-reach-upstream');
      var downstreamBtn = document.getElementById('btn-reach-downstream');
      var upstreamCount = document.getElementById('focus-reach-upstream-count');
      var downstreamCount = document.getElementById('focus-reach-downstream-count');
      var relationshipList = document.getElementById('relationship-lens-list');
      var copyBtn = document.getElementById('btn-focus-copy');
      var relationsBtn = document.getElementById('btn-focus-relations');
      var clearBtn = document.getElementById('btn-focus-clear');
      var moveBtn = document.getElementById('btn-focus-move');
      var activeIds = [];
      var hoveredRelationship = null;
      var focusedRelationship = null;
      var pinnedRelationship = null;
      var pinnedRelationshipKey = null;
      var activeRelationshipPreview = null;
      var relationshipHitOverlay = null;
      var relationshipHitTargets = [];
      var directPreviewTimer = null;
      var lensDrag = null;
      var lensDragClickPointer = null;
      var manualLensPosition = null;
      var reachabilityMode = null;
      var activeReachability = null;
      var svgNamespace = 'http://www.w3.org/2000/svg';
      var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '');
      }
      function reachabilityRelationships() {
        var seen = Object.create(null);
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!from || !to || seen[key]) return;
          seen[key] = true;
          relationships.push({ key: key, from: from, to: to });
        });
        return relationships;
      }
      function computeReachability(originId, direction, relationships) {
        if (typeof originId !== 'string' || !originId ||
            (direction !== 'upstream' && direction !== 'downstream') ||
            !Array.isArray(relationships)) return null;
        var records = [];
        var seenKeys = Object.create(null);
        relationships.forEach(function (relationship, index) {
          if (!relationship || typeof relationship.from !== 'string' || !relationship.from ||
              typeof relationship.to !== 'string' || !relationship.to) return;
          var key = typeof relationship.key === 'string' && relationship.key
            ? relationship.key : String(index);
          if (seenKeys[key]) return;
          seenKeys[key] = true;
          records.push({ key: key, from: relationship.from, to: relationship.to });
        });

        var depths = Object.create(null);
        var order = [];
        var queue = [originId];
        depths[originId] = 0;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var current = queue[cursor];
          records.forEach(function (relationship) {
            var next = null;
            if (direction === 'downstream' && relationship.from === current) next = relationship.to;
            else if (direction === 'upstream' && relationship.to === current) next = relationship.from;
            if (next == null || Object.prototype.hasOwnProperty.call(depths, next)) return;
            depths[next] = depths[current] + 1;
            queue.push(next);
          });
        }
        queue.forEach(function (id) { order.push(id); });

        var edgeKeys = [];
        records.forEach(function (relationship) {
          if (Object.prototype.hasOwnProperty.call(depths, relationship.from) &&
              Object.prototype.hasOwnProperty.call(depths, relationship.to)) edgeKeys.push(relationship.key);
        });
        var maxDepth = order.reduce(function (maximum, id) {
          return Math.max(maximum, depths[id]);
        }, 0);
        return {
          direction: direction,
          originId: originId,
          nodeIds: order,
          edgeKeys: edgeKeys,
          depths: depths,
          maxDepth: maxDepth
        };
      }
      function reachabilityFor(id, direction) {
        return computeReachability(id, direction, reachabilityRelationships());
      }
      function resetReachabilityButtons() {
        upstreamBtn.setAttribute('aria-pressed', 'false');
        downstreamBtn.setAttribute('aria-pressed', 'false');
      }
      function clearReachability(options) {
        options = options || {};
        reachabilityMode = null;
        activeReachability = null;
        svg.removeAttribute('data-reach-active');
        chip.removeAttribute('data-reach-mode');
        nodes().forEach(function (node) {
          node.removeAttribute('data-reach-match');
          node.removeAttribute('data-reach-origin');
          node.removeAttribute('data-reach-depth');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-reach-match');
          edge.removeAttribute('data-reach-depth');
        });
        resetReachabilityButtons();
        reachStatus.textContent = '';
        reachStatus.hidden = true;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl === true && activeIds.length === 1) {
          try {
            history.replaceState(null, '', location.pathname + location.search + '#focus=' + encodeURIComponent(activeIds[0]));
          } catch (_) {}
        }
      }
      function renderReachabilityControls(id) {
        var upstream = reachabilityFor(id, 'upstream');
        var downstream = reachabilityFor(id, 'downstream');
        var upstreamReach = upstream ? Math.max(0, upstream.nodeIds.length - 1) : 0;
        var downstreamReach = downstream ? Math.max(0, downstream.nodeIds.length - 1) : 0;
        upstreamCount.textContent = String(upstreamReach);
        downstreamCount.textContent = String(downstreamReach);
        upstreamBtn.disabled = upstreamReach === 0;
        downstreamBtn.disabled = downstreamReach === 0;
        upstreamBtn.setAttribute('aria-label', upstreamReach
          ? viewerCount('viewer.passport.reach.upstream', upstreamReach)
          : viewerText('viewer.passport.reach.noUpstream'));
        downstreamBtn.setAttribute('aria-label', downstreamReach
          ? viewerCount('viewer.passport.reach.downstream', downstreamReach)
          : viewerText('viewer.passport.reach.noDownstream'));
        reachSection.hidden = false;
      }
      function applyReachability(direction, options) {
        options = options || {};
        if (activeIds.length !== 1 || (direction !== 'upstream' && direction !== 'downstream')) return false;
        if (reachabilityMode === direction && options.toggle !== false) {
          clearReachability({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var result = reachabilityFor(activeIds[0], direction);
        if (!result || result.nodeIds.length <= 1) return false;
        clearRelationshipPreview({ clearPin: true });
        clearReachability({ updateUrl: false });
        reachabilityMode = direction;
        activeReachability = result;
        var edgeKeySet = Object.create(null);
        result.edgeKeys.forEach(function (key) { edgeKeySet[key] = true; });
        svg.setAttribute('data-reach-active', direction);
        chip.setAttribute('data-reach-mode', direction);
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (!Object.prototype.hasOwnProperty.call(result.depths, id)) return;
          node.setAttribute('data-reach-match', '');
          node.setAttribute('data-reach-depth', String(result.depths[id]));
          if (id === result.originId) node.setAttribute('data-reach-origin', '');
        });
        edges().forEach(function (edge) {
          var key = edge.getAttribute('data-edge-key') || (
            edge.getAttribute('data-edge-from') + '\u0000' +
            edge.getAttribute('data-edge-to') + '\u0000' +
            (edge.getAttribute('data-edge-label') || '')
          );
          if (!edgeKeySet[key]) return;
          edge.setAttribute('data-reach-match', '');
          var fromDepth = result.depths[edge.getAttribute('data-edge-from')];
          var toDepth = result.depths[edge.getAttribute('data-edge-to')];
          edge.setAttribute('data-reach-depth', String(Math.max(fromDepth || 0, toDepth || 0)));
        });
        resetReachabilityButtons();
        var activeButton = direction === 'upstream' ? upstreamBtn : downstreamBtn;
        activeButton.setAttribute('aria-pressed', 'true');
        var reachableCount = result.nodeIds.length - 1;
        var directionLabel = viewerText(direction === 'upstream'
          ? 'viewer.passport.upstream'
          : 'viewer.passport.downstream');
        reachStatus.textContent = viewerText('viewer.passport.reach.status', {
          direction: directionLabel,
          nodes: reachableCount,
          links: result.edgeKeys.length,
          hops: result.maxDepth
        });
        reachStatus.hidden = false;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl !== false) {
          try {
            history.replaceState(null, '', location.pathname + location.search + '#focus=' +
              encodeURIComponent(activeIds[0]) + '&reach=' + direction);
          } catch (_) {}
        }
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodeIds, { includeNeighbors: false, reason: 'reachability' });
        }
        placeRelationshipLens();
        return true;
      }
      function reachabilitySnapshot() {
        if (!activeReachability || activeIds.length !== 1 ||
            (reachabilityMode !== 'upstream' && reachabilityMode !== 'downstream') ||
            activeReachability.direction !== reachabilityMode ||
            activeReachability.originId !== activeIds[0] ||
            svg.getAttribute('data-reach-active') !== reachabilityMode) return null;

        var originId = activeReachability.originId;
        var nodeIds = activeReachability.nodeIds.slice();
        var edgeKeys = activeReachability.edgeKeys.slice();
        if (nodeIds.length < 2 || nodeIds[0] !== originId || !edgeKeys.length ||
            !activeReachability.depths || !Number.isInteger(activeReachability.maxDepth) ||
            activeReachability.maxDepth < 1) return null;

        var allNodes = nodes();
        var allEdges = edges();
        var seenNodeIds = Object.create(null);
        var seenEdgeKeys = Object.create(null);
        var nodeIdSet = Object.create(null);
        var depths = Object.create(null);
        var originNode = null;
        var measuredMaxDepth = 0;

        if (nodeIds.some(function (id) {
          var depth = activeReachability.depths[id];
          var matches = allNodes.filter(function (node) {
            return node.getAttribute('data-node-id') === id;
          });
          if (typeof id !== 'string' || !id || seenNodeIds[id] || matches.length !== 1 ||
              !matches[0].hasAttribute('data-reach-match') ||
              !Number.isInteger(depth) || depth < 0 || depth > activeReachability.maxDepth ||
              (id === originId
                ? (!matches[0].hasAttribute('data-reach-origin') || depth !== 0)
                : depth < 1)) return true;
          seenNodeIds[id] = true;
          nodeIdSet[id] = true;
          depths[id] = depth;
          measuredMaxDepth = Math.max(measuredMaxDepth, depth);
          if (id === originId) originNode = matches[0];
          return false;
        }) || !originNode || measuredMaxDepth !== activeReachability.maxDepth ||
            allNodes.filter(function (node) { return node.hasAttribute('data-reach-match'); }).length !== nodeIds.length) return null;

        var edgeRecords = [];
        if (edgeKeys.some(function (key) {
          if (typeof key !== 'string' || !key || seenEdgeKeys[key]) return true;
          var fragments = allEdges.filter(function (edge) {
            return edge.getAttribute('data-edge-key') === key;
          });
          var drawableFragments = fragments.filter(hasDrawableGeometry);
          if (!fragments.length || drawableFragments.length !== 1 ||
              !fragments.every(function (fragment) { return fragment.hasAttribute('data-reach-match'); })) return true;
          var first = fragments[0];
          var from = first.getAttribute('data-edge-from');
          var to = first.getAttribute('data-edge-to');
          var id = first.getAttribute('data-edge-id') || '';
          var labelValue = first.getAttribute('data-edge-label') || '';
          if (!nodeIdSet[from] || !nodeIdSet[to] || !fragments.every(function (fragment) {
            return fragment.getAttribute('data-edge-from') === from &&
              fragment.getAttribute('data-edge-to') === to &&
              (fragment.getAttribute('data-edge-id') || '') === id;
          })) return true;
          seenEdgeKeys[key] = true;
          edgeRecords.push({
            key: key,
            id: id,
            from: from,
            to: to,
            label: labelValue,
            depth: Math.max(depths[from], depths[to])
          });
          return false;
        })) return null;

        var liveEdgeKeys = Object.create(null);
        if (allEdges.some(function (edge) {
          if (!edge.hasAttribute('data-reach-match')) return false;
          var key = edge.getAttribute('data-edge-key');
          if (!key || !seenEdgeKeys[key]) return true;
          liveEdgeKeys[key] = true;
          return false;
        }) || Object.keys(liveEdgeKeys).length !== edgeKeys.length) return null;

        return {
          direction: reachabilityMode,
          origin: { id: originId, label: nodeLabel(originNode, originId) },
          nodeIds: nodeIds,
          depths: depths,
          maxDepth: activeReachability.maxDepth,
          edges: edgeRecords
        };
      }
      function setPassportValue(element, value) {
        var normalized = value == null ? '' : String(value).trim();
        element.textContent = normalized;
        element.hidden = !normalized;
      }
      function renderSourceEvidence(id) {
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.removeAttribute('aria-label');
        repositoryLink.textContent = '';
        var sources = Archify.sourceEvidence.node(id);
        var repository = Archify.sourceEvidence.repository();
        if (!repository || !sources.length) {
          evidence.hidden = true;
          return;
        }
        repositoryLink.textContent = repository.label + ' @ ' + repository.shortRevision;
        if (repository.href) {
          repositoryLink.href = repository.href;
          repositoryLink.setAttribute('aria-label', viewerText('viewer.passport.repository.open', { revision: repository.revision }));
        }
        evidence.title = viewerText('viewer.passport.verificationScope');
        sources.forEach(function (source) {
          var link = document.createElement(source.href ? 'a' : 'div');
          link.className = 'semantic-passport-source';
          if (source.href) {
            link.href = source.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer';
            link.setAttribute('aria-label', viewerText('viewer.passport.source.open', { path: source.path, revision: repository.shortRevision }));
          }
          var name = document.createElement('strong');
          name.textContent = source.label || source.path.split('/').pop() || source.path;
          var location = document.createElement('code');
          location.textContent = source.line
            ? 'L' + source.line + (source.endLine && source.endLine !== source.line ? '–' + source.endLine : '') + (source.href ? ' ↗' : '')
            : source.href ? viewerText('viewer.passport.source.openLink') : '';
          var sourcePath = document.createElement('small');
          sourcePath.textContent = source.path;
          link.appendChild(name);
          link.appendChild(location);
          link.appendChild(sourcePath);
          evidenceLinks.appendChild(link);
        });
        evidence.hidden = false;
      }
      function renderPassport(id, node) {
        setPassportValue(detail, node.getAttribute('data-node-sublabel'));
        setPassportValue(kind, viewerKindLabel(node.getAttribute('data-node-kind') || 'node'));
        setPassportValue(context, node.getAttribute('data-node-context'));
        setPassportValue(tag, node.getAttribute('data-node-tag'));
        setPassportValue(document.getElementById('focus-brand'), node.getAttribute('data-node-brand'));
        semanticId.textContent = id;
        semanticId.hidden = false;
        renderSourceEvidence(id);
      }
      function relationshipsFor(id, byId) {
        var seen = {};
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var edgeLabel = edge.getAttribute('data-edge-label') || '';
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + edgeLabel);
          var edgeId = edge.getAttribute('data-edge-id') || '';
          if (seen[edgeKey]) return;
          seen[edgeKey] = true;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var neighborId = direction === 'in' ? from : to;
          var neighbor = byId[neighborId];
          relationships.push({
            key: edgeKey,
            id: edgeId,
            from: from,
            to: to,
            direction: direction,
            neighborId: neighborId,
            neighborLabel: neighbor ? nodeLabel(neighbor, neighborId) : neighborId,
            label: edgeLabel || viewerText(direction === 'loop'
              ? 'viewer.passport.relationship.loopsBack'
              : direction === 'out'
                ? 'viewer.passport.relationship.connectsTo'
                : 'viewer.passport.relationship.connectsFrom')
          });
        });
        return relationships;
      }
      function relationshipEdgeShapes(edge) {
        if (!edge) return [];
        if (/^(path|line|polyline)$/i.test(edge.tagName || '')) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function relationshipHitRecords() {
        var recordsByKey = {};
        var recordsById = Object.create(null);
        var byId = Object.create(null);
        nodes().forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var records = [];
        edges().forEach(function (edge) {
          var shapes = relationshipEdgeShapes(edge);
          if (!shapes.length) return;
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var labelValue = edge.getAttribute('data-edge-label') || '';
          var edgeId = edge.getAttribute('data-edge-id') || '';
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + labelValue);
          var existing = recordsByKey[key];
          if (existing) {
            if (existing.from !== from || existing.to !== to || existing.labelValue !== labelValue || existing.id !== edgeId) {
              existing.invalid = true;
              return;
            }
            shapes.forEach(function (shape) {
              if (existing.shapes.indexOf(shape) === -1) existing.shapes.push(shape);
            });
            return;
          }
          var record = {
            key: key,
            id: edgeId,
            from: from,
            to: to,
            fromLabel: byId[from] ? nodeLabel(byId[from], from) : from,
            toLabel: byId[to] ? nodeLabel(byId[to], to) : to,
            labelValue: labelValue,
            label: labelValue || viewerText(from === to
              ? 'viewer.passport.relationship.loopsBack'
              : 'viewer.passport.relationship.connectsTo'),
            edge: edge,
            shapes: shapes,
            invalid: false
          };
          recordsByKey[key] = record;
          if (edgeId) {
            if (recordsById[edgeId]) {
              recordsById[edgeId].invalid = true;
              record.invalid = true;
            } else {
              recordsById[edgeId] = record;
            }
          }
          records.push(record);
        });
        return records.filter(function (record) { return !record.invalid && record.from && record.to; });
      }
      function relationshipRecordForKey(key) {
        return relationshipHitRecords().find(function (record) { return record.key === key; }) || null;
      }
      function pinnedRelationshipRecord() {
        return pinnedRelationshipKey ? relationshipRecordForKey(pinnedRelationshipKey) : null;
      }
      function renderRelationshipCopyAction() {
        var record = pinnedRelationshipRecord();
        if (record && record.id) {
          copyBtn.textContent = viewerText('viewer.passport.copyRelation');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copyPinned'));
        } else if (pinnedRelationshipKey) {
          copyBtn.textContent = viewerText('viewer.passport.copyNode');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copySource'));
        } else {
          copyBtn.textContent = viewerText('viewer.passport.copy');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        }
      }
      function relationshipHitGeometry(shape, className) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.setAttribute('class', className || 'relationship-hit-rail');
        return clone;
      }
      function removeRelationshipPulse() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-relationship-pulse-overlay]'), function (element) {
          element.remove();
        });
      }
      function relationshipPulseGeometry(shape) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('transform');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-focus-match');
        clone.removeAttribute('data-relationship-preview');
        clone.setAttribute('class', 'relationship-flow-pulse');
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function relationshipTokenKind(edge) {
        var shapes = relationshipEdgeShapes(edge);
        var classEvidence = [edge.getAttribute('class') || ''].concat(shapes.map(function (shape) {
          return shape.getAttribute('class') || '';
        })).join(' ');
        var from = edge.getAttribute('data-edge-from') || '';
        var to = edge.getAttribute('data-edge-to') || '';
        var source = nodes().find(function (node) { return node.getAttribute('data-node-id') === from; });
        var target = nodes().find(function (node) { return node.getAttribute('data-node-id') === to; });
        var sourceKind = source ? source.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        var targetKind = target ? target.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        if (/\ba-security\b/.test(classEvidence) || sourceKind === 'security' || targetKind === 'security' || targetKind === 'failure') return 'security';
        if (/\ba-dashed\b/.test(classEvidence) || sourceKind === 'messagebus' || targetKind === 'messagebus') return 'event';
        if (sourceKind === 'database' || targetKind === 'database') return 'data';
        if (targetKind === 'waiting' || targetKind === 'success') return 'state';
        return 'call';
      }
      function relationshipTokenPath(shape) {
        if (!shape) return '';
        var tagName = String(shape.tagName || '').toLowerCase();
        if (tagName === 'path') return shape.getAttribute('d') || '';
        if (tagName === 'line') {
          return 'M ' + shape.getAttribute('x1') + ' ' + shape.getAttribute('y1') +
            ' L ' + shape.getAttribute('x2') + ' ' + shape.getAttribute('y2');
        }
        if (tagName === 'polyline' && shape.points && shape.points.numberOfItems > 1) {
          var commands = [];
          for (var i = 0; i < shape.points.numberOfItems; i += 1) {
            var point = shape.points.getItem(i);
            commands.push((i === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y);
          }
          return commands.join(' ');
        }
        return '';
      }
      function relationshipTokenPart(tagName, className, attrs) {
        var part = document.createElementNS(svgNamespace, tagName);
        part.setAttribute('class', className);
        Object.keys(attrs || {}).forEach(function (name) { part.setAttribute(name, attrs[name]); });
        return part;
      }
      function relationshipTokenGeometry(shape, kind, key, options) {
        options = options || {};
        var pathData = relationshipTokenPath(shape);
        if (!pathData) return null;
        var token = document.createElementNS(svgNamespace, 'g');
        token.setAttribute('class', 'semantic-flow-token ' + (options.className || 'relationship-flow-token'));
        token.setAttribute('data-token-kind', kind);
        token.setAttribute('data-token-edge-key', key);
        token.setAttribute('aria-hidden', 'true');
        token.appendChild(relationshipTokenPart('circle', 'semantic-flow-token-halo', { cx: '0', cy: '0', r: '7' }));
        if (kind === 'data') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-5', y: '-4', width: '10', height: '8', rx: '2' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -2.8 -1.2 h 5.6 M -2.8 1.4 h 3.8' }));
        } else if (kind === 'event') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-7', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-2', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '3', y: '-3', width: '4', height: '6', rx: '1' }));
        } else if (kind === 'security') {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-shape', { d: 'M 0 -5 L 4 -3.4 V 0 c 0 3 -1.6 4.5 -4 5.5 C -2.4 4.5 -4 3 -4 0 v -3.4 Z' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'm -2 .2 1.4 1.4 L 2 -1.4' }));
        } else if (kind === 'state') {
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-shape', { cx: '0', cy: '0', r: '5' }));
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-dot', { cx: '0', cy: '0', r: '1.35' }));
        } else {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -5 -3 L -1 0 L -5 3 M 0 -3 L 4 0 L 0 3' }));
        }
        var motion = document.createElementNS(svgNamespace, 'animateMotion');
        motion.setAttribute('path', pathData);
        motion.setAttribute('dur', options.duration || '1.2s');
        motion.setAttribute('begin', '0s');
        motion.setAttribute('fill', 'freeze');
        motion.setAttribute('rotate', 'auto');
        motion.setAttribute('calcMode', 'spline');
        motion.setAttribute('keyTimes', '0;1');
        motion.setAttribute('keySplines', '.2 0 .2 1');
        token.appendChild(motion);
        return token;
      }
      function createSemanticFlowToken(edge, shape, options) {
        if (!edge || !shape) return null;
        var key = edge.getAttribute('data-edge-key') || (
          edge.getAttribute('data-edge-from') + '\u0000' +
          edge.getAttribute('data-edge-to') + '\u0000' +
          (edge.getAttribute('data-edge-label') || '')
        );
        return relationshipTokenGeometry(shape, relationshipTokenKind(edge), key, options);
      }
      Archify.flowTokens = {
        create: createSemanticFlowToken,
        kind: function (edge) { return relationshipTokenKind(edge); },
        path: relationshipTokenPath
      };
      function renderRelationshipPulse(key) {
        removeRelationshipPulse();
        if (!key || document.documentElement.getAttribute('data-embed') === 'true') return false;
        if (document.hidden || (Archify.motionGovernor && Archify.motionGovernor.isPaused())) return false;
        if (reducedMotionQuery && reducedMotionQuery.matches) return false;
        var matchingEdges = edges().filter(function (edge) {
          return edge.getAttribute('data-edge-key') === key;
        });
        if (!matchingEdges.length) return false;
        var overlay = document.createElementNS(svgNamespace, 'g');
        overlay.setAttribute('class', 'relationship-pulse-overlay');
        overlay.setAttribute('data-relationship-pulse-overlay', '');
        overlay.setAttribute('data-relationship-pulse-key', key);
        overlay.setAttribute('aria-hidden', 'true');
        var tokenAdded = false;
        matchingEdges.forEach(function (edge) {
          var wrapper = document.createElementNS(svgNamespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          var shapes = relationshipEdgeShapes(edge);
          shapes.forEach(function (shape) {
            wrapper.appendChild(relationshipPulseGeometry(shape));
          });
          if (!tokenAdded && shapes.length) {
            var tokenKind = relationshipTokenKind(edge);
            var token = relationshipTokenGeometry(shapes[0], tokenKind, key);
            if (token) {
              wrapper.appendChild(token);
              overlay.setAttribute('data-relationship-token-kind', tokenKind);
              tokenAdded = true;
            }
          }
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        if (!overlay.childNodes.length) return false;
        var finishPulse = function () {
          if (overlay.parentNode) overlay.remove();
        };
        overlay.addEventListener('animationend', finishPulse, { once: true });
        overlay.addEventListener('animationcancel', finishPulse, { once: true });
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        return true;
      }
      function clearRelationshipPreview(options) {
        options = options || {};
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        removeRelationshipPulse();
        activeRelationshipPreview = null;
        svg.removeAttribute('data-relationship-preview-active');
        svg.removeAttribute('data-relationship-direct-active');
        if (options.clearPin === true) {
          pinnedRelationship = null;
          pinnedRelationshipKey = null;
          svg.removeAttribute('data-relationship-pin-active');
        }
        chip.removeAttribute('data-relationship-previewing');
        edges().forEach(function (edge) { edge.removeAttribute('data-relationship-preview'); });
        nodes().forEach(function (node) {
          node.removeAttribute('data-relationship-preview-node');
          node.removeAttribute('data-relationship-preview-source');
          node.removeAttribute('data-relationship-preview-target');
        });
        Array.prototype.forEach.call(relationshipList.querySelectorAll('[data-preview-active]'), function (button) {
          button.removeAttribute('data-preview-active');
        });
        relationshipHitTargets.forEach(function (target) {
          target.setAttribute('aria-pressed', pinnedRelationshipKey && target.getAttribute('data-relationship-key') === pinnedRelationshipKey ? 'true' : 'false');
          target.removeAttribute('data-preview-active');
        });
        renderRelationshipCopyAction();
        placeRelationshipLens();
      }
      function previewRelationship(button, options) {
        options = options || {};
        if (pinnedRelationshipKey && pinnedRelationship && button !== pinnedRelationship) return;
        clearRelationshipPreview();
        if (!button) return;
        var key = button.getAttribute('data-relationship-key');
        var from = button.getAttribute('data-relationship-from');
        var to = button.getAttribute('data-relationship-to');
        if (!key || !from || !to) return;
        svg.setAttribute('data-relationship-preview-active', key);
        if (options.direct === true) svg.setAttribute('data-relationship-direct-active', key);
        edges().forEach(function (edge) {
          if (edge.getAttribute('data-edge-key') === key) edge.setAttribute('data-relationship-preview', '');
        });
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (id !== from && id !== to) return;
          node.setAttribute('data-relationship-preview-node', '');
          if (id === from) node.setAttribute('data-relationship-preview-source', '');
          if (id === to) node.setAttribute('data-relationship-preview-target', '');
        });
        button.setAttribute('data-preview-active', 'true');
        if (!chip.hidden && options.direct !== true) chip.setAttribute('data-relationship-previewing', 'true');
        activeRelationshipPreview = button;
        renderRelationshipPulse(key);
        placeRelationshipLens();
      }
      function syncRelationshipPreview() {
        var next = pinnedRelationship || focusedRelationship || hoveredRelationship;
        if (next === activeRelationshipPreview) return;
        previewRelationship(next, { direct: !!(next && next.hasAttribute('data-relationship-hit-key')) });
      }
      function directRelationshipBlocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
          container.classList.contains('is-panning') ||
          (activeIds.length > 0 && !pinnedRelationshipKey) ||
          svg.hasAttribute('data-route-picking') ||
          svg.hasAttribute('data-route-active') ||
          svg.hasAttribute('data-lens-active');
      }
      function scheduleDirectRelationshipPreview(target) {
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        if (pinnedRelationshipKey) return;
        directPreviewTimer = window.setTimeout(function () {
          directPreviewTimer = null;
          if (pinnedRelationshipKey || hoveredRelationship !== target || directRelationshipBlocked()) return;
          previewRelationship(target, { direct: true });
        }, reducedMotionQuery && reducedMotionQuery.matches ? 0 : 90);
      }
      function relationshipHitTarget(key) {
        return relationshipHitTargets.find(function (target) {
          return target.getAttribute('data-relationship-key') === key;
        }) || null;
      }
      function revealPinnedRelationship(record) {
        function reveal() {
          if (!record || pinnedRelationshipKey !== record.key) return true;
          if (!Archify.view || typeof Archify.view.reveal !== 'function') return false;
          Archify.view.reveal([record.from, record.to], { reason: 'relationship-direct' });
          return true;
        }
        if (!reveal()) requestAnimationFrame(reveal);
      }
      function inspectRelationship(key, options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        hoveredRelationship = null;
        focusedRelationship = null;
        if (pinnedRelationshipKey === key) {
          if (options.toggle === false) return true;
          clear({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var record = relationshipRecordForKey(key);
        if (!record) return false;
        set(record.from, { toggle: false, updateUrl: false });
        var row = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-key]')).find(function (candidate) {
          return candidate.getAttribute('data-relationship-key') === key;
        });
        if (!row) return false;
        previewRelationship(row);
        pinnedRelationship = row;
        pinnedRelationshipKey = key;
        svg.setAttribute('data-relationship-pin-active', key);
        var target = relationshipHitTarget(key);
        if (target) target.setAttribute('aria-pressed', 'true');
        renderRelationshipCopyAction();
        summary.textContent = viewerText('viewer.passport.relationship.pinned', {
          from: record.fromLabel,
          to: record.toLabel,
          label: record.label
        });
        revealPinnedRelationship(record);
        if (options.updateUrl !== false && record.id) {
          try { history.replaceState(null, '', location.pathname + location.search + '#relation=' + encodeURIComponent(record.id)); } catch (_) {}
        }
        return true;
      }
      function inspectRelationshipById(id, options) {
        var record = relationshipHitRecords().find(function (item) { return item.id === id; });
        return record ? inspectRelationship(record.key, options) : false;
      }
      function installRelationshipHitTargets() {
        if (html.getAttribute('data-embed') === 'true') return 0;
        var records = relationshipHitRecords();
        if (!records.length) return 0;
        relationshipHitOverlay = document.createElementNS(svgNamespace, 'g');
        relationshipHitOverlay.setAttribute('class', 'relationship-hit-overlay');
        relationshipHitOverlay.setAttribute('data-relationship-hit-overlay', '');
        relationshipHitOverlay.setAttribute('role', 'group');
        relationshipHitOverlay.setAttribute('aria-label', viewerText('viewer.passport.relationship.explorer'));
        var relationshipHelp = document.createElementNS(svgNamespace, 'desc');
        relationshipHelp.id = 'archify-relationship-help';
        relationshipHelp.textContent = viewerText('viewer.passport.relationship.help');
        relationshipHitOverlay.appendChild(relationshipHelp);
        records.forEach(function (record, index) {
          var target = document.createElementNS(svgNamespace, 'g');
          target.setAttribute('class', 'relationship-hit-target');
          target.setAttribute('data-relationship-hit-key', record.key);
          target.setAttribute('data-relationship-key', record.key);
          target.setAttribute('data-relationship-from', record.from);
          target.setAttribute('data-relationship-to', record.to);
          if (record.id) target.setAttribute('data-relationship-id', record.id);
          target.setAttribute('role', 'button');
          target.setAttribute('tabindex', index === 0 ? '0' : '-1');
          target.setAttribute('aria-pressed', 'false');
          target.setAttribute('aria-describedby', relationshipHelp.id);
          var description = viewerText('viewer.passport.relationship.inspect', {
            index: index + 1,
            total: records.length,
            from: record.fromLabel,
            to: record.toLabel,
            label: record.label
          });
          target.setAttribute('aria-label', description);
          var title = document.createElementNS(svgNamespace, 'title');
          title.textContent = record.fromLabel + ' \u2192 ' + record.toLabel + ' \u00b7 ' + record.label;
          target.appendChild(title);
          record.shapes.forEach(function (shape) {
            target.appendChild(relationshipHitGeometry(shape));
            target.appendChild(relationshipHitGeometry(shape, 'relationship-focus-rail'));
          });
          if (target.childNodes.length > 1) {
            relationshipHitTargets.push(target);
            relationshipHitOverlay.appendChild(target);
          }
        });
        if (!relationshipHitTargets.length) return 0;
        var firstNode = svg.querySelector('[data-node-id]');
        var nodeLayer = firstNode;
        while (nodeLayer && nodeLayer.parentNode && nodeLayer.parentNode !== svg) nodeLayer = nodeLayer.parentNode;
        if (nodeLayer && nodeLayer.parentNode === svg) svg.insertBefore(relationshipHitOverlay, nodeLayer);
        else svg.appendChild(relationshipHitOverlay);

        relationshipHitOverlay.addEventListener('pointerdown', function (event) {
          if (event.target.closest('[data-relationship-hit-key]')) event.stopPropagation();
        });
        relationshipHitOverlay.addEventListener('pointerover', function (event) {
          if (event.pointerType === 'touch') return;
          if (finePointerQuery && !finePointerQuery.matches) return;
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked() || pinnedRelationshipKey) return;
          if (event.relatedTarget && target.contains(event.relatedTarget)) return;
          hoveredRelationship = target;
          scheduleDirectRelationshipPreview(target);
        });
        relationshipHitOverlay.addEventListener('pointerout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (hoveredRelationship === target) hoveredRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('focusin', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          focusedRelationship = target;
          if (!pinnedRelationshipKey) previewRelationship(target, { direct: true });
        });
        relationshipHitOverlay.addEventListener('focusout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (focusedRelationship === target) focusedRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('click', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          event.preventDefault();
          event.stopPropagation();
          focusedRelationship = null;
          hoveredRelationship = null;
          inspectRelationship(target.getAttribute('data-relationship-key'));
        });
        relationshipHitOverlay.addEventListener('keydown', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target) return;
          if (event.key === 'Escape' && pinnedRelationshipKey) {
            event.preventDefault();
            clear({ updateUrl: false });
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            focusedRelationship = null;
            hoveredRelationship = null;
            inspectRelationship(target.getAttribute('data-relationship-key'));
            return;
          }
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
          var index = relationshipHitTargets.indexOf(target);
          if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = relationshipHitTargets.length - 1;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % relationshipHitTargets.length;
          else index = (index - 1 + relationshipHitTargets.length) % relationshipHitTargets.length;
          event.preventDefault();
          relationshipHitTargets.forEach(function (item, itemIndex) { item.setAttribute('tabindex', itemIndex === index ? '0' : '-1'); });
          try { relationshipHitTargets[index].focus({ preventScroll: true }); }
          catch (_) { try { relationshipHitTargets[index].focus(); } catch (_) {} }
        });
        return relationshipHitTargets.length;
      }
      function renderRelationshipLens(id, byId) {
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        renderPassport(id, byId[id]);
        var relationships = relationshipsFor(id, byId);
        chip.removeAttribute('data-relations-expanded');
        relationsBtn.setAttribute('aria-expanded', 'false');
        relationsBtn.textContent = viewerCount('viewer.passport.relationship.count', relationships.length);
        relationsBtn.setAttribute('aria-label', viewerCount('viewer.passport.relationship.show', relationships.length));
        var counts = { out: 0, in: 0, loop: 0 };
        relationships.forEach(function (relationship) { counts[relationship.direction] += 1; });
        summary.textContent = viewerText('viewer.passport.relationship.summary', {
          out: counts.out,
          in: counts.in,
          loops: counts.loop ? viewerText('viewer.passport.relationship.loops', { count: counts.loop }) : ''
        });
        renderReachabilityControls(id);
        relationshipList.textContent = '';
        if (!relationships.length) {
          var empty = document.createElement('p');
          empty.className = 'relationship-lens-empty';
          empty.textContent = viewerText('viewer.passport.relationship.none');
          relationshipList.appendChild(empty);
          return;
        }

        [
          { id: 'out', label: viewerText('viewer.passport.relationship.group.out') },
          { id: 'in', label: viewerText('viewer.passport.relationship.group.in') },
          { id: 'loop', label: viewerText('viewer.passport.relationship.group.loop') }
        ].forEach(function (group) {
          var items = relationships.filter(function (relationship) { return relationship.direction === group.id; });
          if (!items.length) return;
          var section = document.createElement('div');
          section.className = 'relationship-lens-group';
          var heading = document.createElement('span');
          heading.className = 'relationship-lens-group-title';
          heading.textContent = group.label + ' · ' + items.length;
          section.appendChild(heading);
          items.forEach(function (relationship) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'relationship-lens-row';
            button.setAttribute('data-direction', relationship.direction);
            button.setAttribute('data-relationship-target', relationship.neighborId);
            button.setAttribute('data-relationship-key', relationship.key);
            button.setAttribute('data-relationship-from', relationship.from);
            button.setAttribute('data-relationship-to', relationship.to);
            if (relationship.id) button.setAttribute('data-relationship-id', relationship.id);
            button.setAttribute('aria-label', viewerText('viewer.passport.relationship.row', {
              group: group.label,
              relationship: relationship.label,
              neighbor: relationship.neighborLabel
            }));
            var direction = document.createElement('span');
            direction.className = 'relationship-lens-direction';
            direction.setAttribute('aria-hidden', 'true');
            direction.textContent = viewerText(relationship.direction === 'out'
              ? 'viewer.passport.relationship.direction.out'
              : relationship.direction === 'in'
                ? 'viewer.passport.relationship.direction.in'
                : 'viewer.passport.relationship.direction.loop');
            var target = document.createElement('strong');
            target.textContent = relationship.neighborLabel;
            var relation = document.createElement('small');
            relation.textContent = relationship.label;
            button.appendChild(direction);
            button.appendChild(target);
            button.appendChild(relation);
            section.appendChild(button);
          });
          relationshipList.appendChild(section);
        });
      }
      function lensPlacementBounds() {
        var containerRect = container.getBoundingClientRect();
        if (containerRect.width <= 0 || containerRect.height <= 0 || chip.offsetWidth <= 0 || chip.offsetHeight <= 0) return null;
        var padding = window.innerWidth <= 720 ? 8 : 16;
        var visibleLeft = Math.max(padding, -containerRect.left + padding);
        var visibleRight = Math.min(
          container.clientWidth - padding,
          window.innerWidth - containerRect.left - padding
        );
        var visibleTop = Math.max(padding, -containerRect.top + padding);
        var visibleBottom = Math.min(
          container.clientHeight - padding,
          window.innerHeight - containerRect.top - padding
        );
        var minLeft = visibleLeft;
        var minTop = Math.min(visibleTop, Math.max(padding, visibleBottom - chip.offsetHeight));
        return {
          containerRect: containerRect,
          minLeft: minLeft,
          maxLeft: Math.max(minLeft, visibleRight - chip.offsetWidth),
          minTop: minTop,
          maxTop: Math.max(minTop, visibleBottom - chip.offsetHeight)
        };
      }
      function manualLensPlacementAvailable() {
        return window.innerWidth > 720 && (!finePointerQuery || finePointerQuery.matches);
      }
      function clampLensPosition(position, bounds) {
        if (!position || !bounds) return null;
        return {
          left: Math.max(bounds.minLeft, Math.min(bounds.maxLeft, position.left)),
          top: Math.max(bounds.minTop, Math.min(bounds.maxTop, position.top))
        };
      }
      function currentLensPosition() {
        var bounds = lensPlacementBounds();
        if (!bounds) return null;
        var rect = chip.getBoundingClientRect();
        return clampLensPosition({
          left: rect.left - bounds.containerRect.left,
          top: rect.top - bounds.containerRect.top
        }, bounds);
      }
      function applyManualLensPosition(position) {
        if (!manualLensPlacementAvailable()) return false;
        var bounds = lensPlacementBounds();
        var clamped = clampLensPosition(position, bounds);
        if (!clamped) return false;
        manualLensPosition = clamped;
        chip.setAttribute('data-manual-placement', 'true');
        chip.style.left = Math.round(clamped.left) + 'px';
        chip.style.top = Math.round(clamped.top) + 'px';
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        return true;
      }
      function resetLensPlacement(options) {
        options = options || {};
        manualLensPosition = null;
        chip.removeAttribute('data-manual-placement');
        chip.style.removeProperty('left');
        chip.style.removeProperty('top');
        if (options.reposition !== false && !chip.hidden) requestLensPlacement();
      }
      function beginLensDrag(event) {
        if (!manualLensPlacementAvailable() || event.button !== 0 || lensDrag) return;
        var start = currentLensPosition();
        if (!start) return;
        event.preventDefault();
        event.stopPropagation();
        lensDrag = {
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          start: start,
          previousManual: manualLensPosition ? { left: manualLensPosition.left, top: manualLensPosition.top } : null,
          moved: false
        };
        chip.setAttribute('data-panel-dragging', 'true');
        try { moveBtn.setPointerCapture(event.pointerId); } catch (_) {}
      }
      function moveLensDrag(event) {
        if (!lensDrag || lensDrag.pointerId !== event.pointerId) return;
        var dx = event.clientX - lensDrag.originX;
        var dy = event.clientY - lensDrag.originY;
        if (!lensDrag.moved && Math.hypot(dx, dy) <= 3) return;
        lensDrag.moved = true;
        event.preventDefault();
        event.stopPropagation();
        applyManualLensPosition({ left: lensDrag.start.left + dx, top: lensDrag.start.top + dy });
      }
      function finishLensDrag(event, cancel) {
        if (!lensDrag || lensDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        var activeDrag = lensDrag;
        lensDrag = null;
        if (activeDrag.moved) lensDragClickPointer = activeDrag.pointerId;
        chip.removeAttribute('data-panel-dragging');
        try { moveBtn.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!cancel) return;
        manualLensPosition = activeDrag.previousManual
          ? { left: activeDrag.previousManual.left, top: activeDrag.previousManual.top }
          : null;
        if (manualLensPosition && manualLensPlacementAvailable()) {
          applyManualLensPosition(manualLensPosition);
        } else {
          chip.removeAttribute('data-manual-placement');
          chip.style.removeProperty('left');
          chip.style.removeProperty('top');
          if (!chip.hidden) requestLensPlacement();
        }
      }
      function moveLensWithKeyboard(event) {
        if (event.key === 'Home') {
          event.preventDefault();
          resetLensPlacement();
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || !manualLensPlacementAvailable()) return;
        var directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1]
        };
        var direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        var current = manualLensPosition || currentLensPosition();
        if (!current) return;
        var distance = event.shiftKey ? 4 : 16;
        applyManualLensPosition({
          left: current.left + direction[0] * distance,
          top: current.top + direction[1] * distance
        });
      }
      var lensFrame = 0;
      function placeRelationshipLens() {
        if (lensFrame) {
          cancelAnimationFrame(lensFrame);
          lensFrame = 0;
        }
        if (chip.hidden || activeIds.length !== 1) return;
        var node = svg.querySelector('[data-node-id="' + activeIds[0] + '"]');
        if (!node) return;
        var containerRect = container.getBoundingClientRect();
        var nodeRect = node.getBoundingClientRect();
        if (containerRect.bottom <= 0 || containerRect.top >= window.innerHeight) return;
        var padding = window.innerWidth <= 720 ? 8 : 16;
        var visibleTop = Math.max(padding, -containerRect.top + padding);
        var visibleBottom = Math.min(containerRect.height - padding, window.innerHeight - containerRect.top - padding);
        var maxTop = Math.max(padding, visibleBottom - chip.offsetHeight);
        var minTop = Math.min(visibleTop, maxTop);
        var mobile = window.innerWidth <= 720;
        if (!manualLensPlacementAvailable()) {
          chip.removeAttribute('data-manual-placement');
          chip.style.removeProperty('left');
        } else if (manualLensPosition) {
          applyManualLensPosition(manualLensPosition);
          return;
        }
        var nodeCenter = nodeRect.top - containerRect.top + nodeRect.height / 2;
        var previewingOnMobile = mobile && chip.getAttribute('data-relationship-previewing') === 'true';
        var compactOnMobile = mobile && chip.getAttribute('data-relations-expanded') !== 'true';
        var preferred;
        if (compactOnMobile) {
          var nodeTop = nodeRect.top - containerRect.top;
          var nodeBottom = nodeRect.bottom - containerRect.top;
          var gap = 10;
          var above = nodeTop - chip.offsetHeight - gap;
          var below = nodeBottom + gap;
          if (above >= visibleTop) preferred = above;
          else if (below + chip.offsetHeight <= visibleBottom - 56) preferred = below;
          else preferred = nodeCenter < (visibleTop + visibleBottom) / 2
            ? Math.max(minTop, visibleBottom - chip.offsetHeight - 56)
            : visibleTop;
        } else if (previewingOnMobile) {
          var pinnedTop = visibleTop;
          var pinnedBottom = Math.max(minTop, visibleBottom - chip.offsetHeight - 56);
          preferred = nodeCenter < (visibleTop + visibleBottom) / 2 ? pinnedBottom : pinnedTop;
        } else {
          preferred = nodeCenter - chip.offsetHeight / 2;
        }
        var top = Math.max(minTop, Math.min(maxTop, preferred));
        var chipRect = chip.getBoundingClientRect();
        var safeGap = 10;
        var protectViewerChrome = !mobile || compactOnMobile || previewingOnMobile;
        var protectedRects = (protectViewerChrome
          ? [svg.querySelector('[data-legend]'), container.querySelector('.diagram-nav')]
          : [])
          .filter(function (element) {
            if (!element || element.hidden) return false;
            var style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(function (element) { return element.getBoundingClientRect(); })
          .filter(function (rect) {
            return rect.width > 0 && rect.height > 0 &&
              chipRect.left < rect.right + safeGap && chipRect.right > rect.left - safeGap;
          });
        if (protectedRects.length) {
          var candidates = [top, minTop, maxTop];
          protectedRects.forEach(function (rect) {
            candidates.push(
              rect.top - containerRect.top - chip.offsetHeight - safeGap,
              rect.bottom - containerRect.top + safeGap
            );
          });
          var valid = candidates.map(function (candidate) {
            return Math.max(minTop, Math.min(maxTop, candidate));
          }).filter(function (candidate, index, all) {
            if (all.indexOf(candidate) !== index) return false;
            var candidateTop = containerRect.top + candidate;
            var candidateBottom = candidateTop + chip.offsetHeight;
            return protectedRects.every(function (rect) {
              return candidateBottom <= rect.top - safeGap || candidateTop >= rect.bottom + safeGap;
            });
          });
          valid.sort(function (first, second) {
            return Math.abs(first - preferred) - Math.abs(second - preferred);
          });
          if (valid.length) top = valid[0];
        }
        chip.style.top = Math.round(top) + 'px';
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
      }
      function requestLensPlacement() {
        if (lensFrame) return;
        lensFrame = requestAnimationFrame(placeRelationshipLens);
      }
      function clear(options) {
        options = options || {};
        if (lensDrag) {
          var dragPointerId = lensDrag.pointerId;
          lensDrag = null;
          chip.removeAttribute('data-panel-dragging');
          try { moveBtn.releasePointerCapture(dragPointerId); } catch (_) {}
        }
        var restoreNode = options.restoreFocus === true && activeIds.length === 1
          ? svg.querySelector('[data-node-id="' + activeIds[0] + '"]')
          : null;
        clearReachability({ updateUrl: false });
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') {
          Archify.intentTrace.clear({ announce: false });
        }
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        activeIds = [];
        svg.removeAttribute('data-focus-active');
        nodes().forEach(function (node) {
          node.removeAttribute('data-focus-match');
          node.removeAttribute('data-focus-selected');
          node.setAttribute('aria-pressed', 'false');
        });
        edges().forEach(function (edge) { edge.removeAttribute('data-focus-match'); });
        chip.hidden = true;
        label.textContent = '';
        detail.textContent = '';
        detail.hidden = true;
        kind.textContent = '';
        kind.hidden = true;
        context.textContent = '';
        context.hidden = true;
        tag.textContent = '';
        tag.hidden = true;
        semanticId.textContent = '';
        semanticId.hidden = true;
        evidence.hidden = true;
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.textContent = '';
        summary.textContent = '';
        reachSection.hidden = true;
        upstreamCount.textContent = '0';
        downstreamCount.textContent = '0';
        upstreamBtn.disabled = true;
        downstreamBtn.disabled = true;
        relationshipList.textContent = '';
        copyBtn.textContent = viewerText('viewer.passport.copy');
        copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        relationsBtn.textContent = viewerText('viewer.passport.relations');
        relationsBtn.setAttribute('aria-label', viewerText('viewer.passport.relations.show'));
        relationsBtn.setAttribute('aria-expanded', 'false');
        chip.removeAttribute('data-relations-expanded');
        if (options.preserveLensPlacement !== true) resetLensPlacement({ reposition: false });
        if (options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
        }
        if (restoreNode) {
          try { restoreNode.focus({ preventScroll: true }); }
          catch (_) { try { restoreNode.focus(); } catch (_) {} }
        }
      }

      function setMany(ids, options) {
        options = options || {};
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.active()) {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        if (options.preserveRoute !== true && Archify.routeProbe && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        var nodeList = nodes();
        var byId = Object.create(null);
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var normalized = [];
        (ids || []).forEach(function (id) {
          if (byId[id] && normalized.indexOf(id) === -1) normalized.push(id);
        });
        if (!normalized.length) return false;
        if (normalized.length === activeIds.length && normalized.every(function (id, index) { return activeIds[index] === id; }) && options.toggle !== false) {
          clear();
          return true;
        }

        var preserveLensPlacement = activeIds.length === 1 && normalized.length === 1 && !chip.hidden;
        clear({ updateUrl: false, preserveView: true, preserveLensPlacement: preserveLensPlacement });
        activeIds = normalized;
        var selected = Object.create(null);
        var related = Object.create(null);
        var seenEdges = {};
        var matchedEdges = 0;
        normalized.forEach(function (id) { selected[id] = true; related[id] = true; });
        var selectionMode = options.mode === 'selection' || normalized.length > 1;

        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var match = selectionMode ? selected[from] && selected[to] : selected[from] || selected[to];
          if (!match) return;
          edge.setAttribute('data-focus-match', '');
          if (!selectionMode) { related[from] = true; related[to] = true; }
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!seenEdges[edgeKey]) { seenEdges[edgeKey] = true; matchedEdges += 1; }
        });
        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-focus-match', '');
          if (selected[nodeId]) {
            node.setAttribute('data-focus-selected', '');
            node.setAttribute('aria-pressed', 'true');
          }
        });
        svg.setAttribute('data-focus-active', normalized.join(' '));
        var defaultLabel = normalized.length === 1
          ? nodeLabel(byId[normalized[0]], normalized[0])
          : viewerText('viewer.focus.selectedNodes', { count: normalized.length });
        label.textContent = options.label || defaultLabel;
        chip.hidden = options.hideChip === true || normalized.length !== 1 || selectionMode;
        if (!chip.hidden) {
          renderRelationshipLens(normalized[0], byId);
          placeRelationshipLens();
        }
        if (options.updateUrl !== false) {
          var key = options.urlKey || 'focus';
          var value = options.urlValue || normalized[0];
          try { history.replaceState(null, '', location.pathname + location.search + '#' + key + '=' + encodeURIComponent(value)); } catch (_) {}
        }
        return true;
      }

      function set(id, options) {
        options = options || {};
        options.mode = 'neighborhood';
        return setMany([id], options);
      }

      function fallbackCopy(value) {
        var field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        field.remove();
        return copied;
      }

      function copyFocusLink() {
        if (activeIds.length !== 1) return Promise.resolve(false);
        var record = pinnedRelationshipRecord();
        var relationId = record && record.id;
        var value = location.href.replace(/#.*$/, '') + (relationId
          ? '#relation=' + encodeURIComponent(relationId)
          : '#focus=' + encodeURIComponent(activeIds[0]) + (reachabilityMode ? '&reach=' + reachabilityMode : ''));
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          copyBtn.setAttribute('aria-label', copied
            ? viewerText(relationId ? 'viewer.passport.copy.pinned.success' : 'viewer.passport.copy.focused.success')
            : viewerText(relationId ? 'viewer.passport.copy.pinned.failed' : 'viewer.passport.copy.focused.failed'));
          window.setTimeout(function () {
            renderRelationshipCopyAction();
          }, 1600);
          return copied;
        });
      }

      svg.addEventListener('click', function (event) {
        if (container.getAttribute('data-just-panned') === 'true') return;
        var node = event.target.closest('[data-node-id]');
        if (node) {
          var id = node.getAttribute('data-node-id');
          set(id);
          if (activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
            Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
          }
        }
        else if (activeIds.length) clear();
      });
      svg.addEventListener('keydown', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        var id = node.getAttribute('data-node-id');
        set(id);
        if (activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
        }
      });
      moveBtn.addEventListener('pointerdown', beginLensDrag);
      moveBtn.addEventListener('pointermove', moveLensDrag);
      moveBtn.addEventListener('pointerup', function (event) { finishLensDrag(event, false); });
      moveBtn.addEventListener('pointercancel', function (event) { finishLensDrag(event, true); });
      moveBtn.addEventListener('lostpointercapture', function (event) { finishLensDrag(event, true); });
      moveBtn.addEventListener('dblclick', function (event) {
        event.preventDefault();
        event.stopPropagation();
        resetLensPlacement();
      });
      moveBtn.addEventListener('keydown', moveLensWithKeyboard);
      clearBtn.addEventListener('click', function () { clear({ restoreFocus: true }); });
      copyBtn.addEventListener('click', copyFocusLink);
      upstreamBtn.addEventListener('click', function () { applyReachability('upstream'); });
      downstreamBtn.addEventListener('click', function () { applyReachability('downstream'); });
      relationsBtn.addEventListener('click', function () {
        var expanded = chip.getAttribute('data-relations-expanded') === 'true';
        if (expanded) chip.removeAttribute('data-relations-expanded');
        else chip.setAttribute('data-relations-expanded', 'true');
        relationsBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        relationsBtn.setAttribute('aria-label', viewerText(expanded
          ? 'viewer.passport.relations.show'
          : 'viewer.passport.relations.hide'));
        placeRelationshipLens();
      });
      relationshipList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-relationship-target]');
        if (!button) return;
        var id = button.getAttribute('data-relationship-target');
        set(id, { toggle: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'relationship' });
        }
        var node = svg.querySelector('[data-node-id="' + id + '"]');
        if (node) {
          try { node.focus({ preventScroll: true }); } catch (_) { try { node.focus(); } catch (_) {} }
        }
      });
      relationshipList.addEventListener('pointerover', function (event) {
        if (event.pointerType === 'touch') return;
        if (finePointerQuery && !finePointerQuery.matches) return;
        var button = event.target.closest('[data-relationship-key]');
        if (!button || !relationshipList.contains(button)) return;
        if (event.relatedTarget && button.contains(event.relatedTarget)) return;
        hoveredRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('pointerout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (hoveredRelationship === button) hoveredRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusin', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button) return;
        focusedRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (focusedRelationship === button) focusedRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
        var buttons = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-target]'));
        if (!buttons.length) return;
        var index = buttons.indexOf(document.activeElement);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else if (event.key === 'ArrowDown') index = Math.min(buttons.length - 1, Math.max(0, index + 1));
        else index = Math.max(0, index < 0 ? 0 : index - 1);
        event.preventDefault();
        buttons[index].focus();
      });
      document.addEventListener('pointerdown', function () {
        lensDragClickPointer = null;
      }, true);
      document.addEventListener('click', function (event) {
        // Losing capture (for example when a resize hides the handle) can
        // retarget this drag's final click to the page. It is not dismissal.
        // A new pointerdown releases the guard; keyboard clicks remain live.
        if (lensDragClickPointer != null && event.detail > 0 &&
            (event.pointerId == null || event.pointerId === lensDragClickPointer)) {
          lensDragClickPointer = null;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        var target = event.target;
        if (chip.hidden || !target || typeof target.closest !== 'function' || chip.contains(target)) return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        if (target.closest('[data-node-id], [data-relationship-hit-key], .overview-map')) return;
        clear();
      }, true);
      window.addEventListener('scroll', requestLensPlacement, { passive: true });
      window.addEventListener('resize', requestLensPlacement);
      container.addEventListener('scroll', requestLensPlacement, { passive: true });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) removeRelationshipPulse();
      });
      function syncRelationshipMotionPreference(event) {
        if (event.matches) removeRelationshipPulse();
      }
      if (reducedMotionQuery) {
        if (typeof reducedMotionQuery.addEventListener === 'function') {
          reducedMotionQuery.addEventListener('change', syncRelationshipMotionPreference);
        } else if (typeof reducedMotionQuery.addListener === 'function') {
          reducedMotionQuery.addListener(syncRelationshipMotionPreference);
        }
      }

      installRelationshipHitTargets();

      function syncFocusFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var relation = params.get('relation');
          var initial = params.get('focus');
          var reach = params.get('reach');
          if (relation) {
            if (html.getAttribute('data-embed') === 'true' ||
                !inspectRelationshipById(relation, { updateUrl: false, toggle: false })) clear({ updateUrl: false });
          }
          else if (initial) {
            if (set(initial, { updateUrl: false, toggle: false }) &&
                (reach === 'upstream' || reach === 'downstream')) {
              applyReachability(reach, { updateUrl: false, toggle: false, reveal: false });
            }
          }
          else clear({ updateUrl: false });
        } catch (_) {}
      }

      window.addEventListener('hashchange', syncFocusFromHash);
      syncFocusFromHash();

      return {
        set: set,
        setMany: setMany,
        clear: clear,
        copyLink: copyFocusLink,
        reach: applyReachability,
        clearReach: clearReachability,
        reachabilitySnapshot: reachabilitySnapshot,
        inspectRelationship: inspectRelationship,
        inspectRelationshipById: inspectRelationshipById,
        reposition: placeRelationshipLens,
        relationship: function () {
          var record = pinnedRelationshipRecord();
          return record ? { id: record.id || null, key: record.key, from: record.from, to: record.to, label: record.label } : null;
        },
        reachability: function () {
          return activeReachability ? {
            direction: activeReachability.direction,
            originId: activeReachability.originId,
            nodeIds: activeReachability.nodeIds.slice(),
            edgeKeys: activeReachability.edgeKeys.slice(),
            maxDepth: activeReachability.maxDepth
          } : null;
        },
        active: function () { return activeIds.length === 0 ? null : (activeIds.length === 1 ? activeIds[0] : activeIds.slice()); }
      };
    })();


    /* ============================================================
       Intent Trace — temporary one-hop topology before durable focus.
       Fine-pointer hover and keyboard focus share the same stable-ID preview;
       touch continues directly to the existing click-to-focus contract.
       ============================================================ */
    Archify.intentTrace = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var status = document.getElementById('intent-trace-status');
      var namespace = 'http://www.w3.org/2000/svg';
      var activeId = null;
      var hoveredNode = null;
      var focusedNode = null;
      var enterTimer = null;

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function finePointer() {
        return !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      }
      function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
      function blocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
          container.classList.contains('is-panning') ||
          svg.hasAttribute('data-lens-active') ||
          svg.hasAttribute('data-relationship-preview-active') ||
          !!(Archify.routeProbe && typeof Archify.routeProbe.active === 'function' && Archify.routeProbe.active()) ||
          !!(Archify.focus && typeof Archify.focus.active === 'function' && Archify.focus.active());
      }
      function edgeShapes(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function removeOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-intent-trace-overlay]'), function (overlay) {
          overlay.remove();
        });
      }
      function clear(options) {
        options = options || {};
        if (enterTimer) window.clearTimeout(enterTimer);
        enterTimer = null;
        activeId = null;
        svg.removeAttribute('data-intent-trace-active');
        removeOverlay();
        nodes().forEach(function (node) {
          node.removeAttribute('data-intent-trace-match');
          node.removeAttribute('data-intent-trace-selected');
        });
        edges().forEach(function (edge) { edge.removeAttribute('data-intent-trace-match'); });
        if (options.announce !== false) status.textContent = '';
      }
      function traceGeometry(shape, direction) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-intent-trace-match');
        clone.removeAttribute('data-intent-trace-selected');
        clone.setAttribute('class', 'intent-trace-flow');
        clone.setAttribute('data-direction', direction);
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function show(id, options) {
        options = options || {};
        if (!id || blocked()) {
          clear({ announce: false });
          return false;
        }
        if (activeId === id) return true;
        clear({ announce: false });
        var nodeList = nodes();
        var edgeList = edges();
        var byId = Object.create(null);
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var selected = byId[id];
        if (!selected) return false;

        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'intent-trace-overlay');
        overlay.setAttribute('data-intent-trace-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var related = Object.create(null);
        var seen = {};
        var counts = { out: 0, in: 0, loop: 0 };
        related[id] = true;

        edgeList.forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var key = edge.getAttribute('data-edge-key') ||
            (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!seen[key]) {
            seen[key] = true;
            counts[direction] += 1;
          }
          related[from] = true;
          related[to] = true;
          edge.setAttribute('data-intent-trace-match', '');
          var wrapper = document.createElementNS(namespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          edgeShapes(edge).forEach(function (shape) {
            wrapper.appendChild(traceGeometry(shape, direction));
          });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });

        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-intent-trace-match', '');
          if (nodeId === id) node.setAttribute('data-intent-trace-selected', '');
        });
        if (overlay.childNodes.length) {
          var firstEdge = edgeList[0];
          var firstNode = svg.querySelector('[data-node-id]');
          if (firstEdge && firstEdge.parentNode) firstEdge.parentNode.insertBefore(overlay, firstEdge);
          else if (firstNode) svg.insertBefore(overlay, firstNode);
          else svg.appendChild(overlay);
        }
        activeId = id;
        svg.setAttribute('data-intent-trace-active', id);
        if (options.announce === true) {
          var total = counts.out + counts.in + counts.loop;
          status.textContent = viewerText('viewer.intent.summary', {
            label: nodeLabel(selected, id),
            out: counts.out,
            in: counts.in,
            loops: counts.loop ? viewerText('viewer.intent.loops', { count: counts.loop }) : '',
            total: total
          });
        }
        return true;
      }
      function schedule(node) {
        if (enterTimer) window.clearTimeout(enterTimer);
        enterTimer = window.setTimeout(function () {
          enterTimer = null;
          if (hoveredNode === node) show(node.getAttribute('data-node-id'), { announce: false });
        }, reducedMotion() ? 0 : 90);
      }
      function sync() {
        var candidate = focusedNode || hoveredNode;
        if (!candidate) {
          clear();
          return;
        }
        show(candidate.getAttribute('data-node-id'), { announce: candidate === focusedNode });
      }

      svg.addEventListener('pointerover', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || !finePointer() || event.pointerType === 'touch') return;
        if (event.relatedTarget && node.contains(event.relatedTarget)) return;
        hoveredNode = node;
        schedule(node);
      });
      svg.addEventListener('pointerout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (hoveredNode === node) hoveredNode = null;
        sync();
      });
      svg.addEventListener('focusin', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        focusedNode = node;
        show(node.getAttribute('data-node-id'), { announce: true });
      });
      svg.addEventListener('focusout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (focusedNode === node) focusedNode = null;
        sync();
      });
      container.addEventListener('pointerdown', function (event) {
        if (!event.target.closest('[data-node-id]')) clear({ announce: false });
      });
      window.addEventListener('blur', function () { clear({ announce: false }); });

      return {
        show: show,
        clear: clear,
        active: function () { return activeId; }
      };
    })();

    /* ============================================================
       Adaptive Reader Shell — one diagram across laptop and monitor.
       The canonical SVG and viewBox never change. On ordinary desktop pages,
       wide diagrams and measured intrinsic tall workflows receive enough outer width to use the available
       height without pushing summary cards below the viewport. Mobile,
       embed, presentation, print, and unmarked non-wide diagrams retain their own
       established layout contracts.
       ============================================================ */
    // Fixed script-private participants; the CLI sees only the joint wait below.
    const archifyLayoutOwners = { reader: null, viewerChrome: null };
    Archify.waitForStableLayout = function (options) {
      options = options || {};
      var maximumFrames = Math.max(1, Number(options.maximumFrames) || 240);
      var fontsReady = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(function () {})
        : Promise.resolve();
      return fontsReady.then(function () {
        if (typeof options.schedule === 'function') options.schedule();
        return new Promise(function (resolve, reject) {
          var previous = '';
          var stableFrames = 0;
          var sampledFrames = 0;
          function sample() {
            sampledFrames += 1;
            if (typeof options.pending === 'function' && options.pending()) {
              previous = '';
              stableFrames = 0;
            } else {
              var current = typeof options.snapshot === 'function' ? options.snapshot() : '';
              if (current === previous) stableFrames += 1;
              else {
                previous = current;
                stableFrames = 0;
              }
              if (stableFrames >= 3) {
                resolve({ stable: true, snapshot: current, sampledFrames: sampledFrames });
                return;
              }
            }
            if (sampledFrames >= maximumFrames) {
              reject(new Error(options.timeoutMessage || 'Layout did not reach stable dimensions.'));
              return;
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
      });
    };

    Archify.readerLayout = (function () {
      var html = document.documentElement;
      var body = document.body;
      var shell = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && diagram.querySelector(':scope > svg');
      var header = shell && shell.querySelector('.header');
      var cards = shell && shell.querySelector('.cards');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var ratio = viewBox && viewBox.height > 0 ? viewBox.width / viewBox.height : 0;
      var measuredHeightFit = svg && svg.getAttribute('data-reader-fit') === 'intrinsic-height';
      var frame = 0;
      var settleFrame = 0;
      var lastWidth = 0;
      // Widest reader the overflow settle has accepted for this viewport (0 =
      // uncapped). Card copy rewraps as the reader narrows, so recomputing
      // from fixed heights alone would widen again and oscillate; only a
      // resize lifts the cap.
      var settledCap = 0;
      var WIDE_RATIO = 1.55;
      var MIN_DESKTOP_WIDTH = 1024;
      var MIN_READER_WIDTH = 960;
      var MAX_READER_WIDTH = 1920;
      var MIN_PROJECTED_NODE_TEXT_PX = 6;
      var declaredMinimumText = svg ? parseFloat(svg.getAttribute('data-reader-min-text') || '') : null;
      var requestedMinimumText = Number.isFinite(declaredMinimumText)
        ? Math.max(MIN_PROJECTED_NODE_TEXT_PX, declaredMinimumText)
        : MIN_PROJECTED_NODE_TEXT_PX;
      var declaredPrimaryText = svg ? parseFloat(svg.getAttribute('data-reader-primary-text') || '') : null;
      var SAFE_BOTTOM_GAP = 12;
      // Wide viewports move summary cards beside the diagram, so the height
      // budget belongs to the diagram and spare width holds the notes.
      var RAIL_MIN_VIEWPORT = 1280;
      var RAIL_WIDTH = 288;
      var RAIL_GAP = 20;
      // A default rail must leave primary node labels comfortably readable;
      // otherwise it starts collapsed and the reader can still open it.
      var RAIL_COMFORT_PRIMARY_PX = 12;
      var railPanel = shell && shell.querySelector('.reader-rail');
      var railReveal = document.getElementById('rail-reveal');
      var railCollapse = document.getElementById('rail-collapse');
      var railPlacement = document.getElementById('rail-placement');
      var RAIL_COLLAPSED_KEY = 'archify-rail-collapsed';
      var RAIL_PLACEMENT_KEY = 'archify-rail-placement';
      // Memory is the page's source of truth; storage only carries the choice
      // to later artifacts, so a blocked or full localStorage cannot freeze it.
      var preferences = Object.create(null);
      function readPreference(key) {
        if (key in preferences) return preferences[key];
        try { return localStorage.getItem(key); } catch (_) { return null; }
      }
      function writePreference(key, value) {
        preferences[key] = value;
        try { localStorage.setItem(key, value); } catch (_) {}
      }

      if (diagram && ratio >= WIDE_RATIO) {
        diagram.setAttribute('data-wide-diagram', 'true');
        html.setAttribute('data-diagram-shape', 'wide');
      }

      function number(value) {
        var parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function visible(element) {
        return Boolean(element && !element.hidden && window.getComputedStyle(element).display !== 'none');
      }
      function outerHeight(element) {
        if (!visible(element)) return 0;
        var style = window.getComputedStyle(element);
        return element.getBoundingClientRect().height + number(style.marginTop) + number(style.marginBottom);
      }
      // Smallest scale that keeps node text at the requested floor and
      // context relationship labels readable. A declared wide reader holds
      // relationship labels to the requested floor too; every other reader
      // still keeps them at the 6px hard floor the browser gate enforces, so
      // a first-screen fit can never push them below it.
      function minimumReadableScale() {
        var nodeMinimum = null;
        var edgeMinimum = null;
        var selectors = 'text[data-node-label], text[data-boundary-label], text[data-detail="context"], g[data-detail="context"] text';
        Array.from(svg.querySelectorAll(selectors)).forEach(function (text) {
          if (text.getAttribute('data-detail') === 'fine' || text.closest('[data-detail="fine"]')) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (!Number.isFinite(sourceFontPx)) return;
          var primary = text.hasAttribute('data-node-label') || text.hasAttribute('data-boundary-label');
          var context = text.getAttribute('data-detail') === 'context' || Boolean(text.closest('g[data-detail="context"]'));
          if (!primary && context && text.closest('[data-edge-from][data-edge-to]')) {
            edgeMinimum = edgeMinimum == null ? sourceFontPx : Math.min(edgeMinimum, sourceFontPx);
          } else if (primary || text.closest('[data-node-id]')) {
            nodeMinimum = nodeMinimum == null ? sourceFontPx : Math.min(nodeMinimum, sourceFontPx);
          }
        });
        var edgeTarget = measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)
          ? requestedMinimumText
          : MIN_PROJECTED_NODE_TEXT_PX;
        var scale = 0;
        if (nodeMinimum != null) scale = Math.max(scale, requestedMinimumText / nodeMinimum);
        if (edgeMinimum != null) scale = Math.max(scale, edgeTarget / edgeMinimum);
        return scale > 0 ? Math.min(1, scale) : 1;
      }
      var sourcePrimary = null;
      if (svg) Array.from(svg.querySelectorAll('text[data-node-label]')).forEach(function (text) {
        var size = parseFloat(text.getAttribute('font-size') || '');
        if (Number.isFinite(size) && size > 0) sourcePrimary = sourcePrimary == null ? size : Math.max(sourcePrimary, size);
      });
      // SVG width at which the largest node label renders at targetPx. Every
      // renderer writes label font sizes, so the rail comfort check works for
      // all diagram types; only the renderer-declared floor needs metadata.
      function labelWidth(targetPx) {
        return sourcePrimary == null || !viewBox ? 0 : viewBox.width * targetPx / sourcePrimary;
      }
      function primaryReadingWidth() {
        if (!measuredHeightFit || !Number.isFinite(declaredPrimaryText) || declaredPrimaryText <= 0) return 0;
        // Primary labels should remain comfortable to read when cards or
        // auxiliary rows make a one-screen fit too small. Ordinary page
        // scroll preserves that reading size; viewport width still caps it.
        // A long title may already use a smaller fitted font. Preserve that
        // hierarchy rather than enlarging every other node to compensate.
        return labelWidth(declaredPrimaryText);
      }
      function eligible() {
        return Boolean(
          shell && diagram && svg && (ratio >= WIDE_RATIO || measuredHeightFit) &&
          window.innerWidth >= MIN_DESKTOP_WIDTH &&
          html.getAttribute('data-embed') !== 'true' &&
          html.getAttribute('data-present') !== 'true' &&
          (!window.matchMedia || !window.matchMedia('print').matches)
        );
      }
      function clear() {
        html.style.removeProperty('--archify-reader-width');
        html.style.removeProperty('--archify-diagram-max-width');
        html.removeAttribute('data-reader-narrow');
        html.removeAttribute('data-reader-layout');
        html.removeAttribute('data-reader-overflow');
        setRail(false);
        lastWidth = 0;
        settledCap = 0;
      }
      // Rail modes: "true" docks beside the diagram, "collapsed" leaves only the
      // reveal control, "overlay" opens a drawer when docking would break the
      // readable floor, and "bottom" stacks notes and index below the diagram.
      function setRail(mode) {
        if (mode) {
          html.setAttribute('data-reader-rail', mode);
          html.style.setProperty('--archify-rail-width', RAIL_WIDTH + 'px');
          html.style.setProperty('--archify-rail-gap', RAIL_GAP + 'px');
        } else {
          html.removeAttribute('data-reader-rail');
          html.style.removeProperty('--archify-rail-width');
          html.style.removeProperty('--archify-rail-gap');
        }
        if (railReveal) railReveal.hidden = mode !== 'collapsed';
        if (railCollapse) {
          railCollapse.hidden = mode !== 'true' && mode !== 'overlay';
          railCollapse.setAttribute('aria-expanded', String(mode === 'true' || mode === 'overlay'));
        }
        if (railPlacement) {
          railPlacement.hidden = !mode || mode === 'collapsed' || (mode === 'bottom' && window.innerWidth < RAIL_MIN_VIEWPORT);
          railPlacement.setAttribute('data-placement', mode === 'bottom' ? 'bottom' : 'right');
          railPlacement.setAttribute('aria-label', viewerText(mode === 'bottom' ? 'viewer.rail.right' : 'viewer.rail.bottom'));
          railPlacement.title = railPlacement.getAttribute('aria-label');
        }
      }
      var outline = document.getElementById('node-outline');
      function hasCards() {
        return Boolean((cards && cards.children.length && !cards.hidden) || (outline && !outline.hidden));
      }
      // Bottom notes and index are reading material below the fold: the first
      // screen belongs to the interactive diagram and its controls.
      function belowFold() {
        return html.getAttribute('data-reader-rail') === 'bottom' ? outerHeight(railPanel) : 0;
      }
      // A docked rail may run past a short diagram down to the viewport floor,
      // so the index uses that space instead of scrolling inside the diagram's
      // height; it never pushes the page into overflow.
      function fitDockedRail() {
        if (html.getAttribute('data-reader-rail') !== 'true' || !railPanel) return;
        var top = railPanel.getBoundingClientRect().top + window.scrollY;
        var floor = window.innerHeight - number(window.getComputedStyle(body).paddingBottom) - top;
        html.style.setProperty('--archify-rail-max', Math.max(diagram.getBoundingClientRect().height, floor) + 'px');
      }
      function chromeMetrics() {
        var bodyStyle = window.getComputedStyle(body);
        var diagramStyle = window.getComputedStyle(diagram);
        return {
          bodyX: number(bodyStyle.paddingLeft) + number(bodyStyle.paddingRight),
          bodyY: number(bodyStyle.paddingTop) + number(bodyStyle.paddingBottom),
          diagramX: number(diagramStyle.paddingLeft) + number(diagramStyle.paddingRight) +
            number(diagramStyle.borderLeftWidth) + number(diagramStyle.borderRightWidth),
          diagramY: number(diagramStyle.paddingTop) + number(diagramStyle.paddingBottom) +
            number(diagramStyle.borderTopWidth) + number(diagramStyle.borderBottomWidth)
        };
      }
      // `width` is the diagram's reading width. The page shell never narrows
      // below the desktop reader floor, so a narrow, tall diagram keeps a
      // usable header, toolbar, and controls; its SVG is centred instead.
      function applyWidth(width, minWidth) {
        var rounded = Math.max(Math.ceil(minWidth || 0), Math.round(width));
        if (Math.abs(rounded - lastWidth) < 1) return false;
        lastWidth = rounded;
        var shellFloor = Math.min(MIN_READER_WIDTH, Math.max(0, window.innerWidth - chromeMetrics().bodyX));
        html.style.setProperty('--archify-reader-width', Math.max(rounded, shellFloor) + 'px');
        if (rounded < shellFloor) {
          // `rounded` already includes a docked rail and its gap; the SVG cap
          // is only the diagram's share, not the space beside it.
          var railShare = html.getAttribute('data-reader-rail') === 'true' ? RAIL_WIDTH + RAIL_GAP : 0;
          html.style.setProperty('--archify-diagram-max-width', Math.max(1, rounded - railShare - chromeMetrics().diagramX) + 'px');
          html.setAttribute('data-reader-narrow', 'true');
        } else {
          html.style.removeProperty('--archify-diagram-max-width');
          html.removeAttribute('data-reader-narrow');
        }
        html.setAttribute('data-reader-layout', 'adaptive');
        return true;
      }
      function settleOverflow(minWidth) {
        if (settleFrame) cancelAnimationFrame(settleFrame);
        settleFrame = requestAnimationFrame(function () {
          settleFrame = 0;
          if (!eligible() || !lastWidth) return;
          fitDockedRail();
          var overflow = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          ) - window.innerHeight - belowFold();
          if (overflow > 1 && lastWidth > Math.ceil(minWidth)) {
            applyWidth(Math.max(minWidth, lastWidth - overflow * ratio - 4), minWidth);
            settledCap = lastWidth;
            html.setAttribute('data-reader-overflow', 'reduced');
          } else if (overflow > 1) {
            html.setAttribute('data-reader-overflow', 'authored');
          } else {
            html.removeAttribute('data-reader-overflow');
          }
        });
      }
      function measure() {
        frame = 0;
        if (!eligible()) {
          clear();
          return null;
        }
        var chrome = chromeMetrics();
        var viewportCap = Math.max(0, window.innerWidth - chrome.bodyX);
        var readableWidth = viewBox && viewBox.width > 0
          ? viewBox.width * minimumReadableScale() + chrome.diagramX
          : MIN_READER_WIDTH;
        var maxWidth = Math.min(MAX_READER_WIDTH, viewportCap);
        var readableMinimumWidth = measuredHeightFit && ratio < WIDE_RATIO
          ? readableWidth
          : measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)
            ? Math.max(MIN_READER_WIDTH, readableWidth)
            : MIN_READER_WIDTH;
        var minWidth;
        if (measuredHeightFit && ratio < WIDE_RATIO) {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        } else if (measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)) {
          minWidth = Math.min(readableMinimumWidth, maxWidth);
        } else {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        }
        var primaryWidth = primaryReadingWidth();
        var railExtra = RAIL_WIDTH + RAIL_GAP;
        var mode = null;
        // Notes default below the diagram; the right rail is the reader's
        // opt-in and needs a wide viewport.
        if (hasCards() && (readPreference(RAIL_PLACEMENT_KEY) !== 'right' || window.innerWidth < RAIL_MIN_VIEWPORT)) {
          mode = 'bottom';
        } else if (hasCards()) {
          var fitsReadable = readableMinimumWidth + railExtra <= maxWidth;
          var comfortWidth = labelWidth(RAIL_COMFORT_PRIMARY_PX);
          var comfortable = fitsReadable && (!comfortWidth || comfortWidth + chrome.diagramX + railExtra <= maxWidth);
          var collapsedPreference = readPreference(RAIL_COLLAPSED_KEY);
          if (collapsedPreference === '1' || (collapsedPreference !== '0' && !comfortable)) mode = 'collapsed';
          else mode = fitsReadable ? 'true' : 'overlay';
        }
        // With notes below the fold, the first screen belongs to the whole
        // diagram and its controls: it may shrink past the comfortable primary
        // size down to the renderer's readable text floor, and zoom restores
        // detail. Only a graph taller than that floor allows still scrolls.
        if (mode === 'bottom') primaryWidth = 0;
        if (primaryWidth > 0) minWidth = Math.max(minWidth, Math.min(maxWidth, primaryWidth + chrome.diagramX));
        var docked = mode === 'true';
        setRail(mode);
        chrome = chromeMetrics();
        if (docked) minWidth = Math.min(maxWidth, minWidth + railExtra);
        var stackedBelow = mode === 'bottom' ? 0 : docked ? 0 : outerHeight(cards);
        var fixedHeight = chrome.bodyY + chrome.diagramY + SAFE_BOTTOM_GAP +
          outerHeight(header) + stackedBelow;
        var availableSvgHeight = Math.max(1, window.innerHeight - fixedHeight);
        var desiredWidth = availableSvgHeight * ratio + chrome.diagramX + (docked ? railExtra : 0);
        var width = Math.max(minWidth, Math.min(maxWidth, desiredWidth, settledCap || desiredWidth));
        applyWidth(width, minWidth);
        settleOverflow(minWidth);
        return {
          ratio: ratio,
          width: lastWidth,
          availableSvgHeight: Math.round(availableSvgHeight),
          fixedHeight: Math.round(fixedHeight)
        };
      }
      function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(measure);
      }
      function stableSnapshot() {
        var shellRect = shell ? shell.getBoundingClientRect() : { width: 0, height: 0 };
        var diagramRect = diagram ? diagram.getBoundingClientRect() : { width: 0, height: 0 };
        return [
          lastWidth,
          html.getAttribute('data-reader-layout') || '',
          html.getAttribute('data-reader-overflow') || '',
          Math.ceil(document.documentElement.scrollWidth),
          Math.ceil(document.documentElement.scrollHeight),
          Math.ceil(document.body.scrollWidth),
          Math.ceil(document.body.scrollHeight),
          Math.round(shellRect.width * 100) / 100,
          Math.round(shellRect.height * 100) / 100,
          Math.round(diagramRect.width * 100) / 100,
          Math.round(diagramRect.height * 100) / 100
        ].join('|');
      }
      function layoutPending() { return Boolean(frame || settleFrame); }
      function whenStable() {
        return Archify.waitForStableLayout({
          schedule: schedule,
          pending: layoutPending,
          snapshot: stableSnapshot,
          timeoutMessage: 'Adaptive reader layout did not reach stable dimensions.'
        });
      }
      archifyLayoutOwners.reader = { schedule: schedule, pending: layoutPending, snapshot: stableSnapshot };

      window.addEventListener('resize', function () {
        settledCap = 0;
        schedule();
      }, { passive: true });
      window.addEventListener('load', schedule, { once: true });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(function () {});
      if (typeof ResizeObserver === 'function') {
        var resizeObserver = new ResizeObserver(schedule);
        [header, cards].forEach(function (element) { if (element) resizeObserver.observe(element); });
      }
      if (typeof MutationObserver === 'function') {
        var contentObserver = new MutationObserver(schedule);
        if (cards) contentObserver.observe(cards, { attributes: true, childList: true, subtree: true });
        contentObserver.observe(html, { attributes: true, attributeFilter: ['data-embed', 'data-present'] });
      }
      // Reader choices persist across artifacts; a resize-style remeasure
      // applies them without reloading.
      function chooseRail(key, value) {
        writePreference(key, value);
        settledCap = 0;
        schedule();
      }
      function collapseRail() {
        chooseRail(RAIL_COLLAPSED_KEY, '1');
        if (railReveal) requestAnimationFrame(function () { try { railReveal.focus({ preventScroll: true }); } catch (_) {} });
      }
      if (railReveal) railReveal.addEventListener('click', function () { chooseRail(RAIL_COLLAPSED_KEY, '0'); });
      if (railCollapse) railCollapse.addEventListener('click', collapseRail);
      if (railPlacement) railPlacement.addEventListener('click', function () {
        var toBottom = html.getAttribute('data-reader-rail') !== 'bottom';
        if (!toBottom) writePreference(RAIL_COLLAPSED_KEY, '0');
        chooseRail(RAIL_PLACEMENT_KEY, toBottom ? 'bottom' : 'right');
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && html.getAttribute('data-reader-rail') === 'overlay') collapseRail();
      });
      document.addEventListener('pointerdown', function (event) {
        if (html.getAttribute('data-reader-rail') !== 'overlay' || !railPanel) return;
        if (!railPanel.contains(event.target) && !(railReveal && railReveal.contains(event.target))) chooseRail(RAIL_COLLAPSED_KEY, '1');
      });
      if (typeof ResizeObserver === 'function' && railPanel) new ResizeObserver(schedule).observe(railPanel);
      schedule();

      return {
        measure: measure,
        schedule: schedule,
        whenStable: whenStable,
        active: function () { return html.getAttribute('data-reader-layout') === 'adaptive'; },
        receipt: function () { return { ratio: ratio, width: lastWidth }; }
      };
    })();

    /* ============================================================
       Viewer Chrome Layout — keep HTML controls clear of the canonical SVG
       stage without changing authored geometry. The dock keeps its floating
       appearance while a small bottom stage rail becomes part of the reader
       budget whenever its zero-reserve position would enter the stage.
       ============================================================ */
    Archify.viewerChromeLayout = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container && container.querySelector(':scope > svg');
      var nav = container && container.querySelector('.diagram-nav');
      var legend = svg && svg.querySelector('[data-legend]');
      var frame = 0;
      var settleFrame = 0;
      var reserve = 0;
      var railLatched = false;
      var probingBaseline = false;
      var probePromise = null;
      var baselineIntersectionArea = 0;
      var baselineStageGap = null;
      var restorableReserve = 0;
      var probeFallbackReserve = 0;
      var lastReceipt = null;
      var SAFE_GAP = 10;

      function visible(element) {
        if (!element || element.hidden) return false;
        var style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
      function usable(rect) {
        return Boolean(rect && rect.width > 0 && rect.height > 0);
      }
      function intersectionArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function protectedStageRect() {
        if (!svg) return null;
        var rect = svg.getBoundingClientRect();
        var transform = '';
        try { transform = window.getComputedStyle(svg).transform || ''; } catch (_) {}
        var scaleX = 1;
        var scaleY = 1;
        var translateX = 0;
        var translateY = 0;
        var matrix = transform.match(/^matrix\(([^)]+)\)$/);
        var matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
        if (matrix) {
          var values = matrix[1].split(',').map(Number);
          if (values.length === 6 && values.every(Number.isFinite)) {
            scaleX = Math.abs(values[0]) || 1;
            scaleY = Math.abs(values[3]) || 1;
            translateX = values[4];
            translateY = values[5];
          }
        } else if (matrix3d) {
          var values3d = matrix3d[1].split(',').map(Number);
          if (values3d.length === 16 && values3d.every(Number.isFinite)) {
            scaleX = Math.abs(values3d[0]) || 1;
            scaleY = Math.abs(values3d[5]) || 1;
            translateX = values3d[12];
            translateY = values3d[13];
          }
        }
        var width = rect.width / scaleX;
        var height = rect.height / scaleY;
        var left = rect.left - translateX;
        var top = rect.top - translateY;
        return {
          x: left,
          y: top,
          left: left,
          top: top,
          right: left + width,
          bottom: top + height,
          width: width,
          height: height
        };
      }
      function eligible() {
        return Boolean(
          container && svg && nav &&
          window.innerWidth > 720 &&
          html.getAttribute('data-embed') !== 'true' &&
          (!window.matchMedia || !window.matchMedia('print').matches) &&
          visible(nav)
        );
      }
      function cameraAtBaseline() {
        var scale = Number(svg && svg.getAttribute('data-view-scale'));
        return !Number.isFinite(scale) || Math.abs(scale - 1) < 0.001;
      }
      function writeReserve(next, options) {
        options = options || {};
        next = Math.max(0, Math.ceil(next));
        if (Math.abs(next - reserve) < 1) return false;
        reserve = next;
        if (reserve) {
          if (options.remember !== false) restorableReserve = reserve;
          container.style.setProperty('--archify-nav-reserve', reserve + 'px');
          container.setAttribute('data-nav-stage-rail', 'true');
          html.setAttribute('data-nav-stage-rail', 'true');
        } else {
          container.style.removeProperty('--archify-nav-reserve');
          container.removeAttribute('data-nav-stage-rail');
          html.removeAttribute('data-nav-stage-rail');
        }
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') {
          Archify.readerLayout.schedule();
        }
        if (options.quiet !== true) {
          if (settleFrame) cancelAnimationFrame(settleFrame);
          settleFrame = requestAnimationFrame(function () {
            settleFrame = 0;
            schedule();
          });
        }
        return true;
      }
      function clear(options) {
        options = options || {};
        railLatched = false;
        if (options.preserveBaseline !== true) {
          baselineIntersectionArea = 0;
          baselineStageGap = null;
          restorableReserve = 0;
        }
        writeReserve(0, { quiet: probingBaseline });
        lastReceipt = {
          eligible: false,
          active: false,
          reserve: 0,
          gap: SAFE_GAP,
          baselineStageGap: null,
          stageGap: null,
          stageIntersectionArea: 0,
          baselineIntersectionArea: 0,
          intersectionArea: 0
        };
        return lastReceipt;
      }
      /* When the stage runs below the viewport, the dock lifts to the viewport
         floor so its controls stay reachable while reading. Stage-rail
         decisions and receipts use its resting position, so the lift never
         feeds back into layout. */
      var lift = 0;
      var liftFrame = 0;
      function restingNavRect() {
        var rect = nav.getBoundingClientRect();
        if (!lift) return rect;
        return { x: rect.x, y: rect.y + lift, left: rect.left, right: rect.right, top: rect.top + lift, bottom: rect.bottom + lift, width: rect.width, height: rect.height };
      }
      function updateLift() {
        liftFrame = 0;
        var next = 0;
        if (eligible()) {
          var rest = restingNavRect();
          var box = container.getBoundingClientRect();
          next = Math.round(Math.max(0, Math.min(rest.bottom - (window.innerHeight - 16), rest.top - box.top - 16)));
        }
        if (next === lift) return;
        lift = next;
        if (lift) container.style.setProperty('--archify-dock-lift', lift + 'px');
        else container.style.removeProperty('--archify-dock-lift');
      }
      function scheduleLift() {
        if (!liftFrame) liftFrame = requestAnimationFrame(updateLift);
      }
      function measure() {
        frame = 0;
        scheduleLift();
        if (probingBaseline) return null;
        if (!eligible()) return clear({ preserveBaseline: !cameraAtBaseline() });

        /* Camera transforms enlarge and translate authored paint inside the
           fixed, clipped root SVG viewport. They must not redefine the
           reader's baseline rail.
           Restore that baseline after temporary mobile/embed/print states.
           Camera Reset preserves the established rail while viewport, mode,
           and content changes remain responsible for baseline reprobes. */
        if (!cameraAtBaseline()) {
          if (reserve === 0 && restorableReserve > 0) {
            if (writeReserve(restorableReserve)) return null;
          }
          var cameraNavRect = restingNavRect();
          var cameraLegendRect = visible(legend) ? legend.getBoundingClientRect() : null;
          var cameraStageRect = protectedStageRect();
          var cameraIntersectionArea = usable(cameraLegendRect) && intersectionArea(cameraNavRect, cameraStageRect) > 0
            ? intersectionArea(cameraNavRect, cameraLegendRect)
            : 0;
          lastReceipt = {
            eligible: true,
            active: reserve > 0,
            reserve: reserve,
            gap: SAFE_GAP,
            baselineStageGap: baselineStageGap == null ? null : Math.round(baselineStageGap * 100) / 100,
            stageGap: Math.round((cameraNavRect.top - cameraStageRect.bottom) * 100) / 100,
            stageIntersectionArea: Math.round(intersectionArea(cameraNavRect, cameraStageRect) * 100) / 100,
            baselineIntersectionArea: Math.round(baselineIntersectionArea * 100) / 100,
            intersectionArea: Math.round(cameraIntersectionArea * 100) / 100
          };
          return lastReceipt;
        }

        var navRect = restingNavRect();
        var legendRect = visible(legend) ? legend.getBoundingClientRect() : null;
        var stageRect = protectedStageRect();
        if (!usable(navRect) || !usable(stageRect)) return clear();

        var actualIntersectionArea = usable(legendRect) ? intersectionArea(navRect, legendRect) : 0;
        var stageGap = navRect.top - stageRect.bottom;
        if (!railLatched && reserve === 0) {
          baselineIntersectionArea = actualIntersectionArea;
          baselineStageGap = stageGap;
          if (stageGap < SAFE_GAP) {
            railLatched = true;
            if (writeReserve(Math.max(0, SAFE_GAP - stageGap))) return null;
          }
        } else if (railLatched && reserve > 0 && stageGap < SAFE_GAP) {
          /* Keep the decision latched while Adaptive Reader incorporates the
             rail. Presentation and rounded layout values can require one
             bounded follow-up before the full stage gap is established. */
          var remaining = Math.max(1, SAFE_GAP - stageGap);
          if (writeReserve(reserve + remaining)) return null;
        }

        navRect = restingNavRect();
        legendRect = visible(legend) ? legend.getBoundingClientRect() : null;
        stageRect = protectedStageRect();
        stageGap = navRect.top - stageRect.bottom;
        lastReceipt = {
          eligible: true,
          active: reserve > 0,
          reserve: reserve,
          gap: SAFE_GAP,
          baselineStageGap: baselineStageGap == null ? null : Math.round(baselineStageGap * 100) / 100,
          stageGap: Math.round(stageGap * 100) / 100,
          stageIntersectionArea: Math.round(intersectionArea(navRect, stageRect) * 100) / 100,
          baselineIntersectionArea: Math.round(baselineIntersectionArea * 100) / 100,
          intersectionArea: Math.round((usable(legendRect) ? intersectionArea(navRect, legendRect) : 0) * 100) / 100
        };
        return lastReceipt;
      }
      function reprobe() {
        if (probingBaseline) return probePromise || Promise.resolve(false);
        if (!cameraAtBaseline()) {
          schedule();
          return Promise.resolve(false);
        }
        if (!reserve && !railLatched && !restorableReserve) {
          schedule();
          return Promise.resolve(false);
        }
        probeFallbackReserve = restorableReserve || reserve;
        probingBaseline = true;
        railLatched = false;
        baselineIntersectionArea = 0;
        baselineStageGap = null;
        restorableReserve = 0;
        writeReserve(0, { quiet: true });
        var readerReady = Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function'
          ? Archify.readerLayout.whenStable().catch(function () {})
          : Promise.resolve();
        probePromise = readerReady.then(function () {
          probingBaseline = false;
          probePromise = null;
          if (!cameraAtBaseline() && probeFallbackReserve > 0) {
            restorableReserve = probeFallbackReserve;
          }
          probeFallbackReserve = 0;
          schedule();
          return true;
        });
        return probePromise;
      }
      function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(measure);
      }
      function stableSnapshot() {
        var containerRect = container ? container.getBoundingClientRect() : { width: 0, height: 0 };
        var navRect = nav ? restingNavRect() : { top: 0, left: 0 };
        var legendRect = legend ? legend.getBoundingClientRect() : { top: 0, left: 0 };
        return [
          reserve,
          Math.round(containerRect.width * 100) / 100,
          Math.round(containerRect.height * 100) / 100,
          Math.round(navRect.left * 100) / 100,
          Math.round(navRect.top * 100) / 100,
          Math.round(legendRect.left * 100) / 100,
          Math.round(legendRect.top * 100) / 100,
          railLatched ? 'latched' : 'clear',
          lastReceipt ? lastReceipt.stageGap : ''
        ].join('|');
      }
      function layoutPending() { return Boolean(frame || settleFrame || probingBaseline); }
      function whenStable() {
        return Archify.waitForStableLayout({
          schedule: schedule,
          pending: layoutPending,
          snapshot: stableSnapshot,
          timeoutMessage: 'Viewer chrome layout did not reach stable dimensions.'
        });
      }
      archifyLayoutOwners.viewerChrome = { schedule: schedule, pending: layoutPending, snapshot: stableSnapshot };

      window.addEventListener('resize', reprobe, { passive: true });
      window.addEventListener('scroll', scheduleLift, { passive: true });
      window.addEventListener('load', schedule, { once: true });
      window.addEventListener('beforeprint', schedule);
      window.addEventListener('afterprint', reprobe);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(reprobe).catch(function () {});
      if (typeof ResizeObserver === 'function') {
        var resizeObserver = new ResizeObserver(schedule);
        [nav, svg, legend].forEach(function (element) { if (element) resizeObserver.observe(element); });
      }
      if (typeof MutationObserver === 'function') {
        var contentObserver = new MutationObserver(function (records) {
          // A theme switch changes paint, not the stage geometry. Reprobing
          // drops the bottom rail for several frames and makes the diagram jump.
          var viewerModeChanged = records.some(function (record) {
            return record.target === html && record.attributeName !== 'data-theme';
          });
          if (viewerModeChanged) reprobe();
          else schedule();
        });
        if (legend) contentObserver.observe(legend, { attributes: true, childList: true, subtree: true });
        contentObserver.observe(html, {
          attributes: true,
          attributeFilter: ['data-embed', 'data-present', 'data-preset', 'data-theme']
        });
      }
      schedule();

      return {
        measure: measure,
        schedule: schedule,
        reprobe: reprobe,
        whenStable: whenStable,
        stageRect: protectedStageRect,
        dockRect: function () { return nav ? restingNavRect() : null; },
        active: function () { return reserve > 0; },
        receipt: function () { return lastReceipt || measure(); }
      };
    })();

    Archify.layoutStability = {
      whenStable: function () {
        var reader = archifyLayoutOwners.reader;
        var chrome = archifyLayoutOwners.viewerChrome;
        if (!reader || !chrome) {
          return Promise.reject(new Error('Joint layout owners are unavailable.'));
        }
        var observedFontsReady = document.fonts && document.fonts.ready;
        var fontCyclePending = false;
        var fontGeneration = 0;
        function scheduleOwners() { reader.schedule(); chrome.schedule(); }
        function fontsPending() {
          var fonts = document.fonts;
          var ready = fonts && fonts.ready;
          if (ready && (ready !== observedFontsReady || (fonts.status === 'loading' && !fontCyclePending))) {
            observedFontsReady = ready;
            fontCyclePending = true;
            var generation = ++fontGeneration;
            ready.catch(function () {}).then(function () {
              if (generation !== fontGeneration) return;
              fontCyclePending = false;
              scheduleOwners();
            });
          }
          return fontCyclePending || Boolean(fonts && fonts.status === 'loading');
        }
        return Archify.waitForStableLayout({
          maximumFrames: 960,
          schedule: scheduleOwners,
          pending: function () {
            // Recapture readiness for font cycles that begin during sampling.
            return fontsPending() || reader.pending() || chrome.pending();
          },
          snapshot: function () {
            return JSON.stringify([
              ['reader', reader.snapshot()],
              ['viewerChrome', chrome.snapshot()]
            ]);
          },
          timeoutMessage: 'Joint reader and viewer chrome layout did not reach stable dimensions.'
        });
      }
    };
    Archify.view = (function () {
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var outBtn = container.querySelector('[data-view="out"]');
      var resetBtn = container.querySelector('[data-view="reset"]');
      var resetDetailLabel = resetBtn.querySelector('[data-view-detail]');
      var resetPercentLabel = resetBtn.querySelector('[data-view-percent]');
      var inBtn = container.querySelector('[data-view="in"]');
      var state = { scale: 1, x: 0, y: 0, mode: 'overview' };
      var drag = null;
      var cameraTimer = null;
      var cameraFrame = null;
      var cameraGeneration = 0;
      var cameraTransaction = null;
      var clipFrame = 0;
      var resizeFrame = 0;
      var autoScrollUntil = 0;

      var viewBox = svg.viewBox && svg.viewBox.baseVal;

      function clamp() {
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        state.x = Math.min(0, Math.max(width - width * state.scale, state.x));
        state.y = Math.min(0, Math.max(height - height * state.scale, state.y));
      }
      function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      function contentMetrics() {
        if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return null;
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        var scale = Math.min(width / viewBox.width, height / viewBox.height);
        return {
          width: width,
          height: height,
          scale: scale,
          offsetX: (width - viewBox.width * scale) / 2,
          offsetY: (height - viewBox.height * scale) / 2
        };
      }
      function logicalViewport() {
        var metrics = contentMetrics();
        if (!metrics) return null;
        var x;
        var y;
        var width;
        var height;
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram')) {
          x = viewBox.x + container.scrollLeft / metrics.scale;
          y = viewBox.y;
          width = Math.min(viewBox.width, Math.max(1, container.clientWidth / metrics.scale));
          height = viewBox.height;
        } else {
          x = viewBox.x + ((-state.x / state.scale) - metrics.offsetX) / metrics.scale;
          y = viewBox.y + ((-state.y / state.scale) - metrics.offsetY) / metrics.scale;
          width = Math.min(viewBox.width, metrics.width / state.scale / metrics.scale);
          height = Math.min(viewBox.height, metrics.height / state.scale / metrics.scale);
        }
        width = Math.max(1, Math.min(viewBox.width, width));
        height = Math.max(1, Math.min(viewBox.height, height));
        x = Math.max(viewBox.x, Math.min(viewBox.x + viewBox.width - width, x));
        y = Math.max(viewBox.y, Math.min(viewBox.y + viewBox.height - height, y));
        return { x: x, y: y, width: width, height: height, scale: state.scale };
      }
      function detailLevel() {
        if (state.mode === 'semantic') return 'full';
        if (state.scale >= 1.75) return 'full';
        if (state.scale >= 1) return 'read';
        return 'map';
      }
      function renderControls() {
        var semantic = state.mode === 'semantic' && state.scale > 1.01;
        var detail = detailLevel();
        var percent = Math.round(state.scale * 100) + '%';
        var levelLabel = viewerText('viewer.nav.level.' + detail);
        var detailHint = detail === 'map'
          ? viewerText('viewer.nav.detail.map')
          : detail === 'read'
            ? viewerText('viewer.nav.detail.read')
            : viewerText('viewer.nav.detail.full');
        var resolvedLevel = semantic ? viewerText('viewer.nav.level.auto') : levelLabel;
        var showDetailLevel = semantic || detail !== 'read';
        if (resetDetailLabel) {
          resetDetailLabel.textContent = resolvedLevel;
          resetDetailLabel.hidden = !showDetailLevel;
        }
        if (resetPercentLabel) resetPercentLabel.textContent = percent;
        resetBtn.toggleAttribute('data-detail-visible', showDetailLevel);
        resetBtn.title = viewerText('viewer.nav.camera.title', {
          semantic: semantic ? viewerText('viewer.nav.camera.semantic') : '',
          hint: detailHint
        });
        resetBtn.setAttribute('aria-label', viewerText('viewer.nav.camera', { hint: detailHint }));
        resetBtn.setAttribute('data-detail-level', detail);
        container.setAttribute('data-detail-level', detail);
        container.setAttribute('data-camera-mode', state.mode);
        container.setAttribute('data-camera-indicator', semantic ? 'true' : 'false');
      }
      function clipToViewport(camera) {
        camera = camera || state;
        if (camera.scale <= 1.001) {
          svg.style.removeProperty('clip-path');
          return;
        }
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        var scale = camera.scale;
        var top = Math.max(0, Math.min(height, -camera.y / scale));
        var left = Math.max(0, Math.min(width, -camera.x / scale));
        var right = Math.max(0, Math.min(width, width - (width - camera.x) / scale));
        var bottom = Math.max(0, Math.min(height, height - (height - camera.y) / scale));
        svg.style.clipPath = 'inset(' + [top, right, bottom, left].map(function (value) {
          return Math.round(value * 1000) / 1000 + 'px';
        }).join(' ') + ')';
      }
      function cameraSettled(rendered) {
        return Math.abs(rendered.scale - state.scale) < 0.001 &&
          Math.abs(rendered.x - state.x) < 0.05 &&
          Math.abs(rendered.y - state.y) < 0.05;
      }
      function syncViewportClip() {
        if (clipFrame) cancelAnimationFrame(clipFrame);
        clipFrame = 0;
        function sample() {
          clipFrame = 0;
          var rendered = sampleRenderedState();
          clipToViewport(rendered);
          if (!cameraSettled(rendered)) clipFrame = requestAnimationFrame(sample);
        }
        sample();
      }
      function apply() {
        clamp();
        svg.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
        syncViewportClip();
        renderControls();
        outBtn.disabled = state.scale <= 1;
        inBtn.disabled = state.scale >= 3;
        container.classList.toggle('is-pannable', state.scale > 1);
        svg.setAttribute('data-view-scale', String(state.scale));
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.schedule === 'function') {
          Archify.viewerChromeLayout.schedule();
        }
      }
      function sampleRenderedState() {
        var transform = '';
        try { transform = getComputedStyle(svg).transform || ''; } catch (_) {}
        var match = transform.match(/^matrix\(([^)]+)\)$/);
        if (!match) return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        var values = match[1].split(',').map(Number);
        if (values.length !== 6 || !values.every(Number.isFinite)) {
          return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        }
        return { scale: values[0], x: values[4], y: values[5], mode: state.mode };
      }
      function finishCameraTransaction(transaction, outcome) {
        if (!transaction || transaction.settled) return false;
        transaction.settled = true;
        transaction.state = outcome || 'complete';
        if (transaction.frame) cancelAnimationFrame(transaction.frame);
        if (transaction.timer) clearTimeout(transaction.timer);
        transaction.frame = null;
        transaction.timer = null;
        if (cameraTransaction === transaction) cameraTransaction = null;
        cameraFrame = null;
        cameraTimer = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        transaction.resolve({ id: transaction.id, state: transaction.state });
        return true;
      }
      function cameraReceipt(target, options) {
        var resolver;
        var transaction = {
          id: ++cameraGeneration,
          state: 'running',
          target: target,
          settled: false,
          frame: null,
          timer: null,
          finished: new Promise(function (resolve) { resolver = resolve; }),
          resolve: resolver,
          cancel: function (reason, commitTarget) {
            if (transaction.settled) return false;
            if (commitTarget && transaction.target) {
              if (Object.prototype.hasOwnProperty.call(transaction.target, 'scrollLeft')) {
                container.scrollLeft = transaction.target.scrollLeft;
              } else {
                state = {
                  scale: transaction.target.scale,
                  x: transaction.target.x,
                  y: transaction.target.y,
                  mode: transaction.target.mode
                };
                apply();
              }
            }
            return finishCameraTransaction(transaction, reason || 'cancelled');
          }
        };
        return transaction;
      }
      function stopCameraMotion(reason, commitTarget) {
        if (cameraTransaction && !cameraTransaction.settled) {
          cameraTransaction.cancel(reason || 'cancelled', commitTarget === true);
          return;
        }
        if (cameraTimer) clearTimeout(cameraTimer);
        if (cameraFrame) cancelAnimationFrame(cameraFrame);
        cameraTimer = null;
        cameraFrame = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
      }
      function interruptCamera(reason) {
        var rendered = sampleRenderedState();
        stopCameraMotion(reason || 'manual', false);
        state = rendered;
        state.mode = 'manual';
        apply();
        renderControls();
        if (Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: reason || 'manual' });
        }
      }
      function zoom(next, options) {
        options = options || {};
        if (options.manual !== false) interruptCamera();
        var previous = state.scale;
        next = Math.max(1, Math.min(3, Math.round(next * 4) / 4));
        if (next === previous) return;
        var centerX = (svg.clientWidth || 1) / 2;
        var centerY = (svg.clientHeight || 1) / 2;
        var contentX = (centerX - state.x) / previous;
        var contentY = (centerY - state.y) / previous;
        state.scale = next;
        state.x = centerX - contentX * next;
        state.y = centerY - contentY * next;
        apply();
      }
      function reset(options) {
        options = options || {};
        if (options.automatic !== true) interruptCamera();
        else stopCameraMotion('reset', false);
        state = { scale: 1, x: 0, y: 0, mode: 'overview' };
        apply();
      }
      function centerAt(logicalX, logicalY, options) {
        options = options || {};
        logicalX = Number(logicalX);
        logicalY = Number(logicalY);
        var metrics = contentMetrics();
        if (!metrics || !Number.isFinite(logicalX) || !Number.isFinite(logicalY)) return false;
        interruptCamera();
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram')) {
          state.scale = 1;
          state.x = 0;
          state.y = 0;
          state.mode = 'manual';
          apply();
          var mobileTarget = (logicalX - viewBox.x) * metrics.scale - container.clientWidth / 2;
          mobileTarget = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, mobileTarget));
          autoScrollUntil = Date.now() + 80;
          try { container.scrollTo({ left: mobileTarget, behavior: options.instant ? 'auto' : 'smooth' }); }
          catch (_) { container.scrollLeft = mobileTarget; }
          return true;
        }
        var minimumScale = Math.max(1, Math.min(3, Number(options.minimumScale) || 1));
        var requestedScale = Number(options.scale);
        state.scale = Math.max(minimumScale, Math.min(3, Number.isFinite(requestedScale) ? requestedScale : state.scale));
        var contentX = metrics.offsetX + (logicalX - viewBox.x) * metrics.scale;
        var contentY = metrics.offsetY + (logicalY - viewBox.y) * metrics.scale;
        state.x = metrics.width / 2 - contentX * state.scale;
        state.y = metrics.height / 2 - contentY * state.scale;
        state.mode = 'manual';
        apply();
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        return true;
      }
      function semanticIds(ids, includeNeighbors) {
        var seeds = Object.create(null);
        var wanted = Object.create(null);
        (ids || []).forEach(function (id) { seeds[id] = true; wanted[id] = true; });
        if (includeNeighbors) {
          Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
            var from = edge.getAttribute('data-edge-from');
            var to = edge.getAttribute('data-edge-to');
            if (seeds[from] || seeds[to]) { wanted[from] = true; wanted[to] = true; }
          });
        }
        return wanted;
      }
      function boxesFor(ids, includeNeighbors) {
        var wanted = semanticIds(ids, includeNeighbors);
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'))
          .filter(function (node) { return wanted[node.getAttribute('data-node-id')]; })
          .map(function (node) {
            try { return node.getBBox(); } catch (_) { return null; }
          })
          .filter(Boolean);
      }
      function frameDesktop(ids, options) {
        options = options || {};
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0 || viewBox.height <= 0) return false;
        var svgWidth = svg.clientWidth || 1;
        var svgHeight = svg.clientHeight || 1;
        var contentScale = Math.min(svgWidth / viewBox.width, svgHeight / viewBox.height);
        var contentOffsetX = (svgWidth - viewBox.width * contentScale) / 2;
        var contentOffsetY = (svgHeight - viewBox.height * contentScale) / 2;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var minY = Math.min.apply(Math, boxes.map(function (box) { return box.y; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var maxY = Math.max.apply(Math, boxes.map(function (box) { return box.y + box.height; }));
        var bounds = {
          x: contentOffsetX + (minX - viewBox.x) * contentScale,
          y: contentOffsetY + (minY - viewBox.y) * contentScale,
          width: Math.max(1, (maxX - minX) * contentScale),
          height: Math.max(1, (maxY - minY) * contentScale)
        };
        var padding = options.padding || 48;
        var left = padding;
        var right = svgWidth - padding;
        var top = padding;
        var bottom = svgHeight - Math.max(padding, 72);
        var containerRect = container.getBoundingClientRect();
        var visibleTop = Math.max(0, -containerRect.top);
        var visibleBottom = Math.min(svgHeight, window.innerHeight - containerRect.top);
        if (visibleBottom - visibleTop >= 240) {
          top = Math.max(top, visibleTop + padding);
          bottom = Math.min(bottom, visibleBottom - Math.max(padding, 72));
        }
        var chip = document.getElementById('focus-chip');
        if (chip && !chip.hidden) {
          var lensEnd = chip.offsetLeft + chip.offsetWidth + 24 - (svg.offsetLeft || 0);
          left = Math.max(left, Math.min(svgWidth * 0.42, lensEnd));
        }
        var routeReceipt = document.getElementById('route-probe');
        if (routeReceipt && !routeReceipt.hidden && routeReceipt.hasAttribute('data-route-journey')) {
          var receiptTop = routeReceipt.offsetTop;
          var receiptBottom = receiptTop + routeReceipt.offsetHeight;
          if (receiptTop < svgHeight / 2) top = Math.max(top, receiptBottom + 24);
          else bottom = Math.min(bottom, receiptTop - 24);
        }
        if (right <= left || bottom <= top) return false;
        var maxScale = options.maxScale || (options.includeNeighbors ? 1.9 : 2.15);
        var targetScale = Math.min((right - left) / bounds.width, (bottom - top) / bounds.height) * 0.9;
        targetScale = Math.max(1, Math.min(maxScale, targetScale));
        if (targetScale < 1.08) targetScale = 1;
        var target = {
          scale: Math.round(targetScale * 100) / 100,
          x: 0,
          y: 0,
          mode: 'semantic'
        };
        target.x = (left + right) / 2 - (bounds.x + bounds.width / 2) * target.scale;
        target.y = (top + bottom) / 2 - (bounds.y + bounds.height / 2) * target.scale;
        var start = sampleRenderedState();
        stopCameraMotion('replaced', false);
        var transaction = cameraReceipt(target, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        if (instant) {
          state = target;
          apply();
          finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
          return transaction;
        }
        var duration = Math.max(180, Math.min(520, Number(options.duration) || 420));
        var startedAt = 0;
        state = start;
        state.mode = 'semantic';
        apply();
        container.classList.add('is-camera-moving');
        container.classList.add('is-camera-transaction');
        container.setAttribute('data-camera-transaction', String(transaction.id));
        var step = function (timestamp) {
          if (cameraTransaction !== transaction || transaction.settled) return;
          if (!startedAt) startedAt = timestamp;
          var fraction = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
          var eased = 1 - Math.pow(1 - fraction, 3);
          state = {
            scale: start.scale + (target.scale - start.scale) * eased,
            x: start.x + (target.x - start.x) * eased,
            y: start.y + (target.y - start.y) * eased,
            mode: 'semantic'
          };
          apply();
          if (fraction < 1) {
            transaction.frame = requestAnimationFrame(step);
            cameraFrame = transaction.frame;
          } else {
            state = target;
            apply();
            finishCameraTransaction(transaction, 'complete');
          }
        };
        transaction.frame = requestAnimationFrame(step);
        cameraFrame = transaction.frame;
        return transaction;
      }
      function reveal(ids, options) {
        options = options || {};
        if (window.innerWidth > 720) return frameDesktop(ids, options);
        stopCameraMotion('replaced', false);
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        state.mode = 'semantic';
        apply();
        if (!container.hasAttribute('data-wide-diagram')) {
          var contained = cameraReceipt({ scale: 1, x: 0, y: 0, mode: 'semantic' }, options);
          cameraTransaction = contained;
          finishCameraTransaction(contained, 'complete');
          return contained;
        }
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0) return false;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var center = (((minX + maxX) / 2 - viewBox.x) / viewBox.width) * (svg.clientWidth || 1);
        var target = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, center - container.clientWidth / 2));
        var transaction = cameraReceipt({ scrollLeft: target }, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        autoScrollUntil = Date.now() + (instant ? 50 : 470);
        try { container.scrollTo({ left: target, behavior: instant ? 'auto' : 'smooth' }); }
        catch (_) { container.scrollLeft = target; }
        if (instant) finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
        else {
          transaction.timer = setTimeout(function () { finishCameraTransaction(transaction, 'complete'); }, 460);
          cameraTimer = transaction.timer;
          container.classList.add('is-camera-moving');
          container.setAttribute('data-camera-transaction', String(transaction.id));
        }
        return transaction;
      }
      function syncSemantic() {
        var active = Archify.focus && typeof Archify.focus.active === 'function' ? Archify.focus.active() : null;
        if (typeof active === 'string') return reveal([active], { includeNeighbors: true, reason: 'focus-sync' });
        if (Array.isArray(active) && active.length) return reveal(active, { reason: 'selection-sync' });
        return false;
      }
      function pinControls() {
        container.style.setProperty('--archify-scroll-x', container.scrollLeft + 'px');
      }
      function onScroll() {
        pinControls();
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram') && Date.now() > autoScrollUntil) {
          interruptCamera();
        }
      }
      function onPointerEnd(event) {
        if (!drag) return;
        var moved = drag.moved;
        drag = null;
        container.classList.remove('is-panning');
        try { container.releasePointerCapture(event.pointerId); } catch (_) {}
        if (moved) {
          container.setAttribute('data-just-panned', 'true');
          setTimeout(function () { container.removeAttribute('data-just-panned'); }, 80);
        }
      }

      inBtn.addEventListener('click', function () { zoom(state.scale + 0.25); });
      outBtn.addEventListener('click', function () { zoom(state.scale - 0.25); });
      resetBtn.addEventListener('click', reset);
      container.addEventListener('pointerdown', function (event) {
        if (state.scale <= 1 || event.button !== 0 || event.target.closest('.diagram-nav, .focus-chip, .node-finder, .diagram-guide, .overview-map, .route-probe, .semantic-lens') || event.target.closest('[data-node-id]') || event.target.closest('[data-relationship-hit-key]')) return;
        interruptCamera();
        drag = { startX: event.clientX, startY: event.clientY, x: state.x, y: state.y, moved: false };
        container.classList.add('is-panning');
        try { container.setPointerCapture(event.pointerId); } catch (_) {}
      });
      container.addEventListener('pointermove', function (event) {
        if (!drag) return;
        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        state.x = drag.x + dx;
        state.y = drag.y + dy;
        apply();
      });
      container.addEventListener('pointerup', onPointerEnd);
      container.addEventListener('pointercancel', onPointerEnd);
      container.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', function () {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(function () {
          resizeFrame = 0;
          if (state.mode === 'semantic') syncSemantic();
          else apply();
        });
      });
      window.addEventListener('hashchange', function () { requestAnimationFrame(syncSemantic); });
      apply();
      pinControls();
      requestAnimationFrame(syncSemantic);

      return {
        zoomIn: function () { zoom(state.scale + 0.25); },
        zoomOut: function () { zoom(state.scale - 0.25); },
        reset: reset,
        reveal: reveal,
        centerAt: centerAt,
        logicalViewport: logicalViewport,
        sync: syncSemantic,
        state: function () { return { scale: state.scale, x: state.x, y: state.y, mode: state.mode }; }
      };
    })();

    /* ============================================================
       Semantic Radar — simplified semantic bounds + live viewport.
       The radar is built at runtime so the checked artifact still contains
       one canonical SVG block, and export serialization remains untouched.
       ============================================================ */
    Archify.radar = (function () {
      var container = document.querySelector('.diagram-container');
      var diagram = container.querySelector(':scope > svg');
      var panel = document.getElementById('overview-map');
      var panelHead = panel.querySelector('.overview-map-head');
      var surface = document.getElementById('overview-map-surface');
      var status = document.getElementById('overview-map-status');
      var trigger = document.getElementById('btn-overview-map');
      var closeBtn = document.getElementById('overview-map-close');
      var expandBtn = document.getElementById('overview-map-expand');
      var feedback = document.getElementById('overview-map-feedback');
      var navigation = container.querySelector('.diagram-nav');
      var passport = document.getElementById('focus-chip');
      var namespace = 'http://www.w3.org/2000/svg';
      var viewBox = diagram.viewBox && diagram.viewBox.baseVal;
      var mapSvg = document.createElementNS(namespace, 'svg');
      var nodeLayer = document.createElementNS(namespace, 'g');
      var viewport = document.createElementNS(namespace, 'rect');
      var nodes = [];
      var viewportDrag = null;
      var panelDrag = null;
      var manualPosition = null;
      var lastPlacement = null;
      var requestedOpen = false;
      var passportYielded = false;
      var passportPreviousAriaHidden = null;
      var syncFrame = 0;
      var spaceRetryTimer = 0;
      var spaceRetryCount = 0;
      var placementGap = 16;

      mapSvg.setAttribute('role', 'group');
      mapSvg.setAttribute('aria-label', viewerText('viewer.radar.nodes'));
      mapSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      nodeLayer.setAttribute('class', 'overview-map-nodes');
      viewport.setAttribute('class', 'overview-map-viewport');
      viewport.setAttribute('rx', '3');
      viewport.setAttribute('ry', '3');
      mapSvg.appendChild(nodeLayer);
      mapSvg.appendChild(viewport);
      surface.appendChild(mapSvg);

      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function build() {
        if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return false;
        mapSvg.setAttribute('viewBox', [viewBox.x, viewBox.y, viewBox.width, viewBox.height].join(' '));
        nodeLayer.textContent = '';
        nodes = [];
        Array.prototype.forEach.call(diagram.querySelectorAll('[data-node-id]'), function (node) {
          var box;
          try { box = node.getBBox(); } catch (_) { box = null; }
          if (!box || box.width <= 0 || box.height <= 0) return;
          var id = node.getAttribute('data-node-id');
          var rect = document.createElementNS(namespace, 'rect');
          rect.setAttribute('class', 'overview-map-node');
          rect.setAttribute('x', String(box.x));
          rect.setAttribute('y', String(box.y));
          rect.setAttribute('width', String(Math.max(3, box.width)));
          rect.setAttribute('height', String(Math.max(3, box.height)));
          rect.setAttribute('rx', String(Math.max(2, Math.min(8, Math.min(box.width, box.height) * 0.1))));
          rect.setAttribute('data-radar-node-id', id);
          rect.setAttribute('data-kind', node.getAttribute('data-node-kind') || 'neutral');
          rect.setAttribute('tabindex', '0');
          rect.setAttribute('role', 'button');
          rect.setAttribute('aria-label', viewerText('viewer.radar.focus', { label: nodeLabel(node, id) }));
          nodeLayer.appendChild(rect);
          nodes.push({ id: id, node: node, rect: rect });
        });
        status.textContent = viewerText('viewer.radar.fullMap', { count: nodes.length });
        return true;
      }
      function visibleRect(element) {
        if (!element || element.hidden) return null;
        var rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null;
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      }
      function panelRectAt(position) {
        return {
          left: position.left,
          top: position.top,
          right: position.left + panel.offsetWidth,
          bottom: position.top + panel.offsetHeight,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        };
      }
      function rectsIntersect(first, second, gap) {
        gap = Number(gap) || 0;
        return first.left < second.right + gap &&
          first.right > second.left - gap &&
          first.top < second.bottom + gap &&
          first.bottom > second.top - gap;
      }
      function intersectionArea(first, second) {
        var width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
        var height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
        return width * height;
      }
      function clamp(value, minimum, maximum) {
        if (maximum < minimum) return minimum;
        return Math.max(minimum, Math.min(maximum, value));
      }
      function placementContext() {
        var containerRect = visibleRect(container);
        if (!containerRect) return null;
        var controlRect = visibleRect(navigation);
        var left = Math.max(placementGap, containerRect.left + placementGap);
        var top = Math.max(placementGap, containerRect.top + placementGap);
        var right = Math.min(window.innerWidth - placementGap, containerRect.right - placementGap);
        var bottom = Math.min(window.innerHeight - placementGap, containerRect.bottom - placementGap);
        if (controlRect) bottom = Math.min(bottom, controlRect.top - placementGap);
        var lens = document.getElementById('focus-chip');
        var lensRect = visibleRect(lens);
        var legendRect = visibleRect(diagram.querySelector('[data-legend]'));
        var active = diagram.querySelector('[data-focus-selected]');
        var activeRect = visibleRect(active);
        return {
          bounds: { left: left, top: top, right: right, bottom: bottom },
          hardBlockers: [lensRect, controlRect, legendRect].filter(Boolean),
          softBlockers: [activeRect].filter(Boolean),
          preferredSide: !activeRect || activeRect.left + activeRect.width / 2 > window.innerWidth / 2 ? 'left' : 'right'
        };
      }
      function positionIsValid(position, context) {
        if (!position || !context) return false;
        var rect = panelRectAt(position);
        var bounds = context.bounds;
        if (rect.left < bounds.left || rect.top < bounds.top || rect.right > bounds.right || rect.bottom > bounds.bottom) return false;
        return context.hardBlockers.every(function (blocker) { return !rectsIntersect(rect, blocker, placementGap); });
      }
      function cornerCandidates(context) {
        var bounds = context.bounds;
        var left = bounds.left;
        var right = Math.max(left, bounds.right - panel.offsetWidth);
        var top = bounds.top;
        var bottom = Math.max(top, bounds.bottom - panel.offsetHeight);
        var preferredLeft = context.preferredSide === 'left' ? left : right;
        var alternateLeft = context.preferredSide === 'left' ? right : left;
        return [
          { left: preferredLeft, top: bottom },
          { left: alternateLeft, top: bottom },
          { left: preferredLeft, top: top },
          { left: alternateLeft, top: top }
        ].filter(function (candidate, index, all) {
          return all.findIndex(function (other) { return other.left === candidate.left && other.top === candidate.top; }) === index;
        });
      }
      function nearbyCandidates(context, reference) {
        var bounds = context.bounds;
        var maximumLeft = bounds.right - panel.offsetWidth;
        var maximumTop = bounds.bottom - panel.offsetHeight;
        var requested = reference ? {
          left: clamp(reference.left, bounds.left, maximumLeft),
          top: clamp(reference.top, bounds.top, maximumTop)
        } : null;
        var horizontal = [bounds.left, maximumLeft];
        var vertical = [bounds.top, maximumTop];
        if (requested) {
          horizontal.push(requested.left);
          vertical.push(requested.top);
        }
        context.hardBlockers.forEach(function (blocker) {
          horizontal.push(
            blocker.left - placementGap - panel.offsetWidth,
            blocker.right + placementGap
          );
          vertical.push(
            blocker.top - placementGap - panel.offsetHeight,
            blocker.bottom + placementGap
          );
        });
        horizontal = horizontal.map(function (left) { return clamp(left, bounds.left, maximumLeft); });
        vertical = vertical.map(function (top) { return clamp(top, bounds.top, maximumTop); });
        var candidates = [];
        horizontal.forEach(function (left) {
          vertical.forEach(function (top) { candidates.push({ left: left, top: top }); });
        });
        return candidates.filter(function (candidate, index, all) {
          return all.findIndex(function (other) { return other.left === candidate.left && other.top === candidate.top; }) === index;
        });
      }
      function placementScore(position, context, reference, softWeight) {
        var rect = panelRectAt(position);
        var referenceLeft = reference ? reference.left : (context.preferredSide === 'left' ? context.bounds.left : context.bounds.right - panel.offsetWidth);
        var referenceTop = reference ? reference.top : context.bounds.bottom - panel.offsetHeight;
        var distance = Math.pow(position.left - referenceLeft, 2) + Math.pow(position.top - referenceTop, 2);
        var softOverlap = context.softBlockers.reduce(function (total, blocker) { return total + intersectionArea(rect, blocker); }, 0);
        return distance + softOverlap * softWeight;
      }
      function chooseRadarPlacement(context, reference, options) {
        options = options || {};
        var softWeight = Number.isFinite(options.softWeight) ? options.softWeight : 100;
        var candidates = nearbyCandidates(context, reference).concat(cornerCandidates(context));
        var valid = candidates.filter(function (candidate) { return positionIsValid(candidate, context); });
        valid.sort(function (first, second) {
          return placementScore(first, context, reference, softWeight) - placementScore(second, context, reference, softWeight);
        });
        return valid.length ? valid[0] : null;
      }
      function applyPlacement(position, remember) {
        var useLeft = position.left + panel.offsetWidth / 2 <= window.innerWidth / 2;
        panel.setAttribute('data-docked', 'true');
        panel.setAttribute('data-dock-side', useLeft ? 'left' : 'right');
        if (useLeft) {
          panel.style.setProperty('--archify-radar-left', Math.round(position.left) + 'px');
          panel.style.removeProperty('--archify-radar-right');
        } else {
          panel.style.setProperty('--archify-radar-right', Math.round(window.innerWidth - position.left - panel.offsetWidth) + 'px');
          panel.style.removeProperty('--archify-radar-left');
        }
        panel.style.setProperty('--archify-radar-top', Math.round(position.top) + 'px');
        if (remember !== false) lastPlacement = { left: position.left, top: position.top };
      }
      function resetDockingStyles() {
        panel.removeAttribute('data-docked');
        panel.removeAttribute('data-dock-side');
        panel.removeAttribute('data-panel-dragging');
        panel.removeAttribute('data-placement-invalid');
        panel.removeAttribute('data-placement-degraded');
        panel.removeAttribute('data-placement-unavailable');
        panel.removeAttribute('data-compact');
        panel.removeAttribute('title');
        panel.style.removeProperty('visibility');
        panel.style.removeProperty('--archify-radar-right');
        panel.style.removeProperty('--archify-radar-left');
        panel.style.removeProperty('--archify-radar-top');
      }
      function updateDocking() {
        var options = arguments[0] || {};
        if (panel.hidden) return false;
        if (panelDrag) return true;
        panel.removeAttribute('data-compact');
        panel.removeAttribute('data-placement-degraded');
        panel.removeAttribute('data-placement-invalid');
        panel.removeAttribute('data-placement-unavailable');
        panel.removeAttribute('title');
        panel.style.removeProperty('visibility');
        var context = placementContext();
        if (!context) {
          resetDockingStyles();
          return false;
        }
        var reference = manualPosition || lastPlacement;
        var placementOptions = { softWeight: manualPosition ? 0 : 100 };
        var placement = manualPosition && positionIsValid(manualPosition, context)
          ? manualPosition
          : chooseRadarPlacement(context, reference, placementOptions);
        var compact = false;
        if (!placement && options.allowCompact !== false) {
          compact = true;
          panel.setAttribute('data-compact', 'true');
          panel.setAttribute('data-placement-degraded', 'true');
          panel.setAttribute('title', viewerText('viewer.radar.compacted'));
          context = placementContext();
          placement = chooseRadarPlacement(context, reference, placementOptions);
        }
        if (!placement) {
          resetDockingStyles();
          panel.setAttribute('data-placement-unavailable', 'true');
          return false;
        }
        if (manualPosition && !compact) manualPosition = { left: placement.left, top: placement.top };
        applyPlacement(placement, true);
        return true;
      }
      function clearSpaceRetry() {
        if (spaceRetryTimer) window.clearTimeout(spaceRetryTimer);
        spaceRetryTimer = 0;
      }
      function yieldPassport() {
        if (!passport || passport.hidden || passportYielded) return passportYielded;
        passportPreviousAriaHidden = passport.getAttribute('aria-hidden');
        passportYielded = true;
        passport.setAttribute('data-radar-yielded', 'true');
        passport.setAttribute('aria-hidden', 'true');
        return true;
      }
      function restorePassport() {
        if (!passport || !passportYielded) return;
        passportYielded = false;
        passport.removeAttribute('data-radar-yielded');
        if (passportPreviousAriaHidden === null) passport.removeAttribute('aria-hidden');
        else passport.setAttribute('aria-hidden', passportPreviousAriaHidden);
        passportPreviousAriaHidden = null;
      }
      function reflectVisible() {
        panel.hidden = false;
        panel.removeAttribute('data-placement-unavailable');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.removeAttribute('data-radar-space-limited');
        trigger.setAttribute('aria-label', viewerText('viewer.radar.close'));
        trigger.title = viewerText('viewer.nav.radar.title');
        feedback.hidden = true;
      }
      function scheduleSpaceRetry() {
        if (!requestedOpen || spaceRetryTimer || spaceRetryCount >= 4) return;
        spaceRetryCount += 1;
        spaceRetryTimer = window.setTimeout(function () {
          spaceRetryTimer = 0;
          attemptRequestedOpen();
        }, 60);
      }
      function reflectUnavailable() {
        restorePassport();
        panel.hidden = true;
        panel.setAttribute('data-placement-unavailable', 'true');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', viewerText('viewer.radar.cancelWaiting'));
        trigger.setAttribute('data-radar-space-limited', 'true');
        trigger.title = viewerText('viewer.radar.needsSpace');
        feedback.hidden = false;
        scheduleSpaceRetry();
      }
      function attemptRequestedOpen(options) {
        options = options || {};
        if (!requestedOpen) return false;
        panel.hidden = false;
        if (!updateDocking(options)) {
          reflectUnavailable();
          return false;
        }
        clearSpaceRetry();
        spaceRetryCount = 0;
        reflectVisible();
        sync();
        if (options.focus === true && !panel.hasAttribute('data-compact')) surface.focus();
        return true;
      }
      function expandCompactRadar() {
        if (!requestedOpen || panel.hidden || !panel.hasAttribute('data-compact')) return false;
        yieldPassport();
        if (!updateDocking({ allowCompact: false })) {
          restorePassport();
          if (!updateDocking()) {
            reflectUnavailable();
            return false;
          }
        }
        reflectVisible();
        sync();
        if (!panel.hasAttribute('data-compact')) surface.focus();
        return !panel.hasAttribute('data-compact');
      }
      function syncNow() {
        syncFrame = 0;
        if (panel.hidden || !Archify.view || typeof Archify.view.logicalViewport !== 'function') return;
        if (!updateDocking()) {
          reflectUnavailable();
          return;
        }
        if (passportYielded && panel.hasAttribute('data-compact')) {
          restorePassport();
          if (!updateDocking()) {
            reflectUnavailable();
            return;
          }
        }
        reflectVisible();
        var visible = Archify.view.logicalViewport();
        if (!visible) return;
        viewport.setAttribute('x', String(visible.x));
        viewport.setAttribute('y', String(visible.y));
        viewport.setAttribute('width', String(visible.width));
        viewport.setAttribute('height', String(visible.height));
        var full = visible.width >= viewBox.width * 0.98 && visible.height >= viewBox.height * 0.98;
        var mobileWide = window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram');
        var viewportCopy = full
          ? viewerText('viewer.radar.viewport.full')
          : (mobileWide
            ? viewerText('viewer.radar.viewport.width', { percent: Math.round(visible.width / viewBox.width * 100) })
            : viewerText('viewer.radar.viewport.scale', { percent: Math.round(visible.scale * 100) }));
        status.textContent = viewerText('viewer.radar.status', { count: nodes.length, viewport: viewportCopy });
        nodes.forEach(function (item) {
          var active = item.node.hasAttribute('data-focus-selected');
          if (active) item.rect.setAttribute('data-radar-active', 'true');
          else item.rect.removeAttribute('data-radar-active');
        });
      }
      function sync() {
        if (requestedOpen && panel.hidden) {
          attemptRequestedOpen();
          return;
        }
        if (syncFrame) return;
        syncFrame = requestAnimationFrame(syncNow);
      }
      function setOpen(next, options) {
        options = options || {};
        next = Boolean(next);
        if (next && Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (next && Archify.semanticLens && Archify.semanticLens.isOpen()) {
          Archify.semanticLens.close({ restoreFocus: false });
        }
        requestedOpen = next;
        if (next) {
          clearSpaceRetry();
          spaceRetryCount = 0;
          trigger.setAttribute('data-radar-requested', 'true');
          build();
          attemptRequestedOpen(options);
        } else {
          clearSpaceRetry();
          spaceRetryCount = 0;
          viewportDrag = null;
          panelDrag = null;
          container.classList.remove('is-panning');
          panel.hidden = true;
          resetDockingStyles();
          restorePassport();
          feedback.hidden = true;
          // Focus before collapsing: the dock hides this trigger at 100% unless it holds focus.
          if (options.restoreFocus === true) trigger.focus();
          trigger.setAttribute('aria-expanded', 'false');
          trigger.removeAttribute('data-radar-requested');
          trigger.removeAttribute('data-radar-space-limited');
          trigger.setAttribute('aria-label', viewerText('viewer.nav.radar'));
          trigger.title = viewerText('viewer.nav.radar.title');
        }
        return next;
      }
      function toggle() { return setOpen(!requestedOpen, { focus: false }); }
      function close(options) { return setOpen(false, options); }
      function bringNodeIntoWindow(node) {
        var delay = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 540;
        window.setTimeout(function () {
          var rect = node.getBoundingClientRect();
          var safeTop = 64;
          var safeBottom = window.innerHeight - 64;
          if (rect.top >= safeTop && rect.bottom <= safeBottom) return;
          var top = Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2);
          try { window.scrollTo({ top: top, behavior: delay ? 'smooth' : 'auto' }); }
          catch (_) { window.scrollTo(0, top); }
        }, delay);
      }
      function focusNode(id) {
        var main = diagram.querySelector('[data-node-id="' + id + '"]');
        if (!main) return false;
        if (Archify.focus && typeof Archify.focus.set === 'function') {
          Archify.focus.set(id, { toggle: false });
        }
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'radar' });
        }
        bringNodeIntoWindow(main);
        try { main.focus({ preventScroll: true }); } catch (_) { try { main.focus(); } catch (_) {} }
        sync();
        return true;
      }
      function diagramPoint(event) {
        var matrix = mapSvg.getScreenCTM();
        if (!matrix) return null;
        var point = mapSvg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(matrix.inverse());
      }
      function navigate(event) {
        var point = diagramPoint(event);
        if (!point || !Archify.view || typeof Archify.view.centerAt !== 'function') return;
        Archify.view.centerAt(point.x, point.y, { minimumScale: 1.5, instant: true });
        sync();
      }
      function endViewportDrag(event) {
        if (!viewportDrag) return;
        viewportDrag = null;
        panel.removeAttribute('data-dragging');
        container.classList.remove('is-panning');
        try { surface.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      function beginPanelDrag(event) {
        if (event.button !== 0 || event.target.closest('button, a, input, [role="button"]')) return;
        var context = placementContext();
        if (!context) return;
        var rect = panel.getBoundingClientRect();
        event.preventDefault();
        event.stopPropagation();
        panelDrag = {
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          start: { left: rect.left, top: rect.top },
          current: { left: rect.left, top: rect.top },
          previousManual: manualPosition ? { left: manualPosition.left, top: manualPosition.top } : null
        };
        panel.setAttribute('data-panel-dragging', 'true');
        try { panelHead.setPointerCapture(event.pointerId); } catch (_) {}
      }
      function movePanelDrag(event) {
        if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
        var context = placementContext();
        if (!context) return;
        event.preventDefault();
        event.stopPropagation();
        var bounds = context.bounds;
        var position = {
          left: clamp(panelDrag.start.left + event.clientX - panelDrag.originX, bounds.left, bounds.right - panel.offsetWidth),
          top: clamp(panelDrag.start.top + event.clientY - panelDrag.originY, bounds.top, bounds.bottom - panel.offsetHeight)
        };
        panelDrag.current = position;
        if (positionIsValid(position, context)) panel.removeAttribute('data-placement-invalid');
        else panel.setAttribute('data-placement-invalid', 'true');
        applyPlacement(position, false);
      }
      function finishPanelDrag(event, cancel) {
        if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        var activeDrag = panelDrag;
        panelDrag = null;
        panel.removeAttribute('data-panel-dragging');
        panel.removeAttribute('data-placement-invalid');
        try { panelHead.releasePointerCapture(event.pointerId); } catch (_) {}
        var context = placementContext();
        if (!context) return;
        if (cancel) {
          manualPosition = activeDrag.previousManual;
          lastPlacement = { left: activeDrag.start.left, top: activeDrag.start.top };
          updateDocking();
          return;
        }
        var requested = activeDrag.current;
        manualPosition = { left: requested.left, top: requested.top };
        updateDocking();
      }

      trigger.addEventListener('click', toggle);
      closeBtn.addEventListener('click', function () { close({ restoreFocus: true }); });
      expandBtn.addEventListener('click', expandCompactRadar);
      panelHead.addEventListener('pointerdown', beginPanelDrag);
      panelHead.addEventListener('pointermove', movePanelDrag);
      panelHead.addEventListener('pointerup', function (event) { finishPanelDrag(event, false); });
      panelHead.addEventListener('pointercancel', function (event) { finishPanelDrag(event, true); });
      surface.addEventListener('pointerdown', function (event) {
        if (event.button !== 0 || event.target.closest('[data-radar-node-id]')) return;
        event.preventDefault();
        viewportDrag = { pointerId: event.pointerId };
        panel.setAttribute('data-dragging', 'true');
        container.classList.add('is-panning');
        try { surface.setPointerCapture(event.pointerId); } catch (_) {}
        navigate(event);
      });
      surface.addEventListener('pointermove', function (event) {
        if (!viewportDrag || viewportDrag.pointerId !== event.pointerId) return;
        navigate(event);
      });
      surface.addEventListener('pointerup', endViewportDrag);
      surface.addEventListener('pointercancel', endViewportDrag);
      surface.addEventListener('click', function (event) {
        var node = event.target.closest('[data-radar-node-id]');
        if (node) focusNode(node.getAttribute('data-radar-node-id'));
      });
      surface.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close({ restoreFocus: true });
          return;
        }
        var node = event.target.closest('[data-radar-node-id]');
        if (node && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          focusNode(node.getAttribute('data-radar-node-id'));
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        var visible = Archify.view && Archify.view.logicalViewport ? Archify.view.logicalViewport() : null;
        if (!visible) return;
        event.preventDefault();
        var x = visible.x + visible.width / 2;
        var y = visible.y + visible.height / 2;
        var stepX = Math.max(12, visible.width * 0.24);
        var stepY = Math.max(12, visible.height * 0.24);
        if (event.key === 'ArrowLeft') x -= stepX;
        else if (event.key === 'ArrowRight') x += stepX;
        else if (event.key === 'ArrowUp') y -= stepY;
        else y += stepY;
        Archify.view.centerAt(x, y, { minimumScale: 1.5, instant: true });
        sync();
      });
      document.addEventListener('keydown', function (event) {
        if (!panelDrag || event.key !== 'Escape') return;
        finishPanelDrag({
          pointerId: panelDrag.pointerId,
          preventDefault: function () { event.preventDefault(); },
          stopPropagation: function () { event.stopPropagation(); }
        }, true);
      }, true);
      function reflow() {
        if (!requestedOpen) return;
        clearSpaceRetry();
        spaceRetryCount = 0;
        sync();
      }
      window.addEventListener('resize', reflow);
      window.addEventListener('scroll', reflow, { passive: true });
      if (typeof ResizeObserver === 'function') {
        var radarResizeObserver = new ResizeObserver(function (entries) {
          if (!requestedOpen) return;
          if (panel.hidden && entries.every(function (entry) { return entry.target === panel; })) return;
          reflow();
        });
        [container, navigation, document.getElementById('focus-chip'), panel].filter(Boolean).forEach(function (element) {
          radarResizeObserver.observe(element);
        });
      }
      requestAnimationFrame(build);

      return {
        open: function () { return setOpen(true); },
        close: close,
        toggle: toggle,
        sync: sync,
        focus: focusNode,
        isOpen: function () { return requestedOpen; },
        count: function () { return nodes.length; }
      };
    })();

    /* ============================================================
       Presentation Stage — a shareable, viewport-filling live view.
       It changes only HTML layout and URL state; SVG semantics and export
       serialization remain untouched. Escape first clears an active
       focus, then exits the stage.
       ============================================================ */
    Archify.presentation = (function () {
      var html = document.documentElement;
      var btn = document.getElementById('btn-present');
      var label = document.getElementById('present-label');
      var previousScrollY = 0;

      function active() { return html.getAttribute('data-present') === 'true'; }

      function updateUrl(next) {
        try {
          var url = new URL(window.location.href);
          if (next) url.searchParams.set('present', '1');
          else url.searchParams.delete('present');
          history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch (_) {}
      }

      function render(next) {
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
        btn.setAttribute('aria-label', viewerText(next ? 'viewer.present.exit' : 'viewer.present.enter'));
        btn.title = viewerText(next ? 'viewer.present.exit.title' : 'viewer.present.enter.title');
        label.textContent = viewerText(next ? 'viewer.present.exit.label' : 'viewer.present.present');
      }

      function setActive(next, options) {
        options = options || {};
        next = Boolean(next);
        if (next === active()) {
          render(next);
          return next;
        }
        if (next) {
          if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
          previousScrollY = window.scrollY || 0;
          html.setAttribute('data-present', 'true');
          try { window.scrollTo(0, 0); } catch (_) {}
        } else {
          html.removeAttribute('data-present');
        }
        render(next);
        if (options.updateUrl !== false) updateUrl(next);
        requestAnimationFrame(function () {
          if (Archify.view && typeof Archify.view.reset === 'function') {
            Archify.view.reset({ automatic: true });
            requestAnimationFrame(function () {
              if (Archify.view && typeof Archify.view.sync === 'function') Archify.view.sync();
            });
          }
          if (!next && previousScrollY) {
            try { window.scrollTo(0, previousScrollY); } catch (_) {}
          }
        });
        return next;
      }

      function toggle() { return setActive(!active()); }

      render(active());
      btn.addEventListener('click', toggle);

      return {
        enter: function () { return setActive(true); },
        exit: function () { return setActive(false); },
        toggle: toggle,
        active: active
      };
    })();

    /* ============================================================
       Node Finder — stable-ID search over the existing semantic SVG.
       Search never changes the IR or SVG geometry: selecting a result resets
       the viewport and delegates to semantic focus.
       ============================================================ */
    Archify.finder = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var trigger = document.getElementById('btn-node-finder');
      var panel = document.getElementById('node-finder');
      var heading = document.getElementById('node-finder-title');
      var closeBtn = document.getElementById('node-finder-close');
      var input = document.getElementById('node-finder-input');
      var results = document.getElementById('node-finder-results');
      var empty = document.getElementById('node-finder-empty');
      var status = document.getElementById('node-finder-status');
      var visibleItems = [];

      function defaultContext() {
        return {
          kind: 'focus',
          title: viewerText('viewer.finder.title'),
          placeholder: viewerText('viewer.finder.placeholder'),
          empty: viewerText('viewer.finder.empty'),
          resultsLabel: viewerText('viewer.finder.results'),
          availableNoun: viewerText('viewer.finder.noun.nodes'),
          allowedIds: null,
          badges: null
        };
      }

      var context = defaultContext();

      function semanticType(node) {
        var authored = node.getAttribute('data-node-kind');
        if (authored) return authored;
        var types = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
        return types.find(function (type) { return node.querySelector('.c-' + type); }) || 'node';
      }

      function connectionsFor(id) {
        var count = 0;
        var seen = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = from + '\u0000' + to;
          if ((from === id || to === id) && !seen[key]) {
            seen[key] = true;
            count += 1;
          }
        });
        return count;
      }

      var items = Array.prototype.map.call(svg.querySelectorAll('[data-node-id]'), function (node) {
        var id = node.getAttribute('data-node-id');
        var label = node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || id).replace(/^Focus\s+/, '');
        var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        var sublabel = node.getAttribute('data-node-sublabel') || '';
        var context = node.getAttribute('data-node-context') || '';
        var tag = node.getAttribute('data-node-tag') || '';
        var brand = node.getAttribute('data-node-brand') || '';
        var type = semanticType(node);
        var sources = Archify.sourceEvidence.node(id);
        var sourceSearch = sources.map(function (source) {
          return [source.path, source.label, source.line, source.endLine].filter(Boolean).join(' ');
        }).join(' ');
        return {
          id: id,
          label: label,
          type: type,
          sublabel: sublabel,
          context: context,
          tag: tag,
          brand: brand,
          sources: sources,
          links: connectionsFor(id),
          search: (id + ' ' + label + ' ' + type + ' ' + sublabel + ' ' + context + ' ' + tag + ' ' + sourceSearch + ' ' + text).toLowerCase() + ' ' + brand.toLowerCase(),
          node: node
        };
      });

      function resultButtons() {
        return Array.prototype.slice.call(results.querySelectorAll('.node-finder-result'));
      }

      function resolveContext(options) {
        var requested = options && options.context ? options.context : null;
        if (!requested && Archify.routeProbe && typeof Archify.routeProbe.finderContext === 'function') {
          requested = Archify.routeProbe.finderContext();
        }
        if (!requested) return defaultContext();
        var resolved = defaultContext();
        Object.keys(requested).forEach(function (key) { resolved[key] = requested[key]; });
        return resolved;
      }

      function availableItems() {
        if (!context.allowedIds) return items.slice();
        return items.filter(function (item) { return context.allowedIds.indexOf(item.id) !== -1; });
      }

      function applyContext() {
        panel.setAttribute('data-context', context.kind);
        heading.textContent = context.title;
        input.placeholder = context.placeholder;
        empty.textContent = context.empty;
        results.setAttribute('aria-label', context.resultsLabel);
      }

      function select(id) {
        var item = items.find(function (candidate) { return candidate.id === id; });
        if (!item) return false;
        var routeSelection = context.kind === 'route-source' || context.kind === 'route-target';
        if (routeSelection) {
          if (!Archify.routeProbe || typeof Archify.routeProbe.choose !== 'function' || !Archify.routeProbe.choose(id)) return false;
          if (Archify.routeProbe.active() === 'target' && Archify.view && typeof Archify.view.reveal === 'function') {
            Archify.view.reveal([id], { includeNeighbors: true, reason: 'route-pick' });
          }
          close({ restoreFocus: false });
          try { item.node.focus({ preventScroll: true }); } catch (_) { try { item.node.focus(); } catch (_) {} }
          return true;
        }
        if (Archify.view && typeof Archify.view.reset === 'function') Archify.view.reset({ automatic: true });
        Archify.focus.set(id, { toggle: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'finder' });
        }
        close({ restoreFocus: false });
        try { item.node.focus({ preventScroll: true }); } catch (_) { try { item.node.focus(); } catch (_) {} }
        return true;
      }

      function render(query) {
        query = (query || '').trim().toLowerCase();
        var available = availableItems();
        visibleItems = available.filter(function (item) { return !query || item.search.indexOf(query) !== -1; });
        results.textContent = '';
        visibleItems.forEach(function (item) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'node-finder-result';
          button.setAttribute('data-node-id', item.id);
          var badge = context.badges && context.badges[item.id]
            ? context.badges[item.id]
            : context.kind === 'focus'
              ? viewerCount('viewer.finder.link', item.links)
              : String(item.links);
          var action = context.kind === 'route-source'
            ? viewerText('viewer.finder.result.routeStart', { label: item.label })
            : context.kind === 'route-target'
              ? viewerText('viewer.finder.result.routeTarget', { label: item.label, links: badge })
              : viewerCount('viewer.finder.result.focus', item.links, { label: item.label });
          button.setAttribute('aria-label', action);

          var name = document.createElement('strong');
          name.textContent = item.label;
          var links = document.createElement('em');
          links.textContent = badge;
          links.title = context.kind === 'focus' ? badge : action;
          var meta = document.createElement('small');
          meta.textContent = [viewerKindLabel(item.type), item.id, item.sublabel, item.tag].filter(Boolean).join(' \u00b7 ');
          meta.title = [viewerKindLabel(item.type), item.id, item.context, item.sublabel, item.tag].filter(Boolean).join(' \u00b7 ');
          button.appendChild(name);
          button.appendChild(links);
          button.appendChild(meta);
          button.addEventListener('click', function () { select(item.id); });
          results.appendChild(button);
        });
        empty.hidden = visibleItems.length !== 0;
        status.textContent = query
          ? viewerText('viewer.finder.status.filtered', {
              visible: visibleItems.length,
              available: available.length,
              noun: context.availableNoun
            })
          : viewerText('viewer.finder.status.all', { available: available.length, noun: context.availableNoun });
      }

      function open(options) {
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        if (Archify.semanticLens && Archify.semanticLens.isOpen()) Archify.semanticLens.close({ restoreFocus: false });
        context = resolveContext(options || {});
        applyContext();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        if (context.kind.indexOf('route-') === 0 && Archify.routeProbe && typeof Archify.routeProbe.finderOpening === 'function') {
          Archify.routeProbe.finderOpening();
        }
        input.value = '';
        render('');
        requestAnimationFrame(function () { input.focus(); });
        return true;
      }

      function close(options) {
        options = options || {};
        var routeContext = context.kind.indexOf('route-') === 0;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        input.value = '';
        if (routeContext && Archify.routeProbe && typeof Archify.routeProbe.finderClosed === 'function') {
          Archify.routeProbe.finderClosed({ restoreFocus: options.restoreFocus !== false });
        } else if (options.restoreFocus !== false) {
          trigger.focus();
        }
      }

      function toggle() { return panel.hidden ? open() : (close(), false); }

      trigger.addEventListener('click', toggle);
      closeBtn.addEventListener('click', function () { close(); });
      input.addEventListener('input', function () { render(input.value); });
      input.addEventListener('keydown', function (event) {
        var buttons = resultButtons();
        if (event.key === 'ArrowDown' && buttons.length) {
          event.preventDefault();
          buttons[0].focus();
        } else if (event.key === 'Enter' && visibleItems.length) {
          event.preventDefault();
          select(visibleItems[0].id);
        }
      });
      results.addEventListener('keydown', function (event) {
        var buttons = resultButtons();
        var index = buttons.indexOf(document.activeElement);
        if (index < 0 || !buttons.length) return;
        var next = null;
        if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        if (next !== null) {
          event.preventDefault();
          buttons[next].focus();
        }
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      document.addEventListener('click', function (event) {
        if (!panel.hidden && !panel.contains(event.target) && !event.target.closest('[data-node-finder-trigger]')) close({ restoreFocus: false });
      });

      render('');
      return {
        open: open,
        close: close,
        toggle: toggle,
        select: select,
        isOpen: function () { return !panel.hidden; },
        context: function () { return context.kind; },
        count: items.length
      };
    })();

    /* ============================================================
       Node Outline — a rail index of the semantic nodes, grouped by their
       authored context. Hover previews neighbors through Intent Trace;
       selection delegates to the Finder's focus-and-reveal path. It reads
       the canonical SVG and never changes geometry or export state.
       ============================================================ */
    Archify.outline = (function () {
      var panel = document.getElementById('node-outline');
      var list = document.getElementById('node-outline-list');
      var count = document.getElementById('node-outline-count');
      var svg = document.querySelector('.diagram-container > svg');
      if (!panel || !list || !svg) return { count: 0 };
      var TONES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
      var nodes = Array.from(svg.querySelectorAll('[data-node-id]')).filter(function (node) {
        return !node.closest('[data-legend-hit], .legend') && node.getAttribute('data-node-label');
      });
      var buttons = Object.create(null);

      function tone(node) {
        var shape = node.querySelector('[class*="c-"]:not(.c-mask)');
        var match = shape && /(?:^|\s)c-([a-z]+)/.exec(shape.getAttribute('class') || '');
        return match && TONES.indexOf(match[1]) !== -1 ? match[1] : 'external';
      }
      function preview(id) {
        if (Archify.intentTrace && typeof Archify.intentTrace.show === 'function') Archify.intentTrace.show(id);
      }
      function clearPreview() {
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') Archify.intentTrace.clear({ announce: false });
      }
      function select(id) {
        clearPreview();
        var finder = Archify.finder;
        if (finder && typeof finder.select === 'function') {
          if (finder.select(id)) return;
          var routeMode = Archify.routeProbe && typeof Archify.routeProbe.active === 'function' ? Archify.routeProbe.active() : 'idle';
          // Only an active endpoint picker owns a refused selection.
          if (routeMode === 'source' || routeMode === 'target') return;
        }
        if (Archify.focus && typeof Archify.focus.set === 'function') Archify.focus.set(id, { toggle: false });
      }

      var groups = [];
      var byContext = Object.create(null);
      nodes.forEach(function (node) {
        // Group by the outermost context (lane or stage); deeper segments
        // such as workflow groups and columns would split the index into
        // one-node sections.
        var context = (node.getAttribute('data-node-context') || '').split(' \u203a ')[0];
        if (!byContext[context]) {
          byContext[context] = { label: context, nodes: [] };
          groups.push(byContext[context]);
        }
        byContext[context].nodes.push(node);
      });

      groups.forEach(function (group) {
        var section = document.createElement('li');
        section.className = 'node-outline-group';
        if (groups.length > 1 && group.label) {
          var heading = document.createElement('span');
          heading.className = 'node-outline-heading';
          var headingLabel = document.createElement('span');
          headingLabel.textContent = group.label;
          var headingCount = document.createElement('small');
          headingCount.textContent = String(group.nodes.length);
          heading.appendChild(headingLabel);
          heading.appendChild(headingCount);
          section.appendChild(heading);
        }
        var items = document.createElement('ul');
        group.nodes.forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          var item = document.createElement('li');
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'node-outline-item';
          button.setAttribute('data-outline-node', id);
          button.style.setProperty('--outline-tone', 'var(--' + tone(node) + '-stroke)');
          var dot = document.createElement('span');
          dot.className = 'node-outline-dot';
          dot.setAttribute('aria-hidden', 'true');
          var label = document.createElement('strong');
          label.textContent = node.getAttribute('data-node-label');
          button.appendChild(dot);
          button.appendChild(label);
          var sublabel = node.getAttribute('data-node-sublabel');
          if (sublabel) {
            var detail = document.createElement('small');
            detail.textContent = sublabel;
            button.appendChild(detail);
          }
          button.addEventListener('pointerenter', function () { preview(id); });
          button.addEventListener('focus', function () { preview(id); });
          button.addEventListener('pointerleave', clearPreview);
          button.addEventListener('blur', clearPreview);
          button.addEventListener('click', function () { select(id); });
          buttons[id] = button;
          item.appendChild(button);
          items.appendChild(item);
        });
        section.appendChild(items);
        list.appendChild(section);
      });

      var previewing = null;
      function syncCurrent() {
        nodes.forEach(function (node) {
          var button = buttons[node.getAttribute('data-node-id')];
          if (!button) return;
          if (node.getAttribute('aria-pressed') === 'true') button.setAttribute('aria-current', 'true');
          else button.removeAttribute('aria-current');
        });
        // Mirror a diagram-side hover so the index answers "where is this?".
        var active = buttons[svg.getAttribute('data-intent-trace-active') || ''] || null;
        if (active === previewing) return;
        if (previewing) previewing.removeAttribute('data-previewing');
        previewing = active;
        if (!active) return;
        active.setAttribute('data-previewing', '');
        if (!active.matches(':hover') && panel.offsetParent) {
          var box = list.getBoundingClientRect();
          var item = active.getBoundingClientRect();
          if (item.top < box.top || item.bottom > box.bottom - 24) {
            list.scrollTop += item.top - box.top - box.height / 2 + item.height / 2;
          }
        }
      }
      if (typeof MutationObserver === 'function') {
        new MutationObserver(syncCurrent).observe(svg, { attributes: true, subtree: true, attributeFilter: ['aria-pressed', 'data-intent-trace-active'] });
      }
      if (count) count.textContent = String(nodes.length);
      panel.hidden = nodes.length < 2;
      syncCurrent();
      if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();

      return { count: nodes.length, select: select };
    })();


    /* ============================================================
       Route Probe — shortest directed path over compiled semantics.
       The graph is read from renderer-owned stable IDs and relationship
       endpoints. BFS order follows authored DOM edge order, so equal-length
       choices are deterministic without adding weights or a graph runtime.
       ============================================================ */
    Archify.routeProbe = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var trigger = document.getElementById('btn-route-probe');
      var panel = document.getElementById('route-probe');
      var title = document.getElementById('route-probe-title');
      var path = document.getElementById('route-probe-path');
      var status = document.getElementById('route-probe-status');
      var findBtn = document.getElementById('route-probe-find');
      var copyBtn = document.getElementById('route-probe-copy');
      var clearBtn = document.getElementById('route-probe-clear');
      var journeyControls = document.getElementById('route-journey-controls');
      var journeyPrevBtn = document.getElementById('route-journey-prev');
      var journeyPlayBtn = document.getElementById('route-journey-play');
      var journeyPlayIcon = document.getElementById('route-journey-play-icon');
      var journeyPlayLabel = document.getElementById('route-journey-play-label');
      var journeyNextBtn = document.getElementById('route-journey-next');
      var journeyOverviewBtn = document.getElementById('route-journey-overview');
      var namespace = 'http://www.w3.org/2000/svg';
      var mode = 'idle';
      var startId = null;
      var endId = null;
      var activeNodeIds = [];
      var activeEdges = [];
      var journeyIndex = -1;
      var journeyPlaying = false;
      var journeyComplete = false;
      var journeyGeneration = 0;
      var journeyTimer = null;
      var journeyStartedAt = 0;
      var journeyElapsedMs = 0;
      var journeyOwnerToken = 0;
      var JOURNEY_DWELL_MS = 1100;

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodesById() {
        var out = Object.create(null);
        nodes().forEach(function (node) { out[node.getAttribute('data-node-id')] = node; });
        return out;
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function exportSnapshot() {
        if (mode !== 'result' || activeNodeIds.length < 2 || activeEdges.length !== activeNodeIds.length - 1) return null;
        var allNodes = nodes();
        var byId = nodesById();
        var seenNodeIds = Object.create(null);
        var seenEdgeKeys = Object.create(null);
        if (startId !== activeNodeIds[0] || endId !== activeNodeIds[activeNodeIds.length - 1] ||
            activeNodeIds.some(function (id) {
              if (seenNodeIds[id] || allNodes.filter(function (node) {
                return node.getAttribute('data-node-id') === id;
              }).length !== 1) return true;
              seenNodeIds[id] = true;
              return !byId[id];
            }) ||
            activeEdges.some(function (edge, index) {
              if (!edge || !svg.contains(edge)) return true;
              var edgeKey = edge.getAttribute('data-edge-key');
              var edgeId = edge.getAttribute('data-edge-id') || '';
              if (!edgeKey || seenEdgeKeys[edgeKey]) return true;
              seenEdgeKeys[edgeKey] = true;
              var fragments = Array.prototype.slice.call(svg.querySelectorAll('[data-edge-key]')).filter(function (candidate) {
                return candidate.getAttribute('data-edge-key') === edgeKey;
              });
              var drawableFragments = fragments.filter(hasDrawableGeometry);
              return !fragments.length || !fragments.every(function (fragment) {
                return fragment.getAttribute('data-edge-from') === activeNodeIds[index] &&
                  fragment.getAttribute('data-edge-to') === activeNodeIds[index + 1] &&
                  (fragment.getAttribute('data-edge-id') || '') === edgeId;
              }) || drawableFragments.length !== 1 || drawableFragments[0] !== edge ||
                edge.getAttribute('data-edge-from') !== activeNodeIds[index] ||
                edge.getAttribute('data-edge-to') !== activeNodeIds[index + 1];
            })) return null;
        return {
          source: { id: startId, label: nodeLabel(byId[startId], startId) },
          target: { id: endId, label: nodeLabel(byId[endId], endId) },
          nodeIds: activeNodeIds.slice(),
          hops: activeEdges.length,
          edges: activeEdges.map(function (edge) {
            return {
              key: edge.getAttribute('data-edge-key'),
              id: edge.getAttribute('data-edge-id') || '',
              from: edge.getAttribute('data-edge-from'),
              to: edge.getAttribute('data-edge-to'),
              label: edge.getAttribute('data-edge-label') || ''
            };
          })
        };
      }
      function edgeShapes(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function removeOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-route-probe-overlay]'), function (overlay) {
          overlay.remove();
        });
      }
      function removeJourneyPulse(options) {
        options = options || {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-route-journey-overlay]'), function (overlay) {
          overlay.remove();
        });
        if (journeyOwnerToken && options.release !== false && Archify.motionGovernor) {
          var token = journeyOwnerToken;
          journeyOwnerToken = 0;
          Archify.motionGovernor.release(token);
        }
      }
      function stopJourneyTimer(options) {
        options = options || {};
        journeyGeneration += 1;
        if (journeyTimer) {
          if (options.preserveElapsed === true && journeyStartedAt) {
            journeyElapsedMs = Math.min(JOURNEY_DWELL_MS, journeyElapsedMs + Math.max(0, Date.now() - journeyStartedAt));
          }
          window.clearTimeout(journeyTimer);
        }
        journeyTimer = null;
        journeyStartedAt = 0;
        if (options.preserveElapsed !== true) journeyElapsedMs = 0;
      }
      function clearJourneyPresentation(options) {
        options = options || {};
        removeJourneyPulse();
        svg.removeAttribute('data-route-journey');
        panel.removeAttribute('data-route-journey');
        nodes().forEach(function (node) {
          node.removeAttribute('data-route-journey-state');
          node.removeAttribute('data-route-journey-current');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-route-journey-state');
          edge.removeAttribute('data-route-journey-current');
        });
        Array.prototype.forEach.call(path.querySelectorAll('[data-route-journey-index]'), function (button, index) {
          button.removeAttribute('data-route-journey-state');
          button.removeAttribute('aria-current');
          button.setAttribute('tabindex', index === 0 ? '0' : '-1');
        });
        if (options.keepControls !== true) journeyControls.hidden = true;
        journeyControls.setAttribute('data-playing', 'false');
      }
      function resetJourneyState() {
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        journeyIndex = -1;
        clearJourneyPresentation();
      }
      function cleanSvgState() {
        resetJourneyState();
        svg.removeAttribute('data-route-picking');
        svg.removeAttribute('data-route-active');
        removeOverlay();
        nodes().forEach(function (node) {
          node.removeAttribute('data-route-match');
          node.removeAttribute('data-route-start');
          node.removeAttribute('data-route-end');
          node.removeAttribute('data-route-step');
          node.removeAttribute('data-route-candidate');
          node.style.removeProperty('--route-step');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-route-match');
          edge.removeAttribute('data-route-step');
          edge.style.removeProperty('--route-step');
        });
        panel.removeAttribute('data-route-dock');
      }
      function replaceRouteHash(value) {
        try {
          history.replaceState(null, '', location.pathname + location.search + (value ? '#route=' + value : ''));
        } catch (_) {}
      }
      function renderPlaceholder(copy) {
        path.textContent = '';
        var placeholder = document.createElement('span');
        placeholder.className = 'route-probe-placeholder';
        placeholder.textContent = copy;
        path.appendChild(placeholder);
      }
      function renderPath(ids, options) {
        options = options || {};
        var byId = nodesById();
        path.textContent = '';
        ids.forEach(function (id, index) {
          if (index) {
            var arrow = document.createElement('span');
            arrow.className = 'route-probe-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            arrow.textContent = '\u2192';
            path.appendChild(arrow);
          }
          var item = document.createElement(options.interactive === true ? 'button' : 'span');
          if (options.interactive === true) {
            item.type = 'button';
            item.setAttribute('data-route-journey-index', String(index));
            item.setAttribute('data-route-node-id', id);
            item.setAttribute('tabindex', index === 0 ? '0' : '-1');
            item.setAttribute('aria-label', viewerText('viewer.route.position', {
              index: index + 1,
              total: ids.length,
              label: nodeLabel(byId[id], id)
            }));
          }
          item.className = 'route-probe-node';
          item.textContent = nodeLabel(byId[id], id);
          item.title = nodeLabel(byId[id], id) + ' · ' + id;
          if (index === 0) item.setAttribute('data-endpoint', 'start');
          if (index === ids.length - 1 && ids.length > 1) item.setAttribute('data-endpoint', 'end');
          path.appendChild(item);
        });
      }
      function setTrigger(active) {
        trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
        trigger.setAttribute('aria-label', viewerText(active ? 'viewer.route.trigger.clear' : 'viewer.guide.route.aria'));
      }
      function clear(options) {
        options = options || {};
        var wasActive = mode !== 'idle';
        if (Archify.finder && Archify.finder.isOpen() && typeof Archify.finder.context === 'function' && Archify.finder.context().indexOf('route-') === 0) {
          Archify.finder.close({ restoreFocus: false });
        }
        mode = 'idle';
        startId = null;
        endId = null;
        activeNodeIds = [];
        activeEdges = [];
        cleanSvgState();
        panel.hidden = true;
        panel.setAttribute('data-state', 'idle');
        panel.removeAttribute('data-finder-open');
        title.textContent = viewerText('viewer.route.start');
        renderPlaceholder(viewerText('viewer.route.pickTwo'));
        status.textContent = viewerText('viewer.route.instructions');
        findBtn.hidden = true;
        findBtn.textContent = viewerText('viewer.route.start.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.start.find.aria'));
        copyBtn.hidden = true;
        copyBtn.textContent = viewerText('viewer.route.copy');
        if (Archify.exportMenu && typeof Archify.exportMenu.syncRouteShare === 'function') Archify.exportMenu.syncRouteShare();
        setTrigger(false);
        if (wasActive && options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) replaceRouteHash('');
        if (options.restoreFocus === true) trigger.focus();
      }
      function outgoingByNode() {
        var byId = nodesById();
        var outgoing = Object.create(null);
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (!byId[from] || !byId[to] || from === to) return;
          if (!outgoing[from]) outgoing[from] = [];
          outgoing[from].push({ edge: edge, to: to });
        });
        return outgoing;
      }
      function reachableFrom(source) {
        var outgoing = outgoingByNode();
        var reached = Object.create(null);
        var queue = [source];
        reached[source] = true;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.forEach(function (link) {
            if (reached[link.to]) return;
            reached[link.to] = true;
            queue.push(link.to);
          });
        }
        return reached;
      }
      function hopDistancesFrom(source) {
        var outgoing = outgoingByNode();
        var distances = Object.create(null);
        var queue = [source];
        distances[source] = 0;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.forEach(function (link) {
            if (Object.prototype.hasOwnProperty.call(distances, link.to)) return;
            distances[link.to] = distances[queue[cursor]] + 1;
            queue.push(link.to);
          });
        }
        return distances;
      }
      function shortestDirectedPath(source, target) {
        if (source === target) return null;
        var outgoing = outgoingByNode();
        var previous = Object.create(null);
        var queue = [source];
        previous[source] = null;
        for (var cursor = 0; cursor < queue.length && !Object.prototype.hasOwnProperty.call(previous, target); cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.some(function (link) {
            if (Object.prototype.hasOwnProperty.call(previous, link.to)) return false;
            previous[link.to] = { from: queue[cursor], edge: link.edge };
            queue.push(link.to);
            return link.to === target;
          });
        }
        if (!Object.prototype.hasOwnProperty.call(previous, target)) return null;
        var nodeIds = [target];
        var routeEdges = [];
        var current = target;
        while (current !== source) {
          var step = previous[current];
          if (!step) return null;
          routeEdges.unshift(step.edge);
          nodeIds.unshift(step.from);
          current = step.from;
        }
        return { nodes: nodeIds, edges: routeEdges };
      }
      function traceGeometry(shape, step) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-route-match');
        clone.removeAttribute('data-route-step');
        clone.setAttribute('class', 'route-probe-flow');
        clone.setAttribute('pathLength', '1');
        clone.style.setProperty('--route-step', String(step));
        return clone;
      }
      function renderOverlay(routeEdges) {
        removeOverlay();
        if (!routeEdges.length) return;
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'route-probe-overlay');
        overlay.setAttribute('data-route-probe-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        routeEdges.forEach(function (edge, step) {
          var wrapper = document.createElementNS(namespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          edgeShapes(edge).forEach(function (shape) { wrapper.appendChild(traceGeometry(shape, step)); });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
      }
      function journeyButtons() {
        return Array.prototype.slice.call(path.querySelectorAll('[data-route-journey-index]'));
      }
      function journeyMotionAllowed() {
        return html.getAttribute('data-embed') !== 'true' &&
          !document.hidden &&
          Archify.motionGovernor &&
          Archify.motionGovernor.capable === true &&
          !Archify.motionGovernor.isPaused();
      }
      function routeOverviewStatus() {
        return viewerText('viewer.route.overview.status', {
          nodes: viewerCount('viewer.route.overview.node', activeNodeIds.length),
          hops: viewerCount('viewer.route.overview.hop', activeEdges.length)
        });
      }
      function centerJourneyButton(button) {
        if (!button) return;
        var target = button.offsetLeft - Math.max(0, (path.clientWidth - button.offsetWidth) / 2);
        path.scrollLeft = Math.max(0, target);
      }
      function focusJourneyButton(index) {
        var buttons = journeyButtons();
        if (!buttons.length) return false;
        var next = Math.max(0, Math.min(buttons.length - 1, index));
        buttons.forEach(function (button, buttonIndex) {
          button.setAttribute('tabindex', buttonIndex === next ? '0' : '-1');
        });
        try { buttons[next].focus({ preventScroll: true }); } catch (_) { buttons[next].focus(); }
        centerJourneyButton(buttons[next]);
        return true;
      }
      function renderJourneyControls() {
        var hasRoute = mode === 'result' && activeNodeIds.length > 1;
        var canPlay = hasRoute && journeyMotionAllowed();
        journeyControls.hidden = !hasRoute;
        journeyControls.setAttribute('data-playing', journeyPlaying ? 'true' : 'false');
        journeyPrevBtn.disabled = !hasRoute || journeyIndex <= 0;
        journeyNextBtn.disabled = !hasRoute || journeyIndex >= activeNodeIds.length - 1;
        journeyOverviewBtn.disabled = !hasRoute || journeyIndex < 0;
        journeyPlayBtn.disabled = !canPlay;
        journeyPlayBtn.setAttribute('aria-pressed', journeyPlaying ? 'true' : 'false');
        if (journeyPlaying) {
          journeyPlayIcon.textContent = '\u275a\u275a';
          journeyPlayLabel.textContent = viewerText('viewer.route.pause.label');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.pause'));
          journeyPlayBtn.title = viewerText('viewer.route.pause');
        } else if (journeyComplete || journeyIndex === activeNodeIds.length - 1) {
          journeyPlayIcon.textContent = '\u21bb';
          journeyPlayLabel.textContent = viewerText('viewer.route.replay.label');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.replay'));
          journeyPlayBtn.title = viewerText(canPlay ? 'viewer.route.replay' : 'viewer.route.motionRequired');
        } else {
          journeyPlayIcon.textContent = '\u25b6';
          journeyPlayLabel.textContent = viewerText('viewer.route.journey');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.play'));
          journeyPlayBtn.title = viewerText(canPlay ? 'viewer.route.play' : 'viewer.route.motionRequired');
        }
      }
      function journeyGeometry(shape) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-route-match');
        clone.removeAttribute('data-route-step');
        clone.removeAttribute('data-route-journey-state');
        clone.removeAttribute('data-route-journey-current');
        clone.setAttribute('class', 'route-journey-flow');
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function renderJourneyPulse(edge) {
        removeJourneyPulse();
        if (!edge || !journeyMotionAllowed()) return false;
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'route-journey-overlay');
        overlay.setAttribute('data-route-journey-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var wrapper = document.createElementNS(namespace, 'g');
        if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
        edgeShapes(edge).forEach(function (shape) { wrapper.appendChild(journeyGeometry(shape)); });
        if (!wrapper.childNodes.length) return false;
        overlay.appendChild(wrapper);
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        if (Archify.motionGovernor && Archify.motionGovernor.capable) {
          var token = 0;
          token = Archify.motionGovernor.claim('route', function () {
            if (journeyOwnerToken === token) journeyOwnerToken = 0;
            removeJourneyPulse({ release: false });
          });
          journeyOwnerToken = token;
        }
        overlay.addEventListener('animationend', function () {
          if (overlay.isConnected) removeJourneyPulse();
        }, { once: true });
        window.setTimeout(function () {
          if (overlay.isConnected) removeJourneyPulse();
        }, 860);
        return true;
      }
      function applyJourneyState(index, options) {
        options = options || {};
        if (mode !== 'result' || !activeNodeIds.length) return false;
        var byId = nodesById();
        journeyIndex = Math.max(0, Math.min(activeNodeIds.length - 1, index));
        removeJourneyPulse();
        svg.setAttribute('data-route-journey', (journeyIndex + 1) + '/' + activeNodeIds.length);
        panel.setAttribute('data-route-journey', String(journeyIndex));
        activeNodeIds.forEach(function (id, step) {
          var node = byId[id];
          if (!node) return;
          var state = step < journeyIndex ? 'past' : (step === journeyIndex ? 'current' : 'future');
          node.setAttribute('data-route-journey-state', state);
          if (step === journeyIndex) node.setAttribute('data-route-journey-current', '');
          else node.removeAttribute('data-route-journey-current');
        });
        activeEdges.forEach(function (edge, step) {
          var destination = step + 1;
          var state = destination < journeyIndex ? 'past' : (destination === journeyIndex ? 'current' : 'future');
          edge.setAttribute('data-route-journey-state', state);
          if (destination === journeyIndex) edge.setAttribute('data-route-journey-current', '');
          else edge.removeAttribute('data-route-journey-current');
        });
        var buttons = journeyButtons();
        buttons.forEach(function (button, step) {
          var state = step < journeyIndex ? 'past' : (step === journeyIndex ? 'current' : 'future');
          button.setAttribute('data-route-journey-state', state);
          button.setAttribute('tabindex', step === journeyIndex ? '0' : '-1');
          if (step === journeyIndex) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
        });
        if (options.center !== false) centerJourneyButton(buttons[journeyIndex]);
        var phase = viewerText(journeyPlaying
          ? 'viewer.route.phase.playing'
          : journeyComplete
            ? 'viewer.route.phase.complete'
            : 'viewer.route.phase.inspecting');
        status.textContent = viewerText('viewer.route.step', {
          index: journeyIndex + 1,
          total: activeNodeIds.length,
          phase: phase,
          label: nodeLabel(byId[activeNodeIds[journeyIndex]], activeNodeIds[journeyIndex])
        });
        if (options.pulse === true && journeyIndex > 0) renderJourneyPulse(activeEdges[journeyIndex - 1]);
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(activeNodeIds.slice(Math.max(0, journeyIndex - 1), Math.min(activeNodeIds.length, journeyIndex + 2)), {
            includeNeighbors: false,
            reason: 'route-journey',
            maxScale: 1.65,
            padding: 64,
            duration: 360,
            instant: !journeyMotionAllowed()
          });
        }
        renderJourneyControls();
        requestDocking();
        return true;
      }
      function pauseJourney(options) {
        options = options || {};
        if (!journeyPlaying && options.complete !== true) {
          renderJourneyControls();
          return false;
        }
        stopJourneyTimer({ preserveElapsed: options.complete !== true && options.preserveElapsed !== false });
        journeyPlaying = false;
        journeyComplete = options.complete === true;
        if (journeyComplete) journeyElapsedMs = 0;
        removeJourneyPulse();
        if (journeyIndex >= 0) applyJourneyState(journeyIndex, { center: false, pulse: false, reveal: false });
        else renderJourneyControls();
        return true;
      }
      function selectJourneyIndex(index) {
        if (mode !== 'result') return false;
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        return applyJourneyState(index, { pulse: true, reveal: true });
      }
      function showJourneyOverview(options) {
        options = options || {};
        if (mode !== 'result') return false;
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        journeyIndex = -1;
        clearJourneyPresentation({ keepControls: true });
        status.textContent = routeOverviewStatus();
        renderJourneyControls();
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(activeNodeIds, { includeNeighbors: false, reason: 'route', instant: !journeyMotionAllowed() });
        }
        requestDocking();
        return true;
      }
      function scheduleJourney() {
        if (!journeyPlaying || !journeyMotionAllowed()) {
          pauseJourney({ preserveElapsed: true });
          return false;
        }
        var generation = ++journeyGeneration;
        var remaining = Math.max(0, JOURNEY_DWELL_MS - journeyElapsedMs);
        journeyStartedAt = Date.now();
        journeyTimer = window.setTimeout(function () {
          if (generation !== journeyGeneration || !journeyPlaying) return;
          journeyTimer = null;
          journeyStartedAt = 0;
          journeyElapsedMs = 0;
          if (journeyIndex >= activeNodeIds.length - 1) {
            pauseJourney({ complete: true, preserveElapsed: false });
            return;
          }
          applyJourneyState(journeyIndex + 1, { pulse: true, reveal: true });
          // Camera and motion-owner handoff are allowed to synchronously
          // settle the previous step. The new step always starts with a fresh
          // dwell; never carry cleanup time into the next scheduler lease.
          journeyElapsedMs = 0;
          journeyStartedAt = 0;
          scheduleJourney();
        }, remaining);
        return true;
      }
      function playJourney() {
        if (mode !== 'result' || activeNodeIds.length < 2 || !journeyMotionAllowed()) {
          renderJourneyControls();
          return false;
        }
        if (journeyPlaying) return true;
        if (journeyComplete || journeyIndex >= activeNodeIds.length - 1) {
          journeyIndex = -1;
          journeyElapsedMs = 0;
          journeyComplete = false;
        }
        journeyPlaying = true;
        if (journeyIndex < 0) applyJourneyState(0, { pulse: false, reveal: true });
        else applyJourneyState(journeyIndex, { center: false, pulse: false, reveal: false });
        scheduleJourney();
        return true;
      }
      function toggleJourney() {
        return journeyPlaying ? pauseJourney({ preserveElapsed: true }) : playJourney();
      }
      function previousJourney() {
        return selectJourneyIndex(Math.max(0, journeyIndex < 0 ? 0 : journeyIndex - 1));
      }
      function nextJourney() {
        return selectJourneyIndex(Math.min(activeNodeIds.length - 1, journeyIndex + 1));
      }
      function overlapArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function updateDocking() {
        if (panel.hidden) {
          panel.removeAttribute('data-route-dock');
          return;
        }
        var containerRect = container.getBoundingClientRect();
        var width = panel.offsetWidth;
        var height = panel.offsetHeight;
        if (!width || !height) return;
        var currentRect = panel.getBoundingClientRect();
        var left = currentRect.left;
        var topCandidate = {
          left: left,
          right: left + width,
          top: containerRect.top + 8,
          bottom: containerRect.top + 8 + height
        };
        var nav = container.querySelector('.diagram-nav');
        var navRect = nav ? nav.getBoundingClientRect() : null;
        var bottom = navRect ? navRect.top - 9 : containerRect.bottom - 8;
        var bottomCandidate = {
          left: left,
          right: left + width,
          top: bottom - height,
          bottom: bottom
        };
        var byId = nodesById();
        var relevant = activeNodeIds.length ? activeNodeIds : (startId ? [startId] : []);
        var blockers = relevant.map(function (id) { return byId[id]; }).filter(Boolean).map(function (node) {
          return node.getBoundingClientRect();
        });
        function score(candidate) {
          var value = blockers.reduce(function (sum, rect) { return sum + overlapArea(candidate, rect); }, 0);
          if (navRect) value += overlapArea(candidate, navRect) * 4;
          if (candidate.top < containerRect.top || candidate.bottom > containerRect.bottom) value += 1000000;
          return value;
        }
        if (score(topCandidate) <= score(bottomCandidate)) panel.setAttribute('data-route-dock', 'top');
        else panel.setAttribute('data-route-dock', 'bottom');
      }
      function requestDocking() {
        requestAnimationFrame(updateDocking);
        window.setTimeout(updateDocking, 120);
        window.setTimeout(updateDocking, 560);
      }
      function chooseStart(id) {
        var byId = nodesById();
        if (!byId[id]) return false;
        cleanSvgState();
        startId = id;
        endId = null;
        mode = 'target';
        var reached = reachableFrom(id);
        byId[id].setAttribute('data-route-start', '');
        byId[id].setAttribute('data-route-match', '');
        Object.keys(reached).forEach(function (candidateId) {
          if (candidateId !== id && byId[candidateId]) byId[candidateId].setAttribute('data-route-candidate', '');
        });
        svg.setAttribute('data-route-picking', 'target');
        panel.setAttribute('data-state', 'target');
        title.textContent = viewerText('viewer.route.destination', { label: nodeLabel(byId[id], id) });
        renderPath([id]);
        var count = Math.max(0, Object.keys(reached).length - 1);
        status.textContent = count
          ? viewerCount('viewer.route.destination.count', count)
          : viewerText('viewer.route.noOutgoing');
        findBtn.hidden = false;
        findBtn.textContent = viewerText('viewer.route.destination.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.destination.find.aria'));
        requestDocking();
        return true;
      }
      function showResult(result, options) {
        options = options || {};
        var byId = nodesById();
        cleanSvgState();
        mode = 'result';
        startId = result.nodes[0];
        endId = result.nodes[result.nodes.length - 1];
        activeNodeIds = result.nodes.slice();
        activeEdges = result.edges.slice();
        result.nodes.forEach(function (id, step) {
          var node = byId[id];
          if (!node) return;
          node.setAttribute('data-route-match', '');
          node.setAttribute('data-route-step', String(step));
          node.style.setProperty('--route-step', String(step));
          if (step === 0) node.setAttribute('data-route-start', '');
          if (step === result.nodes.length - 1) node.setAttribute('data-route-end', '');
        });
        result.edges.forEach(function (edge, step) {
          edge.setAttribute('data-route-match', '');
          edge.setAttribute('data-route-step', String(step));
          edge.style.setProperty('--route-step', String(step));
        });
        svg.setAttribute('data-route-active', startId + '~' + endId);
        renderOverlay(result.edges);
        renderPath(result.nodes, { interactive: true });
        panel.setAttribute('data-state', 'result');
        panel.hidden = false;
        title.textContent = viewerText('viewer.route.result.title', {
          source: nodeLabel(byId[startId], startId),
          target: nodeLabel(byId[endId], endId)
        });
        findBtn.hidden = true;
        copyBtn.hidden = false;
        setTrigger(true);
        if (Archify.exportMenu && typeof Archify.exportMenu.syncRouteShare === 'function') Archify.exportMenu.syncRouteShare();
        if (options.updateUrl !== false) {
          replaceRouteHash(encodeURIComponent(startId) + '~' + encodeURIComponent(endId));
        }
        showJourneyOverview({ reveal: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodes, { includeNeighbors: false, reason: 'route' });
        }
        return true;
      }
      function choose(id, options) {
        options = options || {};
        var byId = nodesById();
        if (!byId[id]) return false;
        if (mode === 'source') return chooseStart(id);
        if (mode !== 'target') return false;
        if (id === startId) {
          panel.setAttribute('data-state', 'error');
          title.textContent = viewerText('viewer.route.differentDestination');
          status.textContent = viewerText('viewer.route.distinct');
          return false;
        }
        var result = shortestDirectedPath(startId, id);
        if (!result) {
          panel.setAttribute('data-state', 'error');
          title.textContent = viewerText('viewer.route.unreachable', { label: nodeLabel(byId[id], id) });
          status.textContent = viewerText('viewer.route.unreachable.detail', {
            target: nodeLabel(byId[id], id),
            source: nodeLabel(byId[startId], startId)
          });
          return false;
        }
        return showResult(result, options);
      }
      function begin(options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.active()) {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        var focused = options.source || (Archify.focus && typeof Archify.focus.active === 'function' ? Archify.focus.active() : null);
        if (Array.isArray(focused)) focused = null;
        clear({ updateUrl: false, preserveView: true, restoreFocus: false });
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') Archify.intentTrace.clear({ announce: false });
        if (Archify.focus && typeof Archify.focus.clear === 'function') {
          Archify.focus.clear({ updateUrl: false, preserveView: true });
        }
        if (Archify.finder && Archify.finder.isOpen()) Archify.finder.close({ restoreFocus: false });
        if (Archify.radar && Archify.radar.isOpen()) Archify.radar.close({ restoreFocus: false });
        mode = 'source';
        panel.hidden = false;
        panel.setAttribute('data-state', 'source');
        svg.setAttribute('data-route-picking', 'source');
        title.textContent = viewerText('viewer.route.start');
        renderPlaceholder(viewerText('viewer.route.pickOne'));
        status.textContent = viewerText('viewer.route.start.instructions');
        findBtn.hidden = false;
        findBtn.textContent = viewerText('viewer.route.start.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.start.find.aria'));
        copyBtn.hidden = true;
        setTrigger(true);
        if (focused && nodesById()[focused]) chooseStart(focused);
        if (options.focusNode === true && !focused) {
          var first = nodes()[0];
          if (first) {
            try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} }
          }
        }
        return true;
      }
      function toggle(options) {
        if (mode !== 'idle') {
          clear({ restoreFocus: true });
          return false;
        }
        return begin(options);
      }
      function finderContext() {
        var byId = nodesById();
        if (mode === 'source') {
          var outgoing = outgoingByNode();
          var sourceIds = nodes().map(function (node) { return node.getAttribute('data-node-id'); }).filter(function (id) {
            return outgoing[id] && outgoing[id].length;
          });
          var sourceBadges = Object.create(null);
          sourceIds.forEach(function (id) { sourceBadges[id] = viewerText('viewer.route.finder.source.badge'); });
          return {
            kind: 'route-source',
            title: viewerText('viewer.route.finder.source.title'),
            placeholder: viewerText('viewer.route.finder.source.placeholder'),
            empty: viewerText('viewer.route.finder.source.empty'),
            resultsLabel: viewerText('viewer.route.finder.source.results'),
            availableNoun: viewerText('viewer.route.finder.source.noun'),
            allowedIds: sourceIds,
            badges: sourceBadges
          };
        }
        if (mode === 'target' && startId && byId[startId]) {
          var distances = hopDistancesFrom(startId);
          var targetIds = Object.keys(distances).filter(function (id) { return id !== startId && byId[id]; });
          var targetBadges = Object.create(null);
          targetIds.forEach(function (id) {
            targetBadges[id] = viewerCount('viewer.route.hop', distances[id]);
          });
          return {
            kind: 'route-target',
            title: viewerText('viewer.route.finder.target.title', { label: nodeLabel(byId[startId], startId) }),
            placeholder: viewerText('viewer.route.finder.target.placeholder'),
            empty: viewerText('viewer.route.finder.target.empty'),
            resultsLabel: viewerText('viewer.route.finder.target.results'),
            availableNoun: viewerText('viewer.route.finder.target.noun'),
            allowedIds: targetIds,
            badges: targetBadges
          };
        }
        return null;
      }
      function finderOpening() {
        panel.setAttribute('data-finder-open', 'true');
      }
      function finderClosed(options) {
        options = options || {};
        panel.removeAttribute('data-finder-open');
        requestDocking();
        if (options.restoreFocus === true && !findBtn.hidden) findBtn.focus();
      }
      function openFinder() {
        var context = finderContext();
        if (!context || !Archify.finder) return false;
        return Archify.finder.open({ context: context });
      }
      function fallbackCopy(value) {
        var field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        field.remove();
        return copied;
      }
      function copyLink() {
        if (mode !== 'result') return Promise.resolve(false);
        var value = location.href.replace(/#.*$/, '') + '#route=' + encodeURIComponent(startId) + '~' + encodeURIComponent(endId);
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          copyBtn.setAttribute('aria-label', viewerText(copied ? 'viewer.route.copy.success' : 'viewer.route.copy.failed'));
          window.setTimeout(function () {
            copyBtn.textContent = viewerText('viewer.route.copy');
            copyBtn.setAttribute('aria-label', viewerText('viewer.route.copy.aria'));
          }, 1600);
          return copied;
        });
      }
      function interceptSelection(event) {
        if (mode !== 'source' && mode !== 'target') return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(node.getAttribute('data-node-id'));
      }
      function syncFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var route = params.get('route');
          if (!route) {
            if (mode !== 'idle') clear({ updateUrl: false, restoreFocus: false });
            return;
          }
          var parts = route.split('~');
          if (parts.length !== 2) return;
          var byId = nodesById();
          if (!byId[parts[0]] || !byId[parts[1]]) return;
          begin({ source: parts[0], focusNode: false });
          choose(parts[1], { updateUrl: false });
        } catch (_) {}
      }
      function escapeRoute(options) {
        options = options || {};
        if (journeyPlaying) {
          pauseJourney({ preserveElapsed: true });
          if (options.restoreFocus === true) journeyPlayBtn.focus();
          return 'paused';
        }
        if (journeyIndex >= 0) {
          showJourneyOverview({ reveal: true });
          if (options.restoreFocus === true) journeyOverviewBtn.focus();
          return 'overview';
        }
        clear({ restoreFocus: options.restoreFocus === true });
        return 'cleared';
      }
      function syncJourneyMotion() {
        if (journeyPlaying && !journeyMotionAllowed()) pauseJourney({ preserveElapsed: true });
        renderJourneyControls();
        return journeyMotionAllowed();
      }

      trigger.addEventListener('click', function () { toggle({ focusNode: false }); });
      findBtn.addEventListener('click', openFinder);
      clearBtn.addEventListener('click', function () { clear({ restoreFocus: true }); });
      copyBtn.addEventListener('click', copyLink);
      journeyPrevBtn.addEventListener('click', previousJourney);
      journeyPlayBtn.addEventListener('click', toggleJourney);
      journeyNextBtn.addEventListener('click', nextJourney);
      journeyOverviewBtn.addEventListener('click', function () { showJourneyOverview({ reveal: true }); });
      path.addEventListener('click', function (event) {
        var button = event.target.closest('[data-route-journey-index]');
        if (!button) return;
        selectJourneyIndex(Number(button.getAttribute('data-route-journey-index')));
      });
      path.addEventListener('focusin', function (event) {
        if (journeyPlaying && event.target.closest('[data-route-journey-index]')) pauseJourney({ preserveElapsed: true });
      });
      path.addEventListener('keydown', function (event) {
        var button = event.target.closest('[data-route-journey-index]');
        if (!button) return;
        var index = Number(button.getAttribute('data-route-journey-index'));
        var next = null;
        if (event.key === 'ArrowRight') next = Math.min(activeNodeIds.length - 1, index + 1);
        else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = activeNodeIds.length - 1;
        if (next !== null) {
          event.preventDefault();
          focusJourneyButton(next);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectJourneyIndex(index);
        }
      });
      svg.addEventListener('click', interceptSelection, true);
      svg.addEventListener('keydown', interceptSelection, true);
      container.addEventListener('scroll', updateDocking, { passive: true });
      window.addEventListener('resize', requestDocking);
      window.addEventListener('beforeprint', function () {
        if (journeyPlaying) pauseJourney({ preserveElapsed: true, reason: 'print' });
        else removeJourneyPulse();
      });
      window.addEventListener('hashchange', function () { requestAnimationFrame(syncFromHash); });
      syncFromHash();

      return {
        begin: begin,
        choose: choose,
        clear: clear,
        toggle: toggle,
        escape: escapeRoute,
        copyLink: copyLink,
        playJourney: playJourney,
        pauseJourney: pauseJourney,
        showOverview: showJourneyOverview,
        selectJourneyIndex: selectJourneyIndex,
        syncMotion: syncJourneyMotion,
        isJourneyPlaying: function () { return journeyPlaying; },
        finderContext: finderContext,
        finderOpening: finderOpening,
        finderClosed: finderClosed,
        openFinder: openFinder,
        exportSnapshot: exportSnapshot,
        active: function () { return mode === 'idle' ? null : mode; },
        result: function () {
          return mode === 'result'
            ? { source: startId, target: endId, nodes: activeNodeIds.slice(), hops: activeEdges.length, journey: journeyIndex, playing: journeyPlaying }
            : null;
        }
      };
    })();

    /* ============================================================
       Semantic Lens — a counted, viewer-only legend over data-node-kind.
       One selected kind reveals every authored relationship touching it.
       Two selected kinds compare only direct cross-kind relationships while
       preserving the full diagram as a dimmed spatial reference.
       ============================================================ */
    Archify.semanticLens = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var trigger = document.getElementById('btn-semantic-lens');
      var panel = document.getElementById('semantic-lens');
      var closeBtn = document.getElementById('semantic-lens-close');
      var kindsRoot = document.getElementById('semantic-lens-kinds');
      var status = document.getElementById('semantic-lens-status');
      var copyBtn = document.getElementById('semantic-lens-copy');
      var clearBtn = document.getElementById('semantic-lens-clear');
      var legendBridge = svg.querySelector('[data-legend-bridge]');
      var legendEntries = [];
      var hoveredLegendEntry = null;
      var focusedLegendEntry = null;
      var activeLegendPreview = null;
      var lensOpener = trigger;
      var selectedKinds = [];
      var namespace = 'http://www.w3.org/2000/svg';
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
      var MAX_LENS_FLOW_EDGES = 24;

      function nodesById() {
        var byId = Object.create(null);
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id][data-node-kind]'), function (node) {
          var id = node.getAttribute('data-node-id');
          if (id && !byId[id]) byId[id] = node;
        });
        return byId;
      }
      function collectKinds() {
        var kinds = {};
        var byId = nodesById();
        Object.keys(byId).forEach(function (id) {
          var node = byId[id];
          var value = node.getAttribute('data-node-kind') || 'neutral';
          var kind = kinds[value] || (kinds[value] = { id: value, label: viewerKindLabel(value), nodes: [] });
          kind.nodes.push(node);
        });
        return Object.keys(kinds).map(function (key) { return kinds[key]; }).sort(function (a, b) {
          return b.nodes.length - a.nodes.length || a.label.localeCompare(b.label);
        });
      }
      function edgeGroups() {
        var groups = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = edge.getAttribute('data-edge-key') || [from, to, edge.getAttribute('data-edge-label') || ''].join('\u0000');
          if (!groups[key]) groups[key] = { key: key, from: from, to: to, members: [] };
          groups[key].members.push(edge);
        });
        return Object.keys(groups).map(function (key) { return groups[key]; });
      }
      function edgeShapes(edge) {
        if (!edge) return [];
        if (/^(path|line|polyline)$/i.test(edge.tagName || '')) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function legendSourceBounds(entry) {
        var bounds = null;
        Array.prototype.forEach.call(entry.children, function (child) {
          if (child.hasAttribute('data-legend-bridge-runtime')) return;
          var box;
          try { box = child.getBBox(); } catch (_) { return; }
          if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
          var next = { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
          if (!bounds) bounds = next;
          else {
            bounds.left = Math.min(bounds.left, next.left);
            bounds.top = Math.min(bounds.top, next.top);
            bounds.right = Math.max(bounds.right, next.right);
            bounds.bottom = Math.max(bounds.bottom, next.bottom);
          }
        });
        return bounds;
      }
      function layoutLegendEntry(entry) {
        var bounds = legendSourceBounds(entry);
        var hit = entry.querySelector('[data-legend-hit]');
        var badge = entry.querySelector('[data-legend-count-badge]');
        if (!bounds || !hit || !badge) return false;
        var count = entry.getAttribute('data-legend-count') || '0';
        var centerY = (bounds.top + bounds.bottom) / 2;
        var badgeWidth = Math.max(14, count.length * 5 + 8);
        var badgeX = bounds.right + 3;
        var hitX = bounds.left - 5;
        var hitRight = badgeX + badgeWidth + 4;
        hit.setAttribute('x', hitX.toFixed(2));
        hit.setAttribute('y', (centerY - 12).toFixed(2));
        hit.setAttribute('width', Math.max(24, hitRight - hitX).toFixed(2));
        hit.setAttribute('height', '24');
        hit.setAttribute('rx', '4');
        var badgeRect = badge.querySelector('rect');
        var badgeText = badge.querySelector('text');
        badgeRect.setAttribute('x', badgeX.toFixed(2));
        badgeRect.setAttribute('y', (centerY - 7).toFixed(2));
        badgeRect.setAttribute('width', badgeWidth.toFixed(2));
        badgeRect.setAttribute('height', '14');
        badgeRect.setAttribute('rx', '7');
        badgeText.setAttribute('x', (badgeX + badgeWidth / 2).toFixed(2));
        badgeText.setAttribute('y', (centerY + 2.5).toFixed(2));
        return true;
      }
      function layoutLegendBridge() {
        legendEntries.forEach(layoutLegendEntry);
        if (!legendBridge) return;
        Array.prototype.forEach.call(legendBridge.querySelectorAll('[data-legend-zero]'), layoutLegendEntry);
      }
      function decorateLegendBridge() {
        legendEntries = [];
        if (!legendBridge || html.getAttribute('data-embed') === 'true') return false;
        var facts = {};
        collectKinds().forEach(function (kind) { facts[kind.id] = kind; });
        Array.prototype.forEach.call(legendBridge.querySelectorAll('[data-legend-kind]'), function (entry) {
          var kind = entry.getAttribute('data-legend-kind');
          var fact = facts[kind];
          var count = fact ? fact.nodes.length : 0;
          entry.setAttribute('data-legend-count', String(count));
          var hit = document.createElementNS(namespace, 'rect');
          hit.setAttribute('data-legend-bridge-runtime', '');
          hit.setAttribute('data-legend-hit', '');
          hit.setAttribute('aria-hidden', 'true');
          entry.insertBefore(hit, entry.firstChild);
          var badge = document.createElementNS(namespace, 'g');
          badge.setAttribute('data-legend-bridge-runtime', '');
          badge.setAttribute('data-legend-count-badge', '');
          badge.setAttribute('aria-hidden', 'true');
          badge.appendChild(document.createElementNS(namespace, 'rect'));
          var countText = document.createElementNS(namespace, 'text');
          countText.textContent = String(count);
          badge.appendChild(countText);
          entry.appendChild(badge);
          if (!fact || !count) {
            entry.setAttribute('data-legend-zero', '');
            return;
          }
          entry.setAttribute('role', 'button');
          entry.setAttribute('tabindex', legendEntries.length ? '-1' : '0');
          var visibleLabel = entry.getAttribute('data-legend-label') || fact.label;
          entry.setAttribute('aria-label', viewerCount('viewer.lens.legend.inspect', count, { label: visibleLabel }));
          entry.setAttribute('aria-pressed', 'false');
          entry.setAttribute('aria-haspopup', 'dialog');
          entry.setAttribute('aria-controls', 'semantic-lens');
          entry.setAttribute('aria-expanded', 'false');
          legendEntries.push(entry);
        });
        if (!legendEntries.length) return false;
        legendBridge.setAttribute('role', legendEntries.length >= 3 ? 'toolbar' : 'group');
        legendBridge.setAttribute('aria-label', viewerText('viewer.lens.legend'));
        syncLegendBridge();
        layoutLegendBridge();
        try {
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutLegendBridge);
        } catch (_) {}
        return true;
      }
      function syncLegendBridge() {
        legendEntries.forEach(function (entry) {
          var selected = selectedKinds.indexOf(entry.getAttribute('data-legend-kind')) >= 0;
          entry.setAttribute('aria-pressed', selected ? 'true' : 'false');
          entry.setAttribute('aria-expanded', !panel.hidden && lensOpener === entry ? 'true' : 'false');
          if (selected) entry.setAttribute('data-legend-selected', '');
          else entry.removeAttribute('data-legend-selected');
        });
      }
      function clearLegendPreview() {
        activeLegendPreview = null;
        svg.removeAttribute('data-legend-preview-active');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer]'), function (element) {
          element.removeAttribute('data-legend-preview-match');
          element.removeAttribute('data-legend-preview-selected');
          element.removeAttribute('data-legend-preview-peer');
        });
      }
      function strongerLegendOwnerActive() {
        return selectedKinds.length > 0 || !panel.hidden || html.getAttribute('data-present') === 'true' ||
          svg.hasAttribute('data-focus-active') || svg.hasAttribute('data-intent-trace-active') ||
          svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active') ||
          svg.hasAttribute('data-relationship-preview-active');
      }
      function previewLegendKind(entry) {
        clearLegendPreview();
        if (!entry || strongerLegendOwnerActive()) return false;
        var kind = entry.getAttribute('data-legend-kind');
        var byId = nodesById();
        var matches = Object.keys(byId).filter(function (id) {
          return (byId[id].getAttribute('data-node-kind') || 'neutral') === kind;
        });
        if (!matches.length) return false;
        var chosen = Object.create(null);
        matches.forEach(function (id) {
          chosen[id] = true;
          byId[id].setAttribute('data-legend-preview-match', '');
          byId[id].setAttribute('data-legend-preview-selected', '');
        });
        edgeGroups().forEach(function (edge) {
          if (!chosen[edge.from] && !chosen[edge.to]) return;
          edge.members.forEach(function (member) { member.setAttribute('data-legend-preview-match', ''); });
          [edge.from, edge.to].forEach(function (id) {
            if (!byId[id] || chosen[id]) return;
            byId[id].setAttribute('data-legend-preview-match', '');
            byId[id].setAttribute('data-legend-preview-peer', '');
          });
        });
        svg.setAttribute('data-legend-preview-active', kind);
        activeLegendPreview = entry;
        return true;
      }
      function syncLegendPreview() {
        var next = focusedLegendEntry || hoveredLegendEntry;
        if (next === activeLegendPreview) return;
        clearLegendPreview();
        if (next) previewLegendKind(next);
      }
      function activateLegendEntry(entry) {
        if (!entry || entry.getAttribute('role') !== 'button') return false;
        clearLegendPreview();
        select(entry.getAttribute('data-legend-kind'));
        return open({ opener: entry });
      }
      function removeFlowOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-semantic-lens-overlay]'), function (element) {
          element.remove();
        });
        svg.removeAttribute('data-lens-flow-count');
        svg.removeAttribute('data-lens-flow-density');
      }
      function flowGeometry(shape, direction, step) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-lens-match');
        clone.setAttribute('class', 'semantic-lens-flow');
        clone.setAttribute('data-direction', direction);
        clone.setAttribute('pathLength', '1');
        clone.style.setProperty('--lens-flow-delay', (step * 0.08).toFixed(2) + 's');
        return clone;
      }
      function renderFlowOverlay(entries) {
        removeFlowOverlay();
        svg.setAttribute('data-lens-flow-count', String(entries.length));
        if (!entries.length || html.getAttribute('data-embed') === 'true') return false;
        if (entries.length > MAX_LENS_FLOW_EDGES) {
          svg.setAttribute('data-lens-flow-density', 'quiet');
          return false;
        }
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'semantic-lens-overlay');
        overlay.setAttribute('data-semantic-lens-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        entries.forEach(function (entry, step) {
          var wrapper = document.createElementNS(namespace, 'g');
          if (entry.edge.members[0].hasAttribute('transform')) {
            wrapper.setAttribute('transform', entry.edge.members[0].getAttribute('transform'));
          }
          edgeShapes(entry.edge.members[0]).forEach(function (shape) {
            wrapper.appendChild(flowGeometry(shape, entry.direction, step));
          });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        if (!overlay.childNodes.length) return false;
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        return true;
      }
      function cleanSvgState() {
        removeFlowOverlay();
        svg.removeAttribute('data-lens-active');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-lens-match], [data-lens-selected], [data-lens-peer]'), function (element) {
          element.removeAttribute('data-lens-match');
          element.removeAttribute('data-lens-selected');
          element.removeAttribute('data-lens-peer');
        });
      }
      function renderKinds() {
        kindsRoot.textContent = '';
        collectKinds().forEach(function (kind) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'semantic-lens-kind';
          button.setAttribute('data-kind', kind.id);
          button.setAttribute('aria-pressed', selectedKinds.indexOf(kind.id) >= 0 ? 'true' : 'false');
          button.setAttribute('aria-label', viewerCount('viewer.lens.kind.count', kind.nodes.length, { label: kind.label }));
          button.disabled = selectedKinds.length >= 2 && selectedKinds.indexOf(kind.id) === -1;
          var swatch = document.createElement('span');
          swatch.className = 'semantic-lens-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          var label = document.createElement('strong');
          label.textContent = kind.label;
          var count = document.createElement('em');
          count.textContent = String(kind.nodes.length);
          button.appendChild(swatch);
          button.appendChild(label);
          button.appendChild(count);
          kindsRoot.appendChild(button);
        });
      }
      function updateHash() {
        try {
          var hash = selectedKinds.length
            ? '#lens=' + selectedKinds.map(encodeURIComponent).join('~')
            : '';
          history.replaceState(null, '', location.pathname + location.search + hash);
        } catch (_) {}
      }
      function updateTrigger() {
        var active = selectedKinds.length > 0;
        trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
        trigger.setAttribute('aria-label', viewerText(active ? 'viewer.lens.openActive' : 'viewer.lens.open'));
        copyBtn.hidden = !active;
        syncLegendBridge();
      }
      function overlapArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function dockPanel(byId) {
        panel.removeAttribute('data-dock-side');
        if (panel.hidden || window.innerWidth <= 720) return 'right';
        var panelRect = panel.getBoundingClientRect();
        var containerRect = container.getBoundingClientRect();
        if (!panelRect.width || !panelRect.height) return 'right';
        var selectedRects = Object.keys(byId).filter(function (id) {
          return selectedKinds.indexOf(byId[id].getAttribute('data-node-kind') || 'neutral') >= 0;
        }).map(function (id) { return byId[id].getBoundingClientRect(); });
        var top = panelRect.top;
        var width = panelRect.width;
        var leftCandidate = { left: containerRect.left + 16, right: containerRect.left + 16 + width, top: top, bottom: panelRect.bottom };
        var rightCandidate = { left: containerRect.right - 16 - width, right: containerRect.right - 16, top: top, bottom: panelRect.bottom };
        var leftScore = selectedRects.reduce(function (score, rect) { return score + overlapArea(leftCandidate, rect); }, 0);
        var rightScore = selectedRects.reduce(function (score, rect) { return score + overlapArea(rightCandidate, rect); }, 0);
        var legend = svg.querySelector('[data-legend]');
        var nav = container.querySelector('.diagram-nav');
        var protectedRects = [legend, nav].filter(function (element) {
          return element && !element.hidden && window.getComputedStyle(element).display !== 'none';
        }).map(function (element) { return element.getBoundingClientRect(); });
        leftScore += protectedRects.reduce(function (score, rect) {
          return score + overlapArea(leftCandidate, rect) * 1000;
        }, 0);
        rightScore += protectedRects.reduce(function (score, rect) {
          return score + overlapArea(rightCandidate, rect) * 1000;
        }, 0);
        var side = leftScore < rightScore ? 'left' : 'right';
        panel.setAttribute('data-dock-side', side);
        return side;
      }
      function applySelection(options) {
        options = options || {};
        cleanSvgState();
        var byId = nodesById();
        var nodeKind = Object.create(null);
        Object.keys(byId).forEach(function (id) { nodeKind[id] = byId[id].getAttribute('data-node-kind') || 'neutral'; });
        if (!selectedKinds.length) {
          status.textContent = viewerText('viewer.lens.choose');
          updateTrigger();
          renderKinds();
          dockPanel(byId);
          if (options.updateUrl !== false) updateHash();
          return false;
        }

        var chosen = {};
        selectedKinds.forEach(function (kind) { chosen[kind] = true; });
        Object.keys(byId).forEach(function (id) {
          if (!chosen[nodeKind[id]]) return;
          byId[id].setAttribute('data-lens-match', '');
          byId[id].setAttribute('data-lens-selected', '');
        });

        var touching = 0;
        var forward = 0;
        var reverse = 0;
        var crossKind = selectedKinds.length === 2;
        var matchedFlow = [];
        edgeGroups().forEach(function (edge) {
          var fromKind = nodeKind[edge.from];
          var toKind = nodeKind[edge.to];
          var match = false;
          if (crossKind) {
            if (fromKind === selectedKinds[0] && toKind === selectedKinds[1]) { match = true; forward += 1; }
            if (fromKind === selectedKinds[1] && toKind === selectedKinds[0]) { match = true; reverse += 1; }
          } else if (fromKind === selectedKinds[0] || toKind === selectedKinds[0]) {
            match = true;
            touching += 1;
          }
          if (!match) return;
          var direction = 'within';
          if (crossKind) {
            direction = fromKind === selectedKinds[0] ? 'forward' : 'reverse';
          } else {
            direction = fromKind === selectedKinds[0] && toKind !== selectedKinds[0] ? 'out'
              : (toKind === selectedKinds[0] && fromKind !== selectedKinds[0] ? 'in' : 'within');
          }
          matchedFlow.push({ edge: edge, direction: direction });
          edge.members.forEach(function (member) { member.setAttribute('data-lens-match', ''); });
          if (!crossKind) {
            [edge.from, edge.to].forEach(function (id) {
              if (!byId[id]) return;
              byId[id].setAttribute('data-lens-match', '');
              if (!chosen[nodeKind[id]]) byId[id].setAttribute('data-lens-peer', '');
            });
          }
        });

        svg.setAttribute('data-lens-active', selectedKinds.join(' '));
        renderFlowOverlay(matchedFlow);
        if (crossKind) {
          var total = forward + reverse;
          status.textContent = viewerCount('viewer.lens.compare', total, {
            first: viewerKindLabel(selectedKinds[0]),
            second: viewerKindLabel(selectedKinds[1]),
            forward: forward,
            reverse: reverse
          });
        } else {
          var nodeCount = collectKinds().filter(function (kind) { return kind.id === selectedKinds[0]; })[0].nodes.length;
          status.textContent = viewerText('viewer.lens.single', {
            nodes: viewerCount('viewer.lens.node', nodeCount, { label: viewerKindLabel(selectedKinds[0]) }),
            relationships: viewerCount('viewer.lens.relationship', touching)
          });
        }
        updateTrigger();
        renderKinds();
        dockPanel(byId);
        if (options.updateUrl !== false) updateHash();
        return true;
      }
      function prepareForLens() {
        clearLegendPreview();
        if (Archify.focus && typeof Archify.focus.clear === 'function') {
          Archify.focus.clear({ updateUrl: false, preserveView: true });
        }
        if (Archify.routeProbe && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') {
          Archify.intentTrace.clear({ announce: false });
        }
      }
      function select(kind, options) {
        options = options || {};
        clearLegendPreview();
        var exists = collectKinds().some(function (entry) { return entry.id === kind; });
        if (!exists) return false;
        var index = selectedKinds.indexOf(kind);
        if (index >= 0) selectedKinds.splice(index, 1);
        else {
          if (selectedKinds.length >= 2) return false;
          if (!selectedKinds.length) prepareForLens();
          selectedKinds.push(kind);
        }
        return applySelection(options);
      }
      function close(options) {
        options = options || {};
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        updateTrigger();
        if (options.restoreFocus !== false && lensOpener && typeof lensOpener.focus === 'function') lensOpener.focus();
        return false;
      }
      function open(options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        lensOpener = options.opener || trigger;
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        if (Archify.finder && Archify.finder.isOpen()) Archify.finder.close({ restoreFocus: false });
        if (Archify.radar && Archify.radar.isOpen()) Archify.radar.close({ restoreFocus: false });
        if (Archify.guide && Archify.guide.isOpen()) Archify.guide.close({ restoreFocus: false });
        renderKinds();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        updateTrigger();
        requestAnimationFrame(function () {
          dockPanel(nodesById());
          var activeButton = kindsRoot.querySelector('[aria-pressed="true"]');
          var firstButton = activeButton || kindsRoot.querySelector('button:not(:disabled)');
          if (firstButton) firstButton.focus();
        });
        return true;
      }
      function toggle() { return panel.hidden ? open({ opener: trigger }) : close(); }
      function clear(options) {
        options = options || {};
        selectedKinds = [];
        cleanSvgState();
        panel.removeAttribute('data-dock-side');
        updateTrigger();
        renderKinds();
        status.textContent = viewerText('viewer.lens.choose');
        if (options.updateUrl !== false) updateHash();
        if (options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.closePanel === true) close({ restoreFocus: false });
        return false;
      }
      function fallbackCopy(value) {
        var field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        field.remove();
        return copied;
      }
      function copyLink() {
        if (!selectedKinds.length) return Promise.resolve(false);
        var value = location.href.replace(/#.*$/, '') + '#lens=' + selectedKinds.map(encodeURIComponent).join('~');
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          window.setTimeout(function () { copyBtn.textContent = viewerText('viewer.common.copyLink'); }, 1600);
          return copied;
        });
      }
      function syncFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var value = params.get('lens');
          if (!value) {
            if (selectedKinds.length) clear({ updateUrl: false, preserveView: true });
            return;
          }
          var available = collectKinds().map(function (kind) { return kind.id; });
          var requested = value.split('~').filter(function (kind, index, list) {
            return available.indexOf(kind) >= 0 && list.indexOf(kind) === index;
          }).slice(0, 2);
          if (!requested.length) return;
          prepareForLens();
          selectedKinds = requested;
          applySelection({ updateUrl: false });
        } catch (_) {}
      }

      trigger.addEventListener('click', toggle);
      if (decorateLegendBridge()) {
        legendBridge.addEventListener('click', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (entry) activateLegendEntry(entry);
        });
        legendBridge.addEventListener('pointerover', function (event) {
          if (event.pointerType === 'touch' || (finePointerQuery && !finePointerQuery.matches)) return;
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          hoveredLegendEntry = entry;
          syncLegendPreview();
        });
        legendBridge.addEventListener('pointerout', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          if (hoveredLegendEntry === entry) hoveredLegendEntry = null;
          syncLegendPreview();
        });
        legendBridge.addEventListener('focusin', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry) return;
          focusedLegendEntry = entry;
          legendEntries.forEach(function (candidate) {
            candidate.setAttribute('tabindex', candidate === entry ? '0' : '-1');
          });
          syncLegendPreview();
        });
        legendBridge.addEventListener('focusout', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          if (focusedLegendEntry === entry) focusedLegendEntry = null;
          syncLegendPreview();
        });
        legendBridge.addEventListener('keydown', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateLegendEntry(entry);
            return;
          }
          var index = legendEntries.indexOf(entry);
          var next = null;
          if (event.key === 'ArrowRight') next = (index + 1) % legendEntries.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + legendEntries.length) % legendEntries.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = legendEntries.length - 1;
          if (next === null) return;
          event.preventDefault();
          legendEntries.forEach(function (candidate, candidateIndex) {
            candidate.setAttribute('tabindex', candidateIndex === next ? '0' : '-1');
          });
          legendEntries[next].focus();
        });
      }
      closeBtn.addEventListener('click', function () { close(); });
      clearBtn.addEventListener('click', function () { clear({ preserveView: true }); });
      copyBtn.addEventListener('click', copyLink);
      kindsRoot.addEventListener('click', function (event) {
        var button = event.target.closest('[data-kind]');
        if (!button || button.disabled) return;
        select(button.getAttribute('data-kind'));
      });
      kindsRoot.addEventListener('keydown', function (event) {
        var buttons = Array.prototype.slice.call(kindsRoot.querySelectorAll('button:not(:disabled)'));
        var index = buttons.indexOf(document.activeElement);
        var next = null;
        if (index >= 0 && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) next = (index + 1) % buttons.length;
        else if (index >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home' && buttons.length) next = 0;
        else if (event.key === 'End' && buttons.length) next = buttons.length - 1;
        if (next !== null) { event.preventDefault(); buttons[next].focus(); }
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      document.addEventListener('click', function (event) {
        var eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        var clickedInside = eventPath.indexOf(panel) >= 0 || panel.contains(event.target);
        var clickedLauncher = event.target === trigger || legendEntries.some(function (entry) {
          return event.target === entry || entry.contains(event.target);
        });
        if (!panel.hidden && !clickedInside && !clickedLauncher) close({ restoreFocus: false });
      });
      window.addEventListener('hashchange', syncFromHash);
      window.addEventListener('resize', function () {
        if (!panel.hidden && selectedKinds.length) dockPanel(nodesById());
        layoutLegendBridge();
      });
      renderKinds();
      syncFromHash();

      return {
        open: open,
        close: close,
        toggle: toggle,
        clear: clear,
        clearPreview: clearLegendPreview,
        select: select,
        copyLink: copyLink,
        isOpen: function () { return !panel.hidden; },
        active: function () { return selectedKinds.length ? selectedKinds.slice() : null; },
        kinds: function () { return collectKinds().map(function (kind) { return { id: kind.id, count: kind.nodes.length }; }); }
      };
    })();

    /* ============================================================
       Diagram Guide — a factual command deck over existing interactions.
       Counts come from compiled semantics; actions delegate to Finder, Route
       Probe, Semantic Radar, Semantic Lens, Presentation, theme, export, and
       camera without adding a second command implementation or SVG state.
       ============================================================ */
    Archify.guide = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var trigger = document.getElementById('btn-diagram-guide');
      var panel = document.getElementById('diagram-guide');
      var closeBtn = document.getElementById('diagram-guide-close');
      var stats = document.getElementById('diagram-guide-stats');
      var actions = document.getElementById('diagram-guide-actions');
      var feedback = document.getElementById('diagram-guide-feedback');
      var routePanel = document.getElementById('route-probe');
      var returnFocus = null;

      function relationshipCount() {
        var seen = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
          var key = edge.getAttribute('data-edge-key') || [
            edge.getAttribute('data-edge-from'),
            edge.getAttribute('data-edge-to'),
            edge.getAttribute('data-edge-label') || ''
          ].join('\u0000');
          seen[key] = true;
        });
        return Object.keys(seen).length;
      }
      function renderFacts() {
        var nodes = svg.querySelectorAll('[data-node-id]').length;
        var relationships = relationshipCount();
        stats.textContent = viewerText('viewer.guide.facts', {
          nodes: viewerCount('viewer.guide.fact.node', nodes),
          relationships: viewerCount('viewer.guide.fact.relationship', relationships)
        });
      }
      function actionButtons() {
        return Array.prototype.slice.call(actions.querySelectorAll('.diagram-guide-action:not(:disabled)'));
      }
      function close(options) {
        options = options || {};
        panel.hidden = true;
        html.removeAttribute('data-guide-open');
        routePanel.removeAttribute('data-guide-open');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', viewerText('viewer.guide.open'));
        feedback.textContent = '';
        if (options.restoreFocus !== false) {
          var target = trigger.hidden ? returnFocus : trigger;
          if (target && typeof target.focus === 'function') target.focus();
        }
        return false;
      }
      function open() {
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        if (Archify.finder && Archify.finder.isOpen()) Archify.finder.close({ restoreFocus: false });
        if (Archify.radar && Archify.radar.isOpen()) Archify.radar.close({ restoreFocus: false });
        if (Archify.semanticLens && Archify.semanticLens.isOpen()) Archify.semanticLens.close({ restoreFocus: false });
        if (Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: 'guide' });
        }
        returnFocus = document.activeElement;
        renderFacts();
        panel.hidden = false;
        html.setAttribute('data-guide-open', 'true');
        routePanel.setAttribute('data-guide-open', 'true');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-label', viewerText('viewer.guide.close'));
        feedback.textContent = '';
        requestAnimationFrame(function () {
          var first = actionButtons()[0];
          if (first) first.focus();
        });
        return true;
      }
      function toggle() { return panel.hidden ? open() : close(); }
      function execute(action) {
        feedback.textContent = '';
        close({ restoreFocus: false });
        if (action === 'find') return Archify.finder.open();
        if (action === 'route') return Archify.routeProbe.begin({ focusNode: true });
        if (action === 'map') return Archify.radar.open();
        if (action === 'lens') return Archify.semanticLens.open();
        if (action === 'present') return Archify.presentation.enter();
        if (action === 'export') return Archify.exportMenu.open();
        if (action === 'theme') return Archify.theme.toggle();
        if (action === 'preset') return Archify.preset.cycle();
        if (action === 'reset') return Archify.view.reset();
        if (action === 'zoom-in') return Archify.view.zoomIn();
        if (action === 'zoom-out') return Archify.view.zoomOut();
        return false;
      }
      function actionForKey(key) {
        return {
          '/': 'find',
          r: 'route',
          m: 'map',
          l: 'lens',
          f: 'present',
          e: 'export',
          t: 'theme',
          s: 'preset',
          '0': 'reset',
          '+': 'zoom-in',
          '=': 'zoom-in',
          '-': 'zoom-out'
        }[key] || null;
      }

      trigger.addEventListener('click', toggle);
      closeBtn.addEventListener('click', function () { close(); });
      actions.addEventListener('click', function (event) {
        var button = event.target.closest('[data-guide-action]');
        if (!button || button.disabled) return;
        event.stopPropagation();
        execute(button.getAttribute('data-guide-action'));
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === '?') {
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        var buttons = actionButtons();
        var index = buttons.indexOf(document.activeElement);
        var next = null;
        if (index >= 0 && event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (index >= 0 && event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (index >= 0 && event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
        else if (index >= 0 && event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home' && buttons.length) next = 0;
        else if (event.key === 'End' && buttons.length) next = buttons.length - 1;
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          buttons[next].focus();
          return;
        }
        var action = actionForKey(event.key.length === 1 ? event.key.toLowerCase() : event.key);
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        execute(action);
      });
      document.addEventListener('click', function (event) {
        if (!panel.hidden && !panel.contains(event.target) && event.target !== trigger) close({ restoreFocus: false });
      });

      renderFacts();
      return {
        open: open,
        close: close,
        toggle: toggle,
        execute: execute,
        isOpen: function () { return !panel.hidden; },
        facts: function () {
          return {
            nodes: svg.querySelectorAll('[data-node-id]').length,
            relationships: relationshipCount()
          };
        }
      };
    })();

    /* ============================================================
       Global keyboard shortcuts
       ? -> open Diagram Guide
       T -> toggle theme
       S -> cycle visual style
       E -> open export menu
         F -> toggle presentation stage
         M -> toggle Semantic Radar
         L -> toggle Semantic Lens
         R -> start/clear Route Probe
         / -> open node finder or the active route endpoint picker
         + / - -> zoom, 0 -> reset view
         Escape -> clear temporary trace/focus/view first, then exit presentation
       Ignored when focus is inside an input/textarea/contenteditable.
       ============================================================ */
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.defaultPrevented) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (Archify.preset && Archify.preset.isOpen() && e.key !== 'Escape' && e.key !== 's' && e.key !== 'S') {
        Archify.preset.close(false);
      }
      if (e.key === '?') {
        e.preventDefault();
        Archify.guide.toggle();
      } else if (e.key === '/') {
        e.preventDefault();
        Archify.finder.open();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        Archify.theme.toggle();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        Archify.preset.cycle();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        if (!Archify.exportMenu.isOpen()) Archify.exportMenu.open();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        Archify.presentation.toggle();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        Archify.radar.toggle();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        Archify.semanticLens.toggle();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        Archify.routeProbe.toggle({ focusNode: true });
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        Archify.view.zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        Archify.view.zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        Archify.view.reset();
      } else if (e.key === 'Escape' && Archify.preset.isOpen()) {
        e.preventDefault();
        Archify.preset.close(true);
      } else if (e.key === 'Escape' && Archify.semanticLens.isOpen()) {
        e.preventDefault();
        Archify.semanticLens.close({ restoreFocus: true });
      } else if (e.key === 'Escape' && Archify.semanticLens.active()) {
        e.preventDefault();
        Archify.semanticLens.clear({ preserveView: true });
      } else if (e.key === 'Escape' && Archify.guide.isOpen()) {
        e.preventDefault();
        Archify.guide.close({ restoreFocus: true });
      } else if (e.key === 'Escape' && Archify.radar.isOpen()) {
        e.preventDefault();
        Archify.radar.close({ restoreFocus: true });
      } else if (e.key === 'Escape' && Archify.routeProbe.active()) {
        e.preventDefault();
        Archify.routeProbe.escape({ restoreFocus: true });
      } else if (e.key === 'Escape' && Archify.intentTrace.active()) {
        e.preventDefault();
        Archify.intentTrace.clear();
      } else if (e.key === 'Escape' && Archify.focus.active()) {
        e.preventDefault();
        Archify.focus.clear({ restoreFocus: true });
      } else if (e.key === 'Escape' && Archify.presentation.active()) {
        e.preventDefault();
        Archify.presentation.exit();
      }
    });
