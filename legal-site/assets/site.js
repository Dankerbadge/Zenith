(function () {
  document.documentElement.classList.add('js');

  function emitAnalytics(name, payload) {
    const event = {
      name,
      payload: payload || {},
      ts: new Date().toISOString(),
      path: window.location.pathname,
    };

    try {
      const existing = JSON.parse(localStorage.getItem('zenith_analytics_queue') || '[]');
      existing.push(event);
      localStorage.setItem('zenith_analytics_queue', JSON.stringify(existing.slice(-100)));
    } catch (err) {
      // Ignore storage issues silently
    }

    window.dispatchEvent(new CustomEvent('zenith_analytics', { detail: event }));
  }

  document.addEventListener('click', function (e) {
    const target = e.target.closest('[data-event]');
    if (!target) return;
    emitAnalytics(target.getAttribute('data-event'), {
      label: target.getAttribute('data-label') || '',
      href: target.getAttribute('href') || '',
    });
  });

  const header = document.querySelector('.site-header');
  const mobileToggle = document.querySelector('[data-mobile-toggle]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  const desktopNav = document.querySelector('.nav-desktop');
  const navWrap = document.querySelector('.nav-wrap');
  const body = document.body;
  let lockedScrollY = 0;
  let scrim = null;

  function lockBodyScroll() {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    // iOS Safari is inconsistent with `overflow: hidden` on body.
    // Use a fixed-position lock so opening the menu never traps the page in a blank/stuck state.
    body.style.position = 'fixed';
    body.style.top = `${-lockedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }

  function unlockBodyScroll() {
    const wasLocked = body.style.position === 'fixed';
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    body.style.height = '';
    body.style.overflow = '';
    if (wasLocked) window.scrollTo(0, lockedScrollY);
  }

  function ensureScrim() {
    if (scrim) return scrim;
    scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scrim);
    return scrim;
  }

  function setMobileNavTopCssVar() {
    const headerH = header ? Math.round(header.getBoundingClientRect().height) : 76;
    document.documentElement.style.setProperty('--mobileNavTop', `${headerH}px`);
  }

  function deriveNavTargets(pathname) {
    const path = String(pathname || '/');
    const featureLike = path.startsWith('/features') || path.startsWith('/premium');
    const wearablesLike = path.startsWith('/wearables') || path.startsWith('/support/wearables');
    const privacyLike =
      path.startsWith('/privacy') ||
      path.startsWith('/privacy-policy') ||
      path.startsWith('/terms') ||
      path.startsWith('/data-permissions') ||
      path.startsWith('/cookies');
    const supportLike =
      path.startsWith('/support') ||
      path.startsWith('/releases') ||
      path.startsWith('/contact') ||
      path.startsWith('/status');

    const desktopTarget = featureLike
      ? '/features'
      : wearablesLike
        ? '/wearables'
      : privacyLike
        ? '/privacy'
        : supportLike
          ? '/support'
          : '/product';

    const mobileTarget = path.startsWith('/status') ? '/status' : desktopTarget;
    return { desktopTarget, mobileTarget };
  }

  function markActiveNav(nav, target, fallbackTarget) {
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll('a[href]'));
    links.forEach((link) => {
      link.classList.remove('active');
      link.removeAttribute('aria-current');
    });

    const exact = links.find((link) => link.getAttribute('href') === target);
    if (exact) {
      exact.classList.add('active');
      exact.setAttribute('aria-current', 'page');
      return;
    }

    if (!fallbackTarget) return;
    const fallback = links.find((link) => link.getAttribute('href') === fallbackTarget);
    if (fallback) {
      fallback.classList.add('active');
      fallback.setAttribute('aria-current', 'page');
    }
  }

  const { desktopTarget, mobileTarget } = deriveNavTargets(window.location.pathname);
  markActiveNav(desktopNav, desktopTarget, '/product');
  markActiveNav(mobileNav, mobileTarget, desktopTarget);

  function onScroll() {
    if (!header) return;
    if (window.scrollY > 8) header.classList.add('compact');
    else header.classList.remove('compact');
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (mobileToggle && mobileNav) {
    function setMobileNavOpen(nextOpen) {
      const isOpen = Boolean(nextOpen);
      if (isOpen) setMobileNavTopCssVar();
      mobileNav.classList.toggle('open', isOpen);
      mobileToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('nav-open', isOpen);
      mobileNav.setAttribute('aria-hidden', String(!isOpen));

      const scrimEl = ensureScrim();
      scrimEl.classList.toggle('open', isOpen);

      if (isOpen) lockBodyScroll();
      else {
        unlockBodyScroll();
        document.documentElement.style.removeProperty('--mobileNavTop');
      }
    }

    mobileToggle.addEventListener('click', function () {
      setMobileNavOpen(!mobileNav.classList.contains('open'));
    });

    ensureScrim().addEventListener('click', function () {
      if (mobileNav.classList.contains('open')) setMobileNavOpen(false);
    });

    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        setMobileNavOpen(false);
      }
    });

    document.addEventListener('click', function (e) {
      if (!mobileNav.classList.contains('open')) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      const insideNav = mobileNav.contains(target) || (navWrap ? navWrap.contains(target) : false);
      if (!insideNav) setMobileNavOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('open')) {
        setMobileNavOpen(false);
      }
    });

    // BFCache / reload safety: never keep the page scroll-locked if the browser restores state.
    window.addEventListener('pageshow', function () {
      if (mobileNav.classList.contains('open')) setMobileNavOpen(false);
      else unlockBodyScroll();
    });

    window.addEventListener('resize', function () {
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      if (width > 820 && mobileNav.classList.contains('open')) {
        setMobileNavOpen(false);
      }
    });
  }

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealItems = Array.from(document.querySelectorAll('.reveal'));
  function revealVisibleNow() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    revealItems.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const isVisible = rect.top < viewportHeight * 0.92 && rect.bottom > 0;
      if (isVisible) item.classList.add('in-view');
    });
  }

  const canReveal =
    'IntersectionObserver' in window &&
    revealItems.length > 0 &&
    !prefersReduced &&
    (window.innerWidth || document.documentElement.clientWidth || 0) > 820;

  if (canReveal) {
    document.documentElement.classList.add('can-reveal');
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -20px 0px' }
    );

    revealItems.forEach((item) => observer.observe(item));
    revealVisibleNow();
    window.setTimeout(() => {
      const hidden = revealItems.filter((item) => !item.classList.contains('in-view')).length;
      if (hidden > 0) revealVisibleNow();
    }, 420);
  } else {
    revealItems.forEach((item) => item.classList.add('in-view'));
  }

  const tiltCards = Array.from(document.querySelectorAll('.tilt'));
  if (!prefersReduced && tiltCards.length) {
    tiltCards.forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        const rx = (0.5 - py) * 4;
        const ry = (px - 0.5) * 5;
        card.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-1px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      });
    });
  }

  // Hero segmented control
  const segmentButtons = Array.from(document.querySelectorAll('[data-segment-btn]'));
  const segmentTitle = document.querySelector('[data-segment-title]');
  const segmentBody = document.querySelector('[data-segment-body]');
  const segmentAction = document.querySelector('[data-segment-action]');
  const segmentSignal = document.querySelector('[data-segment-signal]');
  const segmentOutcome = document.querySelector('[data-segment-outcome]');

  if (segmentButtons.length && segmentTitle && segmentBody) {
    const homeData = {
      run: {
        title: 'Run smarter',
        body: 'Start, finish, and review runs with clear lifecycle rules and trend-safe stats.',
      },
      train: {
        title: 'Train consistently',
        body: 'Winning Day logic keeps daily expectations simple: one clear target, one clear outcome.',
      },
      nutrition: {
        title: 'Track nutrition better',
        body: 'Meal logging stays practical with quick entry, visible impact, and no clutter.',
      },
    };

    const productData = {
      run: {
        title: 'Morning run session',
        body: 'Open Run, start tracking, and finish with a short review that confirms distance, pace context, and day impact.',
        action: 'Start A Run',
        signal: 'Elapsed time, distance, moving pace, and session quality indicators are captured automatically.',
        outcome: 'Run is logged once, contributes to Winning Day, and updates trend cards without manual cleanup.',
      },
      train: {
        title: 'Midday training block',
        body: 'Use Quick Log for workout or active rest, then verify progress instantly on Home and Log.',
        action: 'Log or track a workout of your choosing.',
        signal: 'Session count, active minutes, and required daily criteria update in real time.',
        outcome: 'You keep streak momentum without guessing what still needs to be done today.',
      },
      nutrition: {
        title: 'Evening nutrition closeout',
        body: 'Finish the day with food and hydration logging that shows what changed and what remains.',
        action: 'Add meal entries and hydration with portion-aware inputs and quick recents.',
        signal: 'Calories, protein, and water totals update immediately against your chosen targets.',
        outcome: 'Day closes with clear status and a stable record for weekly trend interpretation.',
      },
    };

    const data = window.location.pathname.startsWith('/product') ? productData : homeData;

    function setSegment(key) {
      segmentButtons.forEach((btn) => {
        const active = btn.getAttribute('data-segment-btn') === key;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      if (data[key]) {
        segmentTitle.textContent = data[key].title;
        segmentBody.textContent = data[key].body;
        if (segmentAction) segmentAction.textContent = data[key].action || '';
        if (segmentSignal) segmentSignal.textContent = data[key].signal || '';
        if (segmentOutcome) segmentOutcome.textContent = data[key].outcome || '';
      }
    }

    segmentButtons.forEach((btn) => {
      btn.addEventListener('click', () => setSegment(btn.getAttribute('data-segment-btn')));
    });

    setSegment(segmentButtons[0].getAttribute('data-segment-btn'));
  }

  // Features filtering + accordion
  const filterButtons = Array.from(document.querySelectorAll('[data-filter-chip]'));
  const featureCards = Array.from(document.querySelectorAll('[data-feature-card]'));

  function applyFilter(filter) {
    featureCards.forEach((card) => {
      const category = card.getAttribute('data-category');
      const status = card.getAttribute('data-status');
      const show = filter === 'all' || filter === category || filter === status;
      card.hidden = !show;
    });

    filterButtons.forEach((btn) => {
      const active = btn.getAttribute('data-filter-chip') === filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  if (filterButtons.length && featureCards.length) {
    filterButtons.forEach((btn) => {
      btn.addEventListener('click', () => applyFilter(btn.getAttribute('data-filter-chip')));
    });
    applyFilter('all');
  }

  const accordionButtons = Array.from(document.querySelectorAll('[data-accordion-toggle]'));
  accordionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panelId = btn.getAttribute('data-accordion-toggle');
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const isHidden = panel.hasAttribute('hidden');
      if (isHidden) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', String(isHidden));
    });
  });

  // Lightweight carousel auto-scroll for horizontal spotlight tables
  const carousel = document.querySelector('[data-carousel]');
  if (carousel) {
    let paused = false;
    let timer = null;

    function tick() {
      if (paused) return;
      const maxScroll = carousel.scrollWidth - carousel.clientWidth;
      if (maxScroll <= 0) return;
      const next = carousel.scrollLeft + Math.max(280, carousel.clientWidth * 0.72);
      carousel.scrollTo({
        left: next >= maxScroll ? 0 : next,
        behavior: 'smooth',
      });
    }

    function start() {
      if (timer) return;
      timer = window.setInterval(tick, 6500);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    carousel.addEventListener('mouseenter', () => { paused = true; });
    carousel.addEventListener('mouseleave', () => { paused = false; });
    carousel.addEventListener('focusin', () => { paused = true; });
    carousel.addEventListener('focusout', () => { paused = false; });
    carousel.addEventListener('touchstart', () => { paused = true; }, { passive: true });
    carousel.addEventListener('touchend', () => {
      window.setTimeout(() => { paused = false; }, 1200);
    }, { passive: true });

    start();
    window.addEventListener('beforeunload', stop);
  }

  // Support search with suggestions
  const searchInput = document.querySelector('[data-support-search]');
  const suggestWrap = document.querySelector('[data-support-suggestions]');
  const resultWrap = document.querySelector('[data-support-results]');
  const searchDataEl = document.getElementById('support-index-json');

  if (searchInput && suggestWrap && resultWrap && searchDataEl) {
    let index = [];
    try {
      index = JSON.parse(searchDataEl.textContent || '[]');
    } catch (err) {
      index = [];
    }

    function render(items, wrap, emptyText) {
      wrap.innerHTML = '';
      if (!items.length) {
        const div = document.createElement('div');
        div.className = 'notice';
        div.textContent = emptyText;
        wrap.appendChild(div);
        return;
      }
      items.forEach((item) => {
        const node = document.createElement('div');
        node.className = 'search-item';
        node.innerHTML = `<a href="${item.href}">${item.title}</a><div class="small">${item.desc}</div>`;
        wrap.appendChild(node);
      });
    }

    function updateSearch(value) {
      const q = value.trim().toLowerCase();
      if (!q) {
        render(index.slice(0, 5), suggestWrap, 'Start typing for support suggestions.');
        resultWrap.innerHTML = '';
        return;
      }

      const matches = index.filter((item) => {
        const hay = `${item.title} ${item.desc} ${item.tags.join(' ')}`.toLowerCase();
        return hay.includes(q);
      });

      render(matches.slice(0, 4), suggestWrap, 'No quick suggestions yet.');
      render(matches.slice(0, 8), resultWrap, 'No support articles matched that search.');
    }

    let searchDebounce = null;
    let analyticsDebounce = null;
    let lastSearchEventValue = null;

    function emitSearchEvent(rawValue) {
      const query = rawValue.trim().slice(0, 80);
      if (query.length < 2) return;
      if (query === lastSearchEventValue) return;
      lastSearchEventValue = query;
      emitAnalytics('support_search', { query });
    }

    searchInput.addEventListener('input', (e) => {
      const nextValue = e.target.value;
      if (analyticsDebounce) window.clearTimeout(analyticsDebounce);
      analyticsDebounce = window.setTimeout(() => {
        emitSearchEvent(nextValue);
      }, 260);

      if (searchDebounce) window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(() => {
        updateSearch(nextValue);
      }, 120);
    });

    updateSearch('');
  }

  // Guided flows progress
  const flows = Array.from(document.querySelectorAll('[data-flow]'));
  flows.forEach((flow) => {
    const checkboxes = Array.from(flow.querySelectorAll('input[type="checkbox"]'));
    const status = flow.querySelector('[data-flow-status]');
    const done = flow.querySelector('[data-flow-done]');
    if (!checkboxes.length || !status) return;

    function refresh() {
      const completeCount = checkboxes.filter((c) => c.checked).length;
      const total = checkboxes.length;
      if (completeCount > 0 && !flow.dataset.startedEventSent) {
        emitAnalytics('support_flow_started', { flow: flow.id || 'unnamed_flow' });
        flow.dataset.startedEventSent = 'true';
      }
      if (completeCount === total) {
        status.textContent = 'Nice. You completed every step in this flow.';
        status.classList.add('good');
        if (done) done.hidden = false;
        if (!flow.dataset.completedEventSent) {
          emitAnalytics('support_flow_completed', { flow: flow.id || 'unnamed_flow' });
          flow.dataset.completedEventSent = 'true';
        }
      } else {
        status.textContent = `Step progress: ${completeCount}/${total}`;
        status.classList.remove('good');
        if (done) done.hidden = true;
        flow.dataset.completedEventSent = '';
      }
    }

    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', refresh));
    refresh();
  });

  // Contact diagnostics autofill
  const diagConsent = document.querySelector('[data-diag-consent]');
  const diagField = document.querySelector('[data-diag-field]');
  if (diagConsent && diagField) {
    diagConsent.addEventListener('change', function () {
      if (!diagConsent.checked) {
        diagField.value = '';
        return;
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
      diagField.value = [
        `Browser: ${navigator.userAgent}`,
        `Language: ${navigator.language}`,
        `Timezone: ${tz}`,
        `Page: ${window.location.pathname}`,
      ].join('\n');
    });
  }

  const contactForm = document.querySelector('[data-contact-form]');
  const contactSuccess = document.querySelector('[data-contact-success]');
  const contactError = document.querySelector('[data-contact-error]');
  if (contactForm && contactSuccess) {
    const categoryField = contactForm.querySelector('[name=\"category\"]');
    const messageField = contactForm.querySelector('[name=\"message\"]');
    const topicTemplates = {
      gps: [
        'Issue type: GPS tracking',
        'When it happened:',
        'Device model + OS:',
        'What I expected:',
        'What happened instead:',
      ].join('\n'),
      billing: [
        'Issue type: Subscription restore / billing',
        'Account email:',
        'Purchase date:',
        'Device model + OS:',
        'What happened:',
      ].join('\n'),
      watch: [
        'Issue type: Wearable sync',
        'Wearable model:',
        'Last sync time:',
        'Phone model + OS:',
        'What I tried so far:',
      ].join('\n'),
      account: [
        'Issue type: Account access',
        'Account email:',
        'Device model + OS:',
        'What happened:',
      ].join('\n'),
    };

    try {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('category');
      const topic = (params.get('topic') || '').toLowerCase().trim();
      if (categoryField && requested) {
        const exists = Array.from(categoryField.options).some((opt) => opt.value === requested);
        if (exists) categoryField.value = requested;
      }
      if (messageField && topic && topicTemplates[topic] && !messageField.value.trim()) {
        messageField.value = topicTemplates[topic];
      }
    } catch (err) {
      // Ignore URL parse failures silently
    }

    contactForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const originalLabel = submitBtn ? submitBtn.textContent : 'Submit request';
      const fields = new FormData(contactForm);
      const payload = {
        name: String(fields.get('name') || '').trim(),
        email: String(fields.get('email') || '').trim(),
        category: String(fields.get('category') || '').trim(),
        message: String(fields.get('message') || '').trim(),
        diagnostics: String(fields.get('diagnostics') || '').trim(),
        company: String(fields.get('company') || '').trim(),
      };

      contactSuccess.hidden = true;
      if (contactError) contactError.hidden = true;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        let data = null;
        try {
          data = await res.json();
        } catch (err) {
          data = null;
        }

        if (!res.ok || !data || !data.ok) {
          const msg = (data && data.message) || 'We could not send your request right now. Please try again shortly.';
          if (contactError) {
            contactError.textContent = msg;
            contactError.hidden = false;
          }
          return;
        }

        contactSuccess.hidden = false;
        emitAnalytics('contact_submitted', { category: payload.category || '' });
        contactForm.reset();
        if (diagField) diagField.value = '';
        if (diagConsent) diagConsent.checked = false;
      } catch (err) {
        if (contactError) {
          contactError.textContent = 'Network error while sending your request. Please try again or email support@zenithfit.app.';
          contactError.hidden = false;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    });
  }
})();
