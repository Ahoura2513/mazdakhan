"""
BTC Signal Bot v2 — Technical + Fundamental (News) Assistant
------------------------------------------------------------
Runs on a schedule (GitHub Actions cron). For BTC only:

  1. Pulls REAL hourly price data from CoinGecko (market_chart endpoint,
     one API call), then aggregates it into true 4-hour candles.
  2. Calculates RSI, MACD, MA50 and MA200 on both timeframes.
  3. Uses a SCORING system (each indicator votes) instead of an
     all-or-nothing condition, so the verdict is actually informative.
  4. Pulls latest headlines from CoinDesk + Cointelegraph RSS feeds and
     sends them to Gemini for a short Persian sentiment read.
  5. Sends ONE combined Telegram message. It NEVER says buy/sell —
     the human makes the final call.

Fixes vs v1:
  - "1h" timeframe was actually 4h data (CoinGecko /ohlc quirk). Now
    uses /market_chart which returns genuine hourly prices for 2-90 days.
  - Gemini output is HTML-escaped so Telegram never rejects the message.
  - Retry with backoff on 429 / 5xx from CoinGecko.
  - Gemini model updated to 2.5-flash; API key sent via header, not URL.
  - MA200 is now shown (only when enough data exists — no fake MA200).
  - feedparser errors detected via `bozo` flag.
  - Clear error if Telegram secrets are missing; 4096-char guard.

Env vars required (GitHub Actions secrets):
  TELEGRAM_BOT_TOKEN   - bot token from @BotFather
  TELEGRAM_CHAT_ID     - chat/user id to send alerts to
  GEMINI_API_KEY       - from aistudio.google.com/apikey
  COINGECKO_API_KEY    - Demo API key from coingecko.com dashboard

Optional env vars:
  RSI_OVERSOLD   (default 30)
  RSI_OVERBOUGHT (default 70)
"""

import html
import os
import sys
import time
import requests
import feedparser

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COIN_ID = "bitcoin"
SYMBOL = "BTC"

RSI_OVERSOLD = float(os.environ.get("RSI_OVERSOLD", "30"))
RSI_OVERBOUGHT = float(os.environ.get("RSI_OVERBOUGHT", "70"))

COINGECKO_BASE = "https://api.coingecko.com/api/v3"

NEWS_FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
]

# market_chart with days between 2 and 90 returns genuine HOURLY prices.
# 90 days of hourly data (~2160 points) is enough for MA200 on the 1h
# timeframe AND, after 4h aggregation (~540 candles), MA200 on 4h too.
MARKET_CHART_DAYS = 90

REQUEST_TIMEOUT = 20
MAX_RETRIES = 3
TELEGRAM_MAX_LEN = 4096


# ---------------------------------------------------------------------------
# HTTP helper with retry/backoff (handles CoinGecko free-tier 429s)
# ---------------------------------------------------------------------------

def http_get(url, params=None, headers=None):
    last_resp = None
    for attempt in range(MAX_RETRIES):
        resp = requests.get(url, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
        last_resp = resp
        if resp.status_code == 429 or resp.status_code >= 500:
            wait = 5 * (2 ** attempt)  # 5s, 10s, 20s
            print(f"HTTP {resp.status_code} from {url}, retrying in {wait}s...", file=sys.stderr)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp
    last_resp.raise_for_status()
    return last_resp


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def cg_headers():
    key = os.environ.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": key} if key else {}


def get_hourly_prices(days=MARKET_CHART_DAYS):
    """Returns list of (timestamp_ms, price) — genuine hourly granularity."""
    url = f"{COINGECKO_BASE}/coins/{COIN_ID}/market_chart"
    params = {"vs_currency": "usd", "days": days, "interval": "hourly"}
    resp = http_get(url, params=params, headers=cg_headers())
    prices = resp.json().get("prices", [])
    return [(int(p[0]), float(p[1])) for p in prices]


def aggregate_4h(hourly):
    """Collapse hourly (ts_ms, price) points into 4h closes.

    Buckets are aligned to fixed 4-hour UTC windows; the close of each
    bucket is the last hourly price inside it.
    """
    bucket_ms = 4 * 3600 * 1000
    closes, current_bucket = [], None
    for ts, price in hourly:
        b = ts // bucket_ms
        if b != current_bucket:
            closes.append(price)
            current_bucket = b
        else:
            closes[-1] = price
    return closes


def get_current_price():
    url = f"{COINGECKO_BASE}/simple/price"
    params = {"ids": COIN_ID, "vs_currencies": "usd", "include_24hr_change": "true"}
    resp = http_get(url, params=params, headers=cg_headers())
    return resp.json()[COIN_ID]


# ---------------------------------------------------------------------------
# Indicators (pure python, no pandas/numpy needed)
# ---------------------------------------------------------------------------

def sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema_series(values, period):
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    ema_vals = [sum(values[:period]) / period]
    for price in values[period:]:
        ema_vals.append(price * k + ema_vals[-1] * (1 - k))
    return ema_vals


def rsi(values, period=14):
    if len(values) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(values)):
        change = values[i] - values[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(values, fast=12, slow=26, signal=9):
    """Returns (macd_last, signal_last, cross) where cross is up/down/none."""
    if len(values) < slow + signal:
        return None, None, None
    ema_fast = ema_series(values, fast)
    ema_slow = ema_series(values, slow)
    offset = len(ema_fast) - len(ema_slow)
    macd_line = [ema_fast[i + offset] - ema_slow[i] for i in range(len(ema_slow))]
    signal_line = ema_series(macd_line, signal)
    if not signal_line:
        return None, None, None
    macd_last, signal_last = macd_line[-1], signal_line[-1]
    macd_prev = macd_line[-2] if len(macd_line) > 1 else macd_last
    signal_prev = signal_line[-2] if len(signal_line) > 1 else signal_last
    crossed_up = macd_prev <= signal_prev and macd_last > signal_last
    crossed_down = macd_prev >= signal_prev and macd_last < signal_last
    return macd_last, signal_last, ("up" if crossed_up else "down" if crossed_down else "none")


# ---------------------------------------------------------------------------
# Scoring system — each indicator votes, the sum decides the verdict
# ---------------------------------------------------------------------------

def score_timeframe(closes, label):
    if len(closes) < 40:
        return {"label": label, "ok": False, "reason": "داده‌ی کافی نیست"}

    last_price = closes[-1]
    rsi_val = rsi(closes)
    ma50 = sma(closes, 50)
    ma200 = sma(closes, 200)  # None if not enough data — never a fake MA200
    macd_val, signal_val, cross = macd(closes)

    score = 0
    reasons = []

    if rsi_val is not None:
        if rsi_val <= RSI_OVERSOLD:
            score += 2
            reasons.append("RSI اشباع فروش")
        elif rsi_val < 45:
            score += 1
        elif rsi_val >= RSI_OVERBOUGHT:
            score -= 2
            reasons.append("RSI اشباع خرید")
        elif rsi_val > 55:
            score -= 1

    if cross == "up":
        score += 2
        reasons.append("کراس صعودی MACD")
    elif cross == "down":
        score -= 2
        reasons.append("کراس نزولی MACD")
    elif macd_val is not None and signal_val is not None:
        score += 1 if macd_val > signal_val else -1

    if ma50 is not None:
        score += 1 if last_price > ma50 else -1

    if ma50 is not None and ma200 is not None:
        if ma50 > ma200:
            score += 1
            reasons.append("روند بلندمدت صعودی (MA50>MA200)")
        else:
            score -= 1
            reasons.append("روند بلندمدت نزولی (MA50<MA200)")

    if score >= 3:
        verdict = "مثبت ✅"
    elif score >= 1:
        verdict = "متمایل به مثبت 🙂"
    elif score <= -3:
        verdict = "منفی ⚠️"
    elif score <= -1:
        verdict = "متمایل به منفی 😐"
    else:
        verdict = "خنثی"

    return {
        "label": label,
        "ok": True,
        "price": last_price,
        "rsi": rsi_val,
        "ma50": ma50,
        "ma200": ma200,
        "macd_cross": cross,
        "score": score,
        "verdict": verdict,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# News (RSS -> Gemini sentiment)
# ---------------------------------------------------------------------------

def fetch_headlines(max_per_feed=8):
    headlines = []
    for feed_url in NEWS_FEEDS:
        parsed = feedparser.parse(feed_url)
        if parsed.bozo and not parsed.entries:
            print(f"Failed to read feed {feed_url}: {parsed.bozo_exception}", file=sys.stderr)
            continue
        for entry in parsed.entries[:max_per_feed]:
            title = entry.get("title", "").strip()
            if title:
                headlines.append(title)
    return headlines


def gemini_news_summary(headlines):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not headlines:
        return None

    joined = "\n".join(f"- {h}" for h in headlines[:20])
    prompt = (
        "You are a neutral crypto news filter. Below are recent headlines from "
        "crypto news feeds. Identify ONLY the ones that are meaningfully "
        "relevant to Bitcoin (BTC) price action (regulation, ETFs, macro "
        "economy, major hacks, institutional adoption, etc). Ignore unrelated "
        "altcoin/NFT/meme noise.\n\n"
        f"Headlines:\n{joined}\n\n"
        "Respond in Persian (Farsi), in 2-4 short sentences maximum. "
        "State whether the overall relevant news tone leans مثبت (positive), "
        "منفی (negative), or خنثی (neutral/no major news) for BTC, and briefly "
        "say why. Do not tell the reader to buy or sell. Plain text only, no "
        "markdown. If nothing relevant was found, just say "
        "خبر مهمی برای بیت‌کوین یافت نشد."
    )

    body = {"contents": [{"parts": [{"text": prompt}]}]}
    headers = {"x-goog-api-key": api_key}  # key in header, never in URL/logs

    # Try the newest model first; fall back if the key/tier doesn't allow it.
    models = [
        os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
        "gemini-2.5-flash",
    ]
    for model in models:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            print(f"Gemini call with {model} failed: {e}", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

def send_telegram(message: str):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print(
            "ERROR: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets are not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    if len(message) > TELEGRAM_MAX_LEN:
        message = message[: TELEGRAM_MAX_LEN - 20] + "\n…(کوتاه شد)"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    resp = requests.post(
        url,
        data={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def fmt_usd(v):
    return f"${v:,.0f}" if v is not None else "N/A"


def format_tf_block(tf):
    if not tf["ok"]:
        return f"⏱ {tf['label']}: {tf['reason']}"
    rsi_txt = f"{tf['rsi']:.1f}" if tf["rsi"] is not None else "N/A"
    cross_txt = {"up": "کراس صعودی", "down": "کراس نزولی", "none": "بدون کراس"}.get(
        tf["macd_cross"], "N/A"
    )
    lines = [
        f"⏱ <b>{tf['label']}</b>",
        f"   قیمت: ${tf['price']:,.2f} | RSI: {rsi_txt} | MACD: {cross_txt}",
        f"   MA50: {fmt_usd(tf['ma50'])} | MA200: {fmt_usd(tf['ma200'])}",
        f"   امتیاز: {tf['score']:+d} → نتیجه: {tf['verdict']}",
    ]
    if tf["reasons"]:
        lines.append(f"   ({html.escape('، '.join(tf['reasons']))})")
    return "\n".join(lines)


def main():
    try:
        current = get_current_price()
    except Exception as e:
        print(f"Failed to fetch current price: {e}", file=sys.stderr)
        sys.exit(1)

    tf_results = []
    try:
        hourly = get_hourly_prices()
        closes_1h = [p for _, p in hourly]
        closes_4h = aggregate_4h(hourly)
        tf_results.append(score_timeframe(closes_1h, "۱ ساعته"))
        tf_results.append(score_timeframe(closes_4h, "۴ ساعته"))
    except Exception as e:
        print(f"Failed to fetch/analyze market data: {e}", file=sys.stderr)
        tf_results = [
            {"label": "۱ ساعته", "ok": False, "reason": "خطا در دریافت داده"},
            {"label": "۴ ساعته", "ok": False, "reason": "خطا در دریافت داده"},
        ]

    headlines = fetch_headlines()
    news_summary = gemini_news_summary(headlines)

    lines = [
        "📊 <b>گزارش سیگنال بیت‌کوین (BTC)</b>",
        f"قیمت فعلی: ${current['usd']:,.2f} ({current.get('usd_24h_change', 0):+.2f}% / ۲۴س)",
        "",
    ]
    lines += [format_tf_block(tf) for tf in tf_results]
    lines.append("")
    lines.append("📰 <b>اخبار مهم</b>")
    if news_summary:
        lines.append(html.escape(news_summary))  # never let Gemini break Telegram HTML
    else:
        lines.append("خبر یا تحلیلی در دسترس نبود.")
    lines.append("")
    lines.append("⚠️ این گزارش صرفاً کمک‌تصمیم است، نه توصیه‌ی قطعی خرید/فروش.")

    message = "\n".join(lines)
    print(message)
    send_telegram(message)
    print("\nAlert sent to Telegram.")


if __name__ == "__main__":
    main()
