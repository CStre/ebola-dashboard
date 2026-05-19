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
    const t = data.totals;
    const p = data.totals_previous || {};
    const map = {
      'stat-confirmed': t.confirmed,
      'stat-suspected': t.suspected,
      'stat-deaths': t.deaths,
      'stat-zones': t.health_zones_affected,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) animateCounter(el, value);
    });

    const deltas = [
      ['badge-confirmed', t.confirmed - (p.confirmed ?? t.confirmed)],
      ['badge-suspected', t.suspected - (p.suspected ?? t.suspected)],
      ['badge-deaths', t.deaths - (p.deaths ?? t.deaths)],
      ['badge-zones', t.health_zones_affected - (p.health_zones_affected ?? t.health_zones_affected)],
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

  function renderSources(sources = []) {
    const root = document.getElementById('source-list');
    if (!root) return;
    root.innerHTML = '';
    sources.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      root.appendChild(li);
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

      renderStats(data);
      renderAlerts(data.alerts);
      buildMap(data.locations);
      buildCumulativeChart(data.history_snapshots);
      buildLocationChart(data.locations);
      buildZonesChart(data.history_snapshots);
      buildCfrChart(data.totals);
      renderTimeline(data.timeline);
      renderContext(history);
      renderSources(data.meta?.data_sources || []);

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
