/* ریاضی روزمره — رفتار صفحه */
(function () {
  'use strict';

  var root = document.documentElement;
  var faNum = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
  var faInt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });

  /* ---------- ابزارهای عدد ---------- */
  // ارقام فارسی/عربی و جداکننده‌ها را به عدد معمولی تبدیل می‌کند
  function toLatin(str) {
    return String(str)
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 0x06F0; })
      .replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 0x0660; })
      .replace(/[٫\/]/g, '.')             // ممیز فارسی یا اسلش
      .replace(/[٬,،\s]/g, '');      // جداکننده هزارگان
  }
  function parseNum(str) {
    var clean = toLatin(str);
    if (clean === '' || !/^\d*\.?\d*$/.test(clean) || clean === '.') return NaN;
    return parseFloat(clean);
  }
  function toFaDigits(str) {
    return String(str).replace(/\d/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); });
  }

  /* ---------- تم روشن/تیره ---------- */
  var themeBtn = document.getElementById('theme-toggle');
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    themeBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  themeBtn.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
  themeBtn.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  /* ---------- منوی موبایل ---------- */
  var menuBtn = document.getElementById('menu-btn');
  var nav = document.getElementById('main-nav');
  function setMenu(open) {
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  menuBtn.addEventListener('click', function () {
    setMenu(menuBtn.getAttribute('aria-expanded') !== 'true');
  });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.site-header')) setMenu(false);
  });

  /* ---------- تخفیف‌یاب (فقط صفحه‌ی اصلی) ---------- */
  function initCalc() {
    var priceEl = document.getElementById('price');
    if (!priceEl) return;
    var percentEl = document.getElementById('percent');
    var outOff = document.getElementById('out-off');
    var outFinal = document.getElementById('out-final');
    var explain = document.getElementById('calc-explain');
    var barFill = document.getElementById('bar-fill');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));

    function money(n) { return faInt.format(n) + ' <small>تومان</small>'; }

    function calc() {
      var price = parseNum(priceEl.value);
      var percent = parseNum(percentEl.value);
      var tooBig = percent > 100;
      percentEl.setAttribute('aria-invalid', tooBig ? 'true' : 'false');
      if (tooBig) percent = 100;

      chips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(Number(c.dataset.p) === percent));
      });

      if (isNaN(price) || isNaN(percent)) {
        outOff.textContent = '—';
        outFinal.textContent = '—';
        explain.textContent = 'قیمت و درصد تخفیف را بنویس.';
        barFill.style.width = '0%';
        return;
      }
      var off = Math.round(price * percent / 100);
      var final = price - off;
      outOff.innerHTML = money(off);
      outFinal.innerHTML = money(final);
      explain.innerHTML = '<span class="eq">' + faNum.format(price) + ' × ' + faNum.format(percent) + ' ÷ ۱۰۰ = ' + faInt.format(off) + '</span> تومان تخفیف';
      barFill.style.width = (price > 0 ? Math.max(0, Math.min(100, final / price * 100)) : 0) + '%';
    }

    // قیمت: با هر تایپ، هزارگان و ارقام فارسی را اعمال می‌کند و جای نشانگر را نگه می‌دارد
    priceEl.addEventListener('input', function () {
      var raw = priceEl.value;
      var caret = priceEl.selectionStart == null ? raw.length : priceEl.selectionStart;
      var digitsBefore = toLatin(raw.slice(0, caret)).replace(/\D/g, '').length;

      var intPart = toLatin(raw).replace(/[^\d]/g, '');
      var formatted = intPart === '' ? '' : toFaDigits(Number(intPart).toLocaleString('en-US').replace(/,/g, '٬'));
      priceEl.value = formatted;

      var pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/[۰-۹]/.test(formatted[pos])) seen++;
        pos++;
      }
      try { priceEl.setSelectionRange(pos, pos); } catch (e) {}
      calc();
    });

    // درصد: فقط ارقام و ممیز، با ارقام فارسی
    percentEl.addEventListener('input', function () {
      var clean = toLatin(percentEl.value).replace(/[^\d.]/g, '').replace(/^(\d*\.\d*).*$/, '$1');
      percentEl.value = toFaDigits(clean).replace(/\./g, '٫');
      calc();
    });

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        percentEl.value = toFaDigits(chip.dataset.p);
        calc();
      });
    });
    document.getElementById('calc-form').addEventListener('submit', function (e) { e.preventDefault(); });
    calc();
  }
  initCalc();

  /* ---------- ترفندهای سرانگشتی ---------- */
  var tricks = [
    {
      title: '۱۰٪ هر عدد؛ فقط یک رقم عقب‌تر',
      text: 'برای ۱۰٪ هر عدد، ممیز را یک رقم به چپ ببر. اگر عدد به صفر ختم می‌شود، یعنی همان صفر آخرش را بردار.',
      example: '۱۰٪ از ۴۵٬۰۰۰ = <b>۴٬۵۰۰</b>'
    },
    {
      title: '۱۵٪ برای انعام یا مالیات',
      text: 'اول ۱۰٪ را پیدا کن، بعد نصفِ آن را به آن اضافه کن. ۱۵٪ یعنی ۱۰٪ و ۵٪ با هم.',
      example: '۱۵٪ از ۸۰٬۰۰۰: <span class="eq">۸٬۰۰۰ + ۴٬۰۰۰ = <b>۱۲٬۰۰۰</b></span>'
    },
    {
      title: 'ضرب در ۵ را نصف کردن حساب کن',
      text: 'عدد را در ۱۰ ضرب کن (یک صفر کنارش بگذار) و بعد نصف کن. چون ۵ همان نصفِ ۱۰ است.',
      example: '<span class="eq">۴۶ × ۱۰ = ۴۶۰</span> سپس <span class="eq">۴۶۰ ÷ ۲ = <b>۲۳۰</b></span>'
    },
    {
      title: 'ضرب در ۹ را از ۱۰ قرض بگیر',
      text: 'عدد را در ۱۰ ضرب کن و خودِ عدد را یک بار کم کن. ۹ یعنی ۱۰ منهای ۱.',
      example: '<span class="eq">۳۷ × ۹ = ۳۷۰ − ۳۷ = <b>۳۳۳</b></span>'
    },
    {
      title: '۲۵٪ یعنی دو بار نصف کردن',
      text: '۲۵٪ همان یک‌چهارم است. پس عدد را نصف کن و دوباره نصف کن؛ جواب ۲۵٪ آن است.',
      example: '۲۵٪ از ۲۴۰: <span class="eq">۲۴۰ ÷ ۲ = ۱۲۰ ، ۱۲۰ ÷ ۲ = <b>۶۰</b></span>'
    },
    {
      title: 'ضرب دو رقمی در ۱۱',
      text: 'دو رقم را از هم جدا کن و حاصل‌جمعشان را وسطشان بگذار. اگر جمع از ۹ بیشتر شد، یکی به رقم اول اضافه می‌شود.',
      example: '<span class="eq">۳۴ × ۱۱ = ۳ (۳+۴) ۴ = <b>۳۷۴</b></span>'
    },
    {
      title: 'درصد را برعکس کن',
      text: '«۸٪ از ۵۰» با «۵۰٪ از ۸» برابر است؛ همیشه می‌توانی جای عدد و درصد را عوض کنی. هر کدام آسان‌تر بود، همان را حساب کن.',
      example: '۸٪ از ۵۰ = ۵۰٪ از ۸ = <b>۴</b>'
    },
    {
      title: 'ضرب در ۲۵ یعنی ×۱۰۰ و ÷۴',
      text: '۲۵ یک‌چهارمِ ۱۰۰ است. پس دو صفر کنار عدد بگذار و حاصل را دو بار نصف کن.',
      example: '<span class="eq">۳۶ × ۲۵ = ۳۶۰۰ ÷ ۴ = <b>۹۰۰</b></span>'
    },
    {
      title: 'بقیه‌ی پول را رو به جلو بشمار',
      text: 'مثل فروشنده‌ها: از مبلغ خرید تا عدد رُند بعدی، و از آنجا تا پولی که دادی جلو برو و قدم‌ها را جمع کن.',
      example: 'خرید ۳۷۳ هزار، پرداخت ۱ میلیون: <span class="eq">۷ + ۲۰ + ۶۰۰ = <b>۶۲۷</b></span> هزار'
    },
    {
      title: 'سرعت ۶۰ یعنی دقیقه‌ای یک کیلومتر',
      text: 'با سرعت ۶۰ کیلومتر بر ساعت، هر دقیقه دقیقاً یک کیلومتر جلو می‌روی. با ۱۲۰، دقیقه‌ای دو کیلومتر.',
      example: '۴۵ کیلومتر با سرعت ۶۰ = <b>۴۵ دقیقه</b>'
    },
    {
      title: 'قانون ۷۲ برای دو برابر شدن',
      text: '۷۲ را بر درصد سود (یا تورم) سالانه تقسیم کن؛ تقریباً می‌گوید چند سال طول می‌کشد تا پول (یا قیمت‌ها) دو برابر شود.',
      example: 'سود ۱۸٪: <span class="eq">۷۲ ÷ ۱۸ = <b>۴</b></span> سال'
    },
    {
      title: 'مربعِ عددهای ۵دار',
      text: 'برای عددی که به ۵ ختم می‌شود ضرب در خودش: رقم اول را در «یکی بیشتر از خودش» ضرب کن و ۲۵ را کنارش بنویس.',
      example: '<span class="eq">۳۵ × ۳۵</span>: <span class="eq">۳ × ۴ = ۱۲</span> ← <b>۱۲۲۵</b>'
    }
  ];
  var trickIndex = 0;
  var trickBtn = document.getElementById('trick-next');
  if (trickBtn) {
    var trickBody = document.querySelector('.trick-body');
    var tTitle = document.getElementById('trick-title');
    var tText = document.getElementById('trick-text');
    var tExample = document.getElementById('trick-example');
    var tCount = document.getElementById('trick-count');

    function showTrick(i) {
      var t = tricks[i];
      tTitle.textContent = t.title;
      tText.textContent = t.text;
      tExample.innerHTML = t.example;
      tCount.textContent = faInt.format(i + 1) + ' از ' + faInt.format(tricks.length);
      trickBody.classList.remove('swap');
      void trickBody.offsetWidth; // برای شروع دوباره‌ی انیمیشن
      trickBody.classList.add('swap');
    }
    trickBtn.addEventListener('click', function () {
      trickIndex = (trickIndex + 1) % tricks.length;
      showTrick(trickIndex);
    });
  }

  /* ---------- تمرین‌های صفحه‌ی درس ---------- */
  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function initExercises() {
    var list = Array.prototype.slice.call(document.querySelectorAll('.exercise'));
    if (!list.length) return;
    var topic = document.body.getAttribute('data-topic');
    var done = {};
    (readStore('done:' + topic) || []).forEach(function (id) { done[id] = true; });

    var fill = document.getElementById('progress-fill');
    var text = document.getElementById('progress-text');
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc-list a'));

    function updateProgress() {
      var n = list.filter(function (ex) { return done[ex.id]; }).length;
      if (fill) fill.style.width = (n / list.length * 100) + '%';
      if (text) text.textContent = faInt.format(n) + ' از ' + faInt.format(list.length) + ' تمرین حل شده';
      tocLinks.forEach(function (a) {
        var sec = document.getElementById(a.getAttribute('href').slice(1));
        var exs = sec ? sec.querySelectorAll('.exercise') : [];
        var all = exs.length > 0 && Array.prototype.every.call(exs, function (ex) { return done[ex.id]; });
        a.classList.toggle('done', all);
      });
    }
    function markDone(ex) {
      ex.classList.add('is-correct');
      if (done[ex.id]) return;
      done[ex.id] = true;
      var ids = Object.keys(done);
      writeStore('done:' + topic, ids);
      writeStore('progress:' + topic, { done: ids.length, total: list.length });
      updateProgress();
    }

    list.forEach(function (ex) {
      var q = ex.querySelector('.ex-q');
      var fb = document.createElement('p');
      fb.className = 'feedback';
      fb.setAttribute('aria-live', 'polite');
      var tries = 0;

      function say(kind, msg, hint) {
        fb.className = 'feedback ' + kind;
        fb.textContent = msg;
        if (hint) {
          var h = document.createElement('span');
          h.className = 'hint';
          h.textContent = hint;
          fb.appendChild(h);
        }
        void fb.offsetWidth;
        fb.classList.add('pop');
      }
      function wrong() {
        tries++;
        var hint = ex.getAttribute('data-hint');
        if (tries === 1) say('no', 'نه هنوز؛ یک بار دیگر حساب کن.', hint ? 'راهنمایی: ' + hint : '');
        else say('no', 'باز هم نه. اشکالی ندارد؛ «دیدن راه‌حل» را باز کن و قدم‌به‌قدم ببین.');
      }

      if (ex.hasAttribute('data-choices')) {
        var correct = Number(ex.getAttribute('data-correct'));
        var box = document.createElement('div');
        box.className = 'choices';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'گزینه‌ها');
        ex.getAttribute('data-choices').split('|').forEach(function (label, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'choice';
          b.textContent = label;
          b.addEventListener('click', function () {
            if (i === correct) {
              b.classList.add('right');
              say('ok', 'آفرین! درست است.');
              markDone(ex);
            } else {
              b.classList.add('wrong');
              wrong();
            }
          });
          box.appendChild(b);
        });
        q.after(box, fb);
        if (done[ex.id]) {
          box.children[correct].classList.add('right');
          ex.classList.add('is-correct');
        }
        return;
      }

      var form = document.createElement('form');
      form.className = 'answer-row';
      form.noValidate = true;
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.dir = 'ltr';
      input.autocomplete = 'off';
      input.placeholder = 'جواب';
      input.setAttribute('aria-label', 'جواب تمرین');
      form.appendChild(input);
      var unit = ex.getAttribute('data-unit');
      if (unit) {
        var u = document.createElement('span');
        u.className = 'ans-unit';
        u.textContent = unit;
        form.appendChild(u);
      }
      var btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'btn-check';
      btn.textContent = 'بررسی';
      form.appendChild(btn);
      q.after(form, fb);

      var hasRange = ex.hasAttribute('data-min');
      var answer = Number(ex.getAttribute(hasRange ? 'data-min' : 'data-answer'));
      var max = hasRange ? Number(ex.getAttribute('data-max')) : answer;
      var tol = Number(ex.getAttribute('data-tol') || 0);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = parseNum(input.value);
        if (isNaN(v)) { say('no', 'اول جوابت را به‌صورت عدد بنویس.'); return; }
        if (hasRange ? (v >= answer && v <= max) : Math.abs(v - answer) <= tol + 1e-9) {
          say('ok', hasRange ? 'آفرین! تخمین خوبی است.' : 'آفرین! درست است.');
          markDone(ex);
          return;
        }
        var target = hasRange ? (answer + max) / 2 : answer;
        if (target !== 0 && Math.abs(v - target) / Math.abs(target) <= 0.05) {
          tries++;
          say('near', 'خیلی نزدیکی! یک بار دیگر با دقت حساب کن.');
          return;
        }
        wrong();
      });
      if (done[ex.id]) {
        input.value = hasRange ? '' : faNum.format(answer);
        ex.classList.add('is-correct');
      }
    });

    var reset = document.getElementById('progress-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        if (!window.confirm('همه‌ی تمرین‌های این موضوع از نو شروع شوند؟')) return;
        try {
          localStorage.removeItem('done:' + topic);
          localStorage.removeItem('progress:' + topic);
        } catch (e) {}
        location.reload();
      });
    }
    updateProgress();
  }
  initExercises();

  /* ---------- پیشرفت هر موضوع روی کارت‌های صفحه‌ی اصلی ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.topic[data-topic]'), function (card) {
    var p = readStore('progress:' + card.getAttribute('data-topic'));
    var out = card.querySelector('.topic-progress');
    if (!out || !p || !p.done) return;
    out.textContent = (p.done >= p.total ? '✓ ' : '') + faInt.format(p.done) + ' از ' + faInt.format(p.total) + ' تمرین حل شده';
    out.classList.add('has');
  });

  /* ---------- نمایش آرام با اسکرول ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) {
      // تأخیر پلکانی بین کارت‌های هم‌ردیف
      var sibs = el.parentElement.querySelectorAll(':scope > .reveal');
      el.style.setProperty('--delay', (Array.prototype.indexOf.call(sibs, el) * 0.09) + 's');
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }
})();
