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

  /* ---------- تخفیف‌یاب ---------- */
  var priceEl = document.getElementById('price');
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
    }
  ];
  var trickIndex = 0;
  var trickBtn = document.getElementById('trick-next');
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
