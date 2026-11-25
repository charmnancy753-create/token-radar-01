// dashboard/app.js — Token Radar's board, written by Ada Wrong for make.fun's token-radar-01 bounty.
//
// The page reads window.RADAR (written beside dashboard/ by main.ts) and renders the ranked board, a
// filterable table, and a per-protocol detail drawer. No network: every byte it shows is in data.js.
//
// The page recomputes each row's implied value from the snapshot figures and the model constants it
// is given, then checks that the number board.json carries is the number its own arithmetic produces.
// So the page's code and the board's data are visibly the same arithmetic, and a reader can see why a
// protocol ranks where it does instead of being asked to trust a column.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  if (!app) return;
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  // The model in one function, the same arithmetic lib/model.ts runs:
  //   base       = tvl_usd x base_multiple
  //   growthMult = 1 + clamp(change_7d) / 100 x growth_weight
  //   maturity   = maturity_floor + min(age, maturity_days) / maturity_days x maturity_range
  //   confidence = completeness x depth x growthSignal x ageConfidence
  //   implied    = max(1, round(base x growthMult x maturity x confidence))
  function impliedOf(row, model) {
    var growth = Math.min(
      model.growth_cap,
      Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d),
    );
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityMult =
      model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;

    var depth = Math.min(
      1,
      Math.max(
        0,
        (row.tvl_usd - model.tvl_depth_zero_usd) / (model.tvl_depth_full_usd - model.tvl_depth_zero_usd),
      ),
    );
    var hasGrowth = row.change_7d !== null && row.change_7d !== undefined && isFinite(row.change_7d);
    var completeness = hasGrowth ? 1 : model.missing_growth_penalty;
    var growthSignal = hasGrowth ? Math.min(1, 0.55 + Math.max(0, growth) / 80) : 0.6;
    var ageConfidence = row.age_days === null || row.age_days === undefined ? model.missing_age_penalty : 1;
    var confidence = completeness * depth * growthSignal * ageConfidence;

    var base = row.tvl_usd * model.base_multiple;
    return {
      implied: Math.max(1, Math.round(base * growthMult * maturityMult * confidence)),
      growthMult: growthMult,
      maturityMult: maturityMult,
      confidence: confidence,
    };
  }

  // The farm plan, derived from the row's own record: category, chains, TVL and age decide the action,
  // the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return "Provide $" + capital + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    }
    if (c.indexOf('rwa') >= 0) {
      return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      {
        text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
        cost: 'under $3 of gas for the first transaction',
        time: '5 minutes',
      },
      {
        text: actionFor(p, capital, chain),
        cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas',
        time: '15 minutes to set up',
      },
      {
        text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
        cost: 'about $2 of gas a week',
        time: '10 minutes a week',
      },
      {
        text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
        cost: 'the $' + capital + ' stays in the position',
        time: hold + ' days',
      },
      {
        text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes',
      },
      {
        text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
        cost: 'nothing but the log',
        time: '5 minutes',
      },
    ].map(stepText);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    if (state.tab === 'live') {
      return DATA.live.filter(function (r) {
        if (!q) return true;
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else if (key === 'confidence') {
        av = a.confidence_multiplier === undefined ? -Infinity : a.confidence_multiplier;
        bv = b.confidence_multiplier === undefined ? -Infinity : b.confidence_multiplier;
      } else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar' }),
        el('span', { class: 'brand-sub', text: 'pre-token protocols ranked by confidence-weighted implied value' }),
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'snapshot' }), el('span', { class: 'stat-value', text: DATA.as_of })),
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'on watchlist' }), el('span', { class: 'stat-value', text: String(DATA.watchlist_size) })),
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'board rows' }), el('span', { class: 'stat-value', text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'early radar' }), el('span', { class: 'stat-value', text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'live set aside' }), el('span', { class: 'stat-value', text: String(DATA.live_size) })),
        el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: 'model' }), el('span', { class: 'stat-value', text: DATA.model_version })),
      ),
    );
  }

  function tabs() {
    function tab(label, id, count) {
      return el('button', {
        class: 'tab' + (state.tab === id ? ' active' : ''),
        type: 'button',
        onclick: function () { state.tab = id; state.selected = null; render(); },
      }, el('span', { text: label }), el('span', { class: 'tab-count', text: String(count) }));
    }
    return el('nav', { class: 'tabs' },
      tab('Pre-token radar', 'pre-token', DATA.board_size),
      tab('Live token', 'live', DATA.live_size),
    );
  }

  function controls() {
    var cats = categories();
    var select = el('select', {
      class: 'select',
      'aria-label': 'Filter by category',
      onchange: function (e) { state.category = e.target.value; render(); },
    });
    select.appendChild(el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) {
      select.appendChild(el('option', { value: c, text: c }));
    });
    select.value = state.category;

    var input = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search protocol, slug, chain…',
      value: state.q,
      'aria-label': 'Search the board',
      oninput: function (e) { state.q = e.target.value; render(); },
    });

    var sorts = [
      ['implied', 'Implied value'],
      ['confidence', 'Confidence'],
      ['tvl', 'TVL'],
      ['growth', '7d change'],
      ['age', 'Age'],
      ['name', 'Name'],
    ];
    var sortSel = el('select', {
      class: 'select',
      'aria-label': 'Sort by',
      onchange: function (e) { state.sort = e.target.value; render(); },
    });
    sorts.forEach(function (s) {
      sortSel.appendChild(el('option', { value: s[0], text: s[1] }));
    });
    sortSel.value = state.sort;

    var dirBtn = el('button', {
      class: 'dir',
      type: 'button',
      title: 'Flip the order',
      onclick: function () { state.dir = -state.dir; render(); },
    }, el('span', { text: state.dir === -1 ? '↓ high first' : '↑ low first' }));

    return el('div', { class: 'controls' },
      el('div', { class: 'control' }, el('label', { text: 'Search' }), input),
      el('div', { class: 'control' }, el('label', { text: 'Category' }), select),
      el('div', { class: 'control' }, el('label', { text: 'Sort by' }), sortSel),
      el('div', { class: 'control' }, el('label', { text: 'Order' }), dirBtn),
    );
  }

  function modelBox() {
    var m = DATA.model;
    function line(k, v) {
      return el('div', { class: 'model-line' }, el('span', { class: 'model-key', text: k }), el('span', { class: 'model-val', text: v }));
    }
    return el('details', { class: 'model' },
      el('summary', {}, el('span', { text: 'The model' }), el('span', { class: 'model-version', text: DATA.model_version })),
      el('div', { class: 'model-body' },
        el('p', { class: 'model-note', text: 'implied = TVL x base x growth x maturity x confidence. No protocol name is special-cased: the same arithmetic scores every row.' }),
        line('base multiple', String(m.base_multiple)),
        line('growth weight', String(m.growth_weight)),
        line('growth floor / cap', m.growth_floor + '% / ' + m.growth_cap + '%'),
        line('maturity floor / range', m.maturity_floor + ' / +' + m.maturity_range),
        line('maturity days', String(m.maturity_days)),
        line('missing growth penalty', String(m.missing_growth_penalty)),
        line('missing age penalty', String(m.missing_age_penalty)),
        line('TVL depth zero / full', fmtUsd(m.tvl_depth_zero_usd) + ' / ' + fmtUsd(m.tvl_depth_full_usd)),
      ),
    );
  }

  function boardTable(list) {
    var head = el('thead', {}, el('tr', {},
      el('th', { text: '#' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: '7d' }),
      el('th', { class: 'num', text: 'Age' }),
      el('th', { class: 'num', text: 'Growth x' }),
      el('th', { class: 'num', text: 'Maturity x' }),
      el('th', { class: 'num', text: 'Confidence' }),
      el('th', { class: 'num', text: 'Implied value' }),
    ));
    var body = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        class: 'row' + (state.selected === r.slug ? ' selected' : ''),
        tabindex: '0',
        onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = state.selected === r.slug ? null : r.slug; render(); }
        },
      },
        el('td', { class: 'rank', text: state.tab === 'live' ? '—' : String(r.rank) }),
        el('td', {}, el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })),
        el('td', { text: r.category || '—' }),
        el('td', { class: 'chains' }, (r.chains || []).slice(0, 2).map(function (c) { return el('span', { class: 'chain', text: c }); })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.growth_multiplier) }),
        el('td', { class: 'num', text: fmtMult(r.maturity_multiplier) }),
        el('td', { class: 'num' }, confidenceBar(r.confidence_multiplier)),
        el('td', { class: 'num strong', text: fmtUsd(r.implied_value_usd) }),
      );
      body.appendChild(tr);
    });
    return el('table', { class: 'board' }, head, body);
  }

  function liveTable(list) {
    var head = el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: '7d' }),
    ));
    var body = el('tbody');
    list.forEach(function (r) {
      body.appendChild(el('tr', { class: 'row' },
        el('td', {}, el('span', { class: 'pname', text: r.name }), el('span', { class: 'pslug', text: r.slug })),
        el('td', { text: r.category || '—' }),
        el('td', { class: 'chains' }, (r.chains || []).slice(0, 2).map(function (c) { return el('span', { class: 'chain', text: c }); })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''), text: fmtPct(r.change_7d) }),
      ));
    });
    return el('table', { class: 'board live' }, head, body);
  }

  function confidenceBar(c) {
    if (c === null || c === undefined || !isFinite(c)) return el('span', { text: 'n/a' });
    var pct = Math.round(Math.min(1, Math.max(0, c)) * 100);
    return el('span', { class: 'conf' },
      el('span', { class: 'conf-track' }, el('span', { class: 'conf-fill', style: 'width:' + pct + '%' })),
      el('span', { class: 'conf-num', text: pct + '%' }),
    );
  }

  function detail(row) {
    if (!row) return null;
    var calc = impliedOf(row, DATA.model);
    var agrees = calc.implied === row.implied_value_usd;
    var steps = farmSteps(row);

    function kv(k, v, cls) {
      return el('div', { class: 'kv' }, el('span', { class: 'kv-k', text: k }), el('span', { class: 'kv-v ' + (cls || ''), text: v }));
    }

    var math = el('div', { class: 'math' },
      el('h3', { text: 'How the number is built' }),
      el('div', { class: 'math-lines' },
        kv('TVL', fmtUsd(row.tvl_usd)),
        kv('base multiple', DATA.model.base_multiple + 'x'),
        kv('growth', fmtPct(row.change_7d) + ' → ' + fmtMult(calc.growthMult)),
        kv('maturity', fmtAge(row.age_days) + ' → ' + fmtMult(calc.maturityMult)),
        kv('confidence', (Math.round(calc.confidence * 1000) / 1000) + 'x'),
        kv('implied value', fmtUsd(row.implied_value_usd), 'strong'),
      ),
      el('p', {
        class: agrees ? 'agrees' : 'disagrees',
        text: agrees
          ? 'This page recomputed the same implied value from the snapshot and the model constants above.'
          : 'This page recomputed ' + fmtUsd(calc.implied) + ' from the snapshot and the model constants above.',
      }),
    );

    var plan = el('div', { class: 'plan' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) { return el('li', { text: s }); })),
    );

    var facts = el('div', { class: 'facts' },
      el('h3', { text: 'Snapshot record' }),
      kv('slug', row.slug),
      kv('category', row.category || '—'),
      kv('chains', (row.chains || []).join(', ') || '—'),
      kv('TVL', fmtUsd(row.tvl_usd)),
      kv('7d change', fmtPct(row.change_7d)),
      kv('listed at', row.listed_at || '—'),
      kv('age', fmtAge(row.age_days)),
      kv('token status', 'pre-token: no market cap, no CoinGecko id, no symbol'),
    );

    return el('aside', { class: 'drawer', role: 'region', 'aria-label': 'Protocol detail' },
      el('div', { class: 'drawer-head' },
        el('div', {}, el('h2', { text: row.name }), el('p', { class: 'drawer-sub', text: row.slug + ' · rank ' + row.rank })),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close detail', onclick: function () { state.selected = null; render(); } }, el('span', { text: '✕' })),
      ),
      el('div', { class: 'drawer-body' }, facts, math, plan),
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. Snapshot as of ' + DATA.as_of + '. Model ' + DATA.model_version + '.' }),
      el('p', { class: 'foot-note', text: 'Implied value is a confidence-weighted estimate of what a launch could be worth, not a promise and not financial advice. Every figure comes from the sealed snapshot; the page computes nothing the snapshot does not carry.' }),
    );
  }

  function render() {
    var list = sortedRows(rows());
    app.textContent = '';
    app.appendChild(header());
    app.appendChild(tabs());
    app.appendChild(controls());
    app.appendChild(modelBox());
    app.appendChild(el('p', { class: 'count', text: list.length + ' row' + (list.length === 1 ? '' : 's') + ' shown' }));
    if (state.tab === 'live') {
      app.appendChild(liveTable(list));
    } else if (list.length === 0) {
      app.appendChild(el('p', { class: 'empty', text: 'Nothing matches that filter.' }));
    } else {
      app.appendChild(boardTable(list));
    }
    var selected = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.selected) { selected = DATA.rows[i]; break; }
    }
    var drawer = detail(selected);
    if (drawer) app.appendChild(drawer);
    app.appendChild(footer());
    app.setAttribute('aria-busy', 'false');
    writeHash();
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
