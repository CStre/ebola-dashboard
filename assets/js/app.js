(() => {
  'use strict';

  const DATA_URL = 'data/outbreak.json';
  const HISTORY_URL = 'data/history.json';
  const REFRESH_MS = 30 * 60 * 1000;

  const ACCENT = '#ff5252';
  const ACCENT_2 = '#ff8a3d';
  const INFO = '#5aa9ff';
  const WARN = '#ffb547';
  const OK = '#4ade80';
  const TEXT_DIM = '#a3adc2';
  const GRID = 'rgba(255,255,255,0.06)';

  Chart.defaults.color = TEXT_DIM;
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = GRID;

  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
  };

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  function setupReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('visible'));
      return;
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => obs.observe(el));
  }

  function animateCounter(el, target, duration = 1400) {
    const start = performance.now();
    const initial = 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const value = Math.round(initial + (target - initial) * ease(t));
      el.textContent = fmt(value);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderStats(data) {
    const t = data.totals || {};
    const p = data.totals_previous || {};
    const map = {
      'stat-confirmed': t.confirmed ?? 0,
      'stat-suspected': t.suspected ?? 0,
      'stat-deaths': t.deaths ?? 0,
      'stat-zones': t.health_zones_affected ?? 0,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) animateCounter(el, value);
    });

    const deltas = [
      ['badge-confirmed', (t.confirmed ?? 0) - (p.confirmed ?? t.confirmed ?? 0)],
      ['badge-suspected', (t.suspected ?? 0) - (p.suspected ?? t.suspected ?? 0)],
      ['badge-deaths', (t.deaths ?? 0) - (p.deaths ?? t.deaths ?? 0)],
      ['badge-zones', (t.health_zones_affected ?? 0) - (p.health_zones_affected ?? t.health_zones_affected ?? 0)],
    ];
    deltas.forEach(([id, delta]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (delta === 0) {
        el.textContent = 'no change';
        el.className = 'badge';
      } else if (delta > 0) {
        el.textContent = `+${fmt(delta)} since last`;
        el.className = 'badge up';
      } else {
        el.textContent = `${fmt(delta)} since last`;
        el.className = 'badge down';
      }
    });

    renderStatFooters(data);
  }

  function countCountries(data) {
    const t = data.totals || {};
    if (typeof t.countries_with_cases === 'number') return t.countries_with_cases;
    const set = new Set();
    (data.locations || []).forEach((l) => {
      if (l.status === 'active' && l.country) set.add(l.country);
    });
    return set.size || '—';
  }

  function listCountries(data) {
    const set = new Set();
    (data.locations || []).forEach((l) => {
      if (l.status === 'active' && l.country) set.add(l.country);
    });
    const arr = [...set];
    if (arr.length === 0) return '—';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
    return `${arr.slice(0, -1).join(', ')} & ${arr[arr.length - 1]}`;
  }

  function renderStatFooters(data) {
    const t = data.totals || {};
    const meta = data.meta || {};
    const disease = (meta.disease || 'Bundibugyo virus').replace(/^Ebola disease \(|\)$/g, '').replace(/^Ebola /, '');

    const footers = {
      'footer-confirmed': `Lab-confirmed ${disease}`,
      'footer-suspected': `${t.suspected ? 'Awaiting laboratory confirmation' : 'No suspected cases reported'}`,
      'footer-deaths': t.healthcare_worker_deaths
        ? `Including ${fmt(t.healthcare_worker_deaths)} healthcare worker${t.healthcare_worker_deaths === 1 ? '' : 's'}`
        : 'Reported deaths to date',
      'footer-zones': `Across ${listCountries(data)}`,
    };
    Object.entries(footers).forEach(([id, text]) => setText(id, text));
  }

  function renderHeroMeta(data) {
    const meta = data.meta || {};
    const phase = meta.phase || 'Active outbreak';
    const declared = meta.declared_at ? new Date(meta.declared_at) : null;
    const declaredStr = declared && !isNaN(declared)
      ? declared.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    setText('hero-eyebrow-text', declaredStr ? `${phase} · declared ${declaredStr}` : phase);

    const countries = listCountries(data);
    const sub = `A real-time tracker for the 2026 outbreak across ${countries}. Data refreshed every four hours from WHO, CDC, Africa CDC, and other credible sources.`;
    setText('hero-sub', sub);
  }

  function renderAlerts(alerts = []) {
    const root = document.getElementById('alerts');
    if (!root) return;
    root.innerHTML = '';
    alerts.forEach((a) => {
      const div = document.createElement('div');
      div.className = `alert alert-${a.level || 'info'}`;
      const glyph = a.level === 'critical' ? '!' : a.level === 'warning' ? '⚠' : 'i';
      const link = a.url
        ? `<a class="alert-link" href="${a.url}" target="_blank" rel="noopener">${a.source || 'source'} ↗</a>`
        : `<span class="alert-link">${a.source || ''}</span>`;
      div.innerHTML = `
        <div class="alert-icon">${glyph}</div>
        <div>
          <h4>${a.title}</h4>
          <p>${a.body}</p>
        </div>
        ${link}
      `;
      root.appendChild(div);
    });
  }

  function tierToClass(tier) {
    if (tier === 'new') return 'new';
    if (tier === 'epicenter' || tier === 'high') return 'high';
    if (tier === 'international') return 'intl';
    if (tier === 'retracted') return 'retracted';
    return 'high';
  }

  function buildMap(locations = []) {
    const map = L.map('leaflet-map', { zoomControl: true, attributionControl: true })
      .setView([0.5, 25], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    const bounds = [];
    locations.forEach((loc) => {
      const tierClass = tierToClass(loc.tier);
      const isPulsing = loc.tier === 'new';
      const html = isPulsing
        ? `<div class="marker-pulse"></div>`
        : `<div class="marker-static ${tierClass}"></div>`;
      const icon = L.divIcon({
        className: 'custom-marker',
        html,
        iconSize: [isPulsing ? 18 : 16, isPulsing ? 18 : 16],
        iconAnchor: [isPulsing ? 9 : 8, isPulsing ? 9 : 8],
      });
      const marker = L.marker([loc.lat, loc.lon], { icon }).addTo(map);
      const tagLabel = ({
        new: 'New · last 24h',
        epicenter: 'Epicenter',
        high: 'Active hotspot',
        international: 'International',
        retracted: 'Retracted',
      })[loc.tier] || 'Active';
      marker.bindPopup(`
        <h4>${loc.name}</h4>
        <div class="pop-region">${loc.region || ''} · ${loc.country || ''}</div>
        <div class="pop-tag ${tierClass}">${tagLabel}</div>
        <div>${loc.notes || ''}</div>
        ${loc.first_reported ? `<div style="margin-top:8px;color:#a3adc2;font-size:11px;">First reported: ${loc.first_reported}</div>` : ''}
      `);
      bounds.push([loc.lat, loc.lon]);
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 7 });
    }
  }

  function buildCumulativeChart(snapshots = []) {
    const ctx = document.getElementById('chart-cumulative');
    if (!ctx) return;
    const labels = snapshots.map((s) => s.date);
    const cases = snapshots.map((s) => s.confirmed + s.suspected);
    const deaths = snapshots.map((s) => s.deaths);
    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Cases (confirmed + suspected)',
            data: cases,
            borderColor: ACCENT_2,
            backgroundColor: 'rgba(255,138,61,0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: ACCENT_2,
          },
          {
            label: 'Deaths',
            data: deaths,
            borderColor: ACCENT,
            backgroundColor: 'rgba(255,82,82,0.10)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: ACCENT,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 10 } } },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: TEXT_DIM } },
          y: { grid: { color: GRID }, ticks: { color: TEXT_DIM }, beginAtZero: true },
        },
      },
    });
  }

  function buildLocationChart(locations = []) {
    const ctx = document.getElementById('chart-by-location');
    if (!ctx) return;
    const active = locations.filter((l) => l.status === 'active');
    const labels = active.map((l) => l.name);
    const data = active.map(() => 1);
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Active locations',
          data,
          backgroundColor: active.map((l) => {
            const t = tierToClass(l.tier);
            return t === 'new' ? ACCENT : t === 'intl' ? INFO : t === 'high' ? ACCENT_2 : WARN;
          }),
          borderRadius: 6,
          barPercentage: 0.7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => active[c.dataIndex].notes || '' } } },
        scales: {
          x: { display: false, beginAtZero: true },
          y: { grid: { display: false }, ticks: { color: TEXT_DIM } },
        },
      },
    });
  }

  function buildZonesChart(snapshots = []) {
    const ctx = document.getElementById('chart-zones');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: snapshots.map((s) => s.date),
        datasets: [{
          label: 'Health zones affected',
          data: snapshots.map((s) => s.health_zones),
          backgroundColor: INFO,
          borderRadius: 8,
          barPercentage: 0.5,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: TEXT_DIM } },
          y: { grid: { color: GRID }, ticks: { color: TEXT_DIM }, beginAtZero: true },
        },
      },
    });
  }

  function buildCfrChart(totals) {
    const ctx = document.getElementById('chart-cfr');
    if (!ctx) return;
    const total = totals.confirmed + totals.suspected;
    const deaths = totals.deaths;
    const surviving = Math.max(0, total - deaths);
    const cfr = total > 0 ? ((deaths / total) * 100).toFixed(1) : '—';
    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Deaths', 'Alive / unknown outcome'],
        datasets: [{
          data: [deaths, surviving],
          backgroundColor: [ACCENT, 'rgba(255,255,255,0.08)'],
          borderColor: 'transparent',
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10 } },
        },
      },
      plugins: [{
        id: 'centerText',
        beforeDraw(chart) {
          const { ctx, chartArea: { left, right, top, bottom } } = chart;
          const x = (left + right) / 2;
          const y = (top + bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.fillStyle = '#e8ecf5';
          ctx.font = '600 28px Inter, sans-serif';
          ctx.fillText(`${cfr}%`, x, y);
          ctx.fillStyle = TEXT_DIM;
          ctx.font = '500 11px Inter, sans-serif';
          ctx.fillText('Case fatality (current)', x, y + 22);
          ctx.restore();
        },
      }],
    });
    return chart;
  }

  function renderTimeline(items = []) {
    const root = document.getElementById('timeline-list');
    if (!root) return;
    root.innerHTML = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="t-date">${item.date}</span><span class="t-event">${item.event}</span>`;
      root.appendChild(li);
    });
  }

  function renderContext(history) {
    const facts = history.background || {};
    const dl = document.getElementById('virus-facts');
    if (dl) {
      dl.innerHTML = '';
      const factsList = [
        ['Virus', facts.virus],
        ['Family', facts.family],
        ['Discovered', facts.discovery],
        ['Historic CFR', facts.case_fatality_rate_historical],
        ['Incubation', facts.incubation_days ? `${facts.incubation_days} days` : ''],
      ];
      factsList.forEach(([k, v]) => {
        if (!v) return;
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = k;
        dd.textContent = v;
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
    }

    const past = document.getElementById('past-outbreaks');
    if (past) {
      past.innerHTML = '';
      (history.past_outbreaks || []).forEach((o) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${o.year}</strong> · ${o.location}<span class="sub">${fmt(o.cases)} cases · ${fmt(o.deaths)} deaths · CFR ${o.cfr}</span>`;
        past.appendChild(li);
      });
    }

    const why = document.getElementById('why-matters');
    if (why) {
      why.innerHTML = '';
      (history.why_this_matters || []).forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        why.appendChild(li);
      });
    }
  }

  function renderSources(data) {
    const list = document.getElementById('source-list');
    const summary = document.getElementById('source-summary');
    const meta = data.meta || {};
    const sources = meta.data_sources || [];
    const xref = meta.cross_references || {};

    if (summary) {
      summary.innerHTML = '';
      const summaryItems = [
        { label: 'Sources consulted', value: sources.length, detail: 'In this refresh' },
        { label: 'Independent confirmations', value: xref.confirmations_for_totals || sources.length, detail: 'Of headline figures' },
        { label: 'Primary sources', value: xref.primary_count || countPrimary(sources), detail: 'WHO, CDC, Africa CDC, MoH' },
        { label: 'Wire / news', value: xref.wire_count || (sources.length - countPrimary(sources)), detail: 'Reuters, AP, AFP, etc.' },
      ];
      summaryItems.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'source-summary-card';
        card.innerHTML = `
          <span class="ss-label">${item.label}</span>
          <span class="ss-value">${fmt(item.value)}</span>
          <span class="ss-detail">${item.detail}</span>
        `;
        summary.appendChild(card);
      });
    }

    if (!list) return;
    list.innerHTML = '';
    sources.forEach((s) => {
      const li = document.createElement('li');
      const parsed = parseSourceLine(s);
      if (parsed.url) {
        li.innerHTML = `
          <a href="${parsed.url}" target="_blank" rel="noopener">${parsed.label} ↗</a>
          <span class="src-domain">${parsed.domain}${parsed.date ? ' · ' + parsed.date : ''}</span>
        `;
      } else {
        li.innerHTML = `
          <span>${parsed.label}</span>
          ${parsed.domain ? `<span class="src-domain">${parsed.domain}${parsed.date ? ' · ' + parsed.date : ''}</span>` : ''}
        `;
      }
      list.appendChild(li);
    });
  }

  function countPrimary(sources) {
    const primary = /who\.int|cdc\.gov|africacdc|moh|ministry|inrb|government|gov\./i;
    return sources.filter((s) => primary.test(s)).length;
  }

  function parseSourceLine(line) {
    const urlMatch = line.match(/(https?:\/\/[^\s)]+)/);
    const domainMatch = line.match(/\(([^)]*?\.[a-z]{2,})[^)]*?\)/i) || line.match(/\b([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/i);
    const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const labelRaw = line.replace(/\([^)]*\)/g, '').replace(/https?:\/\/\S+/g, '').trim();
    return {
      label: labelRaw || line,
      url: urlMatch ? urlMatch[1] : null,
      domain: domainMatch ? domainMatch[1] : null,
      date: dateMatch ? dateMatch[1] : null,
    };
  }

  function renderNews(items = []) {
    const root = document.getElementById('news-grid');
    if (!root) return;
    root.innerHTML = '';
    if (items.length === 0) {
      root.innerHTML = '<p style="color:var(--text-faint);font-size:14px;">News will appear here after the next data refresh.</p>';
      return;
    }
    items.forEach((item) => {
      const card = document.createElement('a');
      card.className = 'news-card';
      card.href = item.url || '#';
      if (item.url) {
        card.target = '_blank';
        card.rel = 'noopener';
      }
      const date = item.date || item.published || '';
      const tags = (item.tags || []).map((t) => `<span class="news-tag${t.toLowerCase().includes('confirm') ? ' confirmed' : ''}">${t}</span>`).join('');
      card.innerHTML = `
        <div class="news-meta">
          <span class="news-source">${item.source || 'Source'}</span>
          <span>${date}</span>
        </div>
        <h4>${item.title || 'Untitled'}</h4>
        <p>${item.summary || ''}</p>
        ${tags ? `<div class="news-tags">${tags}</div>` : ''}
      `;
      root.appendChild(card);
    });
  }

  function setStatus(state, text) {
    const pill = document.getElementById('status-pill');
    if (!pill) return;
    pill.classList.remove('ok', 'err');
    if (state === 'ok') pill.classList.add('ok');
    if (state === 'err') pill.classList.add('err');
    pill.querySelector('.status-text').textContent = text;
  }

  async function loadData() {
    setStatus('', 'Loading…');
    try {
      const bust = `?t=${Date.now()}`;
      const [dataRes, histRes] = await Promise.all([
        fetch(DATA_URL + bust),
        fetch(HISTORY_URL + bust),
      ]);
      if (!dataRes.ok) throw new Error('Failed to load outbreak data');
      const data = await dataRes.json();
      const history = histRes.ok ? await histRes.json() : {};

      setText('last-updated', fmtDate(data.meta?.last_updated));
      setText('next-update', fmtDate(data.meta?.next_update));
      setText('footer-updated', `Last refresh ${fmtDate(data.meta?.last_updated)}`);

      renderHeroMeta(data);
      renderStats(data);
      renderAlerts(data.alerts);
      buildMap(data.locations);
      buildCumulativeChart(data.history_snapshots);
      buildLocationChart(data.locations);
      buildZonesChart(data.history_snapshots);
      buildCfrChart(data.totals || {});
      renderTimeline(data.timeline);
      renderContext(history);
      renderNews(data.news || []);
      renderSources(data);

      setStatus('ok', 'Live');
    } catch (err) {
      console.error(err);
      setStatus('err', 'Data unavailable');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupReveal();
    loadData();
    setInterval(loadData, REFRESH_MS);
  });
})();
