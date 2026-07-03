"""
BTC Signal Bot — Technical + Fundamental (News) Assistant
------------------------------------------------------------
Runs on a schedule (GitHub Actions cron). For BTC only:

  1. Pulls hourly & 4-hour candle data from CoinGecko (free, no key).
  2. Calculates RSI, MACD, and Moving Averages (MA50 / MA200) on both
     timeframes.
  3. Pulls latest headlines from CoinDesk + Cointelegraph RSS feeds.
  4. Sends the headlines to Gemini to get a short sentiment read
     (positive / negative / neutral) — only for headlines that
     actually mention Bitcoin / BTC / macro-relevant topics.
  5. Combines both reads into ONE Telegram message. It NEVER tells you
     to buy or sell — it only reports what the technical conditions
     and the news say, in plain Persian, so the human (your father)
     makes the final call.

Env vars required (set as GitHub Actions secrets):
  TELEGRAM_BOT_TOKEN   - bot token from @BotFather
  TELEGRAM_CHAT_ID     - chat/user id to send alerts to
  GEMINI_API_KEY       - from aistudio.google.com/apikey
  COINGECKO_API_KEY    - Demo API key from coingecko.com/en/developers/dashboard

Optional env vars:
  RSI_OVERSOLD   (default 30)
  RSI_OVERBOUGHT (default 70)
"""

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

# CoinGecko OHLC endpoint gives limited granularity on the free tier:
# days=1 -> 30-min candles, days=7 -> 4h candles, days=14/30 -> 4h candles.
# We approximate our two timeframes like this:
TIMEFRAMES = {
    "1h": {"days": 2, "label": "۱ ساعته"},
    "4h": {"days": 14, "label": "۴ ساعته"},
}

REQUEST_TIMEOUT = 20


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def cg_headers():
    key = os.environ.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": key} if key else {}


def get_ohlc(days: int):
    """Returns list of [timestamp, open, high, low, close]."""
    url = f"{COINGECKO_BASE}/coins/{COIN_ID}/ohlc"
    params = {"vs_currency": "usd", "days": days}
    resp = requests.get(url, params=params, headers=cg_headers(), timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def get_current_price():
    url = f"{COINGECKO_BASE}/simple/price"
    params = {"ids": COIN_ID, "vs_currencies": "usd", "include_24hr_change": "true"}
    resp = requests.get(url, params=params, headers=cg_headers(), timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
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
    if len(values) < slow + signal:
        return None, None, None
    ema_fast = ema_series(values, fast)
    ema_slow = ema_series(values, slow)
    offset = len(ema_fast) - len(ema_slow)
    macd_line = [ema_fast[i + offset] - ema_slow[i] for i in range(len(ema_slow))]
    signal_line = ema_series(macd_line, signal)
    if not signal_line:
        return None, None, None
    macd_last = macd_line[-1]
    signal_last = signal_line[-1]
    macd_prev = macd_line[-2] if len(macd_line) > 1 else macd_last
    signal_prev_idx = len(signal_line) - 2
    signal_prev = signal_line[signal_prev_idx] if signal_prev_idx >= 0 else signal_last
    crossed_up = macd_prev <= signal_prev and macd_last > signal_last
    crossed_down = macd_prev >= signal_prev and macd_last < signal_last
    return macd_last, signal_last, ("up" if crossed_up else "down" if crossed_down else "none")


def analyze_timeframe(days: int, label: str):
    candles = get_ohlc(days)
    closes = [c[4] for c in candles]
    if len(closes) < 30:
        return {"label": label, "ok": False, "reason": "داده‌ی کافی نیست"}

    last_price = closes[-1]
    rsi_val = rsi(closes)
    ma50 = sma(closes, min(50, len(closes)))
    ma200 = sma(closes, min(200, len(closes)))
    macd_val, signal_val, cross = macd(closes)

    verdict = "خنثی"
    if rsi_val is not None and macd_val is not None:
        bullish = rsi_val <= RSI_OVERSOLD and cross == "up" and (ma50 is None or last_price > ma50)
        bearish = rsi_val >= RSI_OVERBOUGHT and cross == "down"
        if bullish:
            verdict = "مثبت ✅"
        elif bearish:
            verdict = "منفی ⚠️"

    return {
        "label": label,
        "ok": True,
        "price": last_price,
        "rsi": rsi_val,
        "ma50": ma50,
        "ma200": ma200,
        "macd_cross": cross,
        "verdict": verdict,
    }


# ---------------------------------------------------------------------------
# News (RSS -> Gemini sentiment)
# ---------------------------------------------------------------------------

def fetch_headlines(max_per_feed=8):
    headlines = []
    for feed_url in NEWS_FEEDS:
        try:
            parsed = feedparser.parse(feed_url)
            for entry in parsed.entries[:max_per_feed]:
                title = entry.get("title", "").strip()
                if title:
                    headlines.append(title)
        except Exception as e:
            print(f"Failed to read feed {feed_url}: {e}", file=sys.stderr)
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
        "say why. Do not tell the reader to buy or sell. If nothing relevant "
        "was found, just say خبر مهمی برای بیت‌کوین یافت نشد."
    )

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={api_key}"
    )
    body = {"contents": [{"parts": [{"text": prompt}]}]}
    try:
        resp = requests.post(url, json=body, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        print(f"Gemini call failed: {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

def send_telegram(message: str):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
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

def format_tf_block(tf):
    if not tf["ok"]:
        return f"⏱ {tf['label']}: {tf['reason']}"
    rsi_txt = f"{tf['rsi']:.1f}" if tf["rsi"] is not None else "N/A"
    cross_txt = {"up": "کراس صعودی", "down": "کراس نزولی", "none": "بدون کراس"}[tf["macd_cross"]]
    ma_txt = f"${tf['ma50']:,.0f}" if tf["ma50"] else "N/A"
    return (
        f"⏱ <b>{tf['label']}</b>\n"
        f"   قیمت: ${tf['price']:,.2f} | RSI: {rsi_txt} | MACD: {cross_txt} | MA50: {ma_txt}\n"
        f"   نتیجه: {tf['verdict']}"
    )


def main():
    try:
        current = get_current_price()
    except Exception as e:
        print(f"Failed to fetch current price: {e}", file=sys.stderr)
        sys.exit(1)

    tf_results = []
    for key, cfg in TIMEFRAMES.items():
        try:
            tf_results.append(analyze_timeframe(cfg["days"], cfg["label"]))
        except Exception as e:
            print(f"Failed to analyze {key}: {e}", file=sys.stderr)
            tf_results.append({"label": cfg["label"], "ok": False, "reason": "خطا در دریافت داده"})
        time.sleep(2)  # be gentle with the free API rate limit

    headlines = fetch_headlines()
    news_summary = gemini_news_summary(headlines)

    lines = [
        f"📊 <b>گزارش سیگنال بیت‌کوین (BTC)</b>",
        f"قیمت فعلی: ${current['usd']:,.2f} ({current.get('usd_24h_change', 0):+.2f}% / ۲۴س)",
        "",
    ]
    lines += [format_tf_block(tf) for tf in tf_results]
    lines.append("")
    lines.append("📰 <b>اخبار مهم</b>")
    lines.append(news_summary if news_summary else "خبر یا تحلیلی در دسترس نبود.")
    lines.append("")
    lines.append("⚠️ این گزارش صرفاً کمک‌تصمیم است، نه توصیه‌ی قطعی خرید/فروش.")

    message = "\n".join(lines)
    print(message)
    send_telegram(message)
    print("\nAlert sent to Telegram.")


if __name__ == "__main__":
    main()
