const { EMA } = require('technicalindicators');
const Binance = require('binance-api-node').default;
const axios = require('axios');

const client = Binance();

// ==================== CẤU HÌNH CỦA BẠN ====================
const TELEGRAM_TOKEN = '8604430353:AAE2KQqdZFooJPc99BeVeh5sxrL1LiyH-6Y';
const TELEGRAM_CHAT_ID = '6628216316';
const TIMEFRAMES = ['15m', '1h']; 
const THRESHOLD_PERCENT = 0.4; 
const SCAN_INTERVAL_MINUTES = 15; // Cứ mỗi 15 phút quét 1 lần
// ==========================================================

// Hàm gửi tin nhắn về Telegram
async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'Markdown' // Cho phép định dạng chữ đậm, icon đẹp mắt
        });
    } catch (error) {
        console.error("❌ Lỗi không gửi được Telegram:", error.message);
    }
}

async function getFuturesUSDTPairs() {
    try {
        const exchangeInfo = await client.futuresExchangeInfo();
        return exchangeInfo.symbols
            .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
            .map(s => s.symbol);
    } catch (error) {
        return [];
    }
}

function detectPriceAction(open1, high1, low1, close1, open2, close2) {
    const totalRange1 = high1 - low1;
    if (totalRange1 === 0) return null;

    const isBullishPinBar = (close1 > open1) && ((open1 - low1) / totalRange1 > 0.6); 
    const isBearishPinBar = (close1 < open1) && ((high1 - open1) / totalRange1 > 0.6);

    if (isBullishPinBar) return '📌 PIN BAR TĂNG GIÁ (Rút râu dưới)';
    if (isBearishPinBar) return '📌 PIN BAR GIẢM GIÁ (Rút râu trên)';

    const isBullishEngulfing = (close2 < open2) && (close1 > open1) && (close1 > open2) && (open1 < close2);
    const isBearishEngulfing = (close2 > open2) && (close1 < open1) && (close1 < open2) && (open1 > close2);

    if (isBullishEngulfing) return '⚡ BULLISH ENGULFING (Nhấn chìm tăng)';
    if (isBearishEngulfing) return '⚡ BEARISH ENGULFING (Nhấn chìm giảm)';

    return null; // Chỉ lấy nến có Price Action rõ ràng
}

async function checkEMAPriceAction(symbol, timeframe) {
    try {
        const candles = await client.futuresCandles({ symbol, interval: timeframe, limit: 300 });
        if (candles.length < 205) return null;

        const closes = candles.map(c => parseFloat(c.close));
        const opens = candles.map(c => parseFloat(c.open));
        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));
        
        const ema21 = EMA.calculate({ period: 21, values: closes });
        const ema50 = EMA.calculate({ period: 50, values: closes });
        const ema89 = EMA.calculate({ period: 89, values: closes });
        const ema200 = EMA.calculate({ period: 200, values: closes });
        
        const len = closes.length;
        
        const c1 = closes[len - 2]; const o1 = opens[len - 2]; const h1 = highs[len - 2]; const l1 = lows[len - 2];
        const c2 = closes[len - 3]; const o2 = opens[len - 3];

        const e21_1 = ema21[ema21.length - 2]; const e50_1 = ema50[ema50.length - 2]; const e89_1 = ema89[ema89.length - 2]; const e200_1 = ema200[ema200.length - 2];
        const e21_2 = ema21[ema21.length - 3]; const e50_2 = ema50[ema50.length - 3]; const e89_2 = ema89[ema89.length - 3]; const e200_2 = ema200[ema200.length - 3];

        const distancePercent = (Math.abs(c1 - e200_1) / e200_1) * 100;
        if (distancePercent > THRESHOLD_PERCENT) return null;

        const isLongTrend = (c1 > e200_1 && c2 > e200_2) && (c1 > e21_1 && e21_1 > e50_1 && e50_1 > e89_1 && e89_1 > e200_1) && (c2 > e21_2 && e21_2 > e50_2 && e50_2 > e89_2 && e89_2 > e200_2);
        const isShortTrend = (c1 < e200_1 && c2 < e200_2) && (c1 < e21_1 && e21_1 < e50_1 && e50_1 < e89_1 && e89_1 < e200_1) && (c2 < e21_2 && e21_2 < e50_2 && e50_2 < e89_2 && e89_2 < e200_2);

        if (isLongTrend || isShortTrend) {
            const paSignal = detectPriceAction(o1, h1, l1, c1, o2, c2);
            if (!paSignal) return null; // Nếu không có Price Action từ chối giá thì bỏ qua

            if (isLongTrend && (paSignal.includes('TĂNG') || paSignal.includes('BULLISH'))) {
                return `🟢 *LONG COIN*: #${symbol}\n⏱ Khung: ${timeframe}\n🎯 Tín hiệu: ${paSignal}\n📏 Cách EMA200: ${distancePercent.toFixed(2)}%\n💰 Giá hiện tại: ${c1}`;
            }
            if (isShortTrend && (paSignal.includes('GIẢM') || paSignal.includes('BEARISH'))) {
                return `🔴 *SHORT COIN*: #${symbol}\n⏱ Khung: ${timeframe}\n🎯 Tín hiệu: ${paSignal}\n📏 Cách EMA200: ${distancePercent.toFixed(2)}%\n💰 Giá hiện tại: ${c1}`;
            }
        }
    } catch (error) {
        return null;
    }
    return null;
}

// Hàm thực thi tác vụ quét định kỳ
async function taskScan() {
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] 🔍 Đang tiến hành quét thị trường định kỳ...`);
    
    const pairs = await getFuturesUSDTPairs();
    let alertMessages = [];

    for (const timeframe of TIMEFRAMES) {
        for (let i = 0; i < pairs.length; i++) {
            const result = await checkEMAPriceAction(pairs[i], timeframe);
            if (result) {
                alertMessages.push(result);
            }
            await new Promise(res => setTimeout(res, 40)); // Tránh spam API
        }
    }

    // Nếu có tín hiệu, gom lại gửi 1 lần về Telegram cho đỡ tốn số lượng tin nhắn
    if (alertMessages.length > 0) {
        const header = `🔔 *DANH SÁCH KÈO ĐẸP EMA + PA (${now})*\n\n`;
        const fullMessage = header + alertMessages.join('\n\n-------------------\n\n');
        await sendTelegramMessage(fullMessage);
        console.log(`[${now}] ✅ Đã bắn ${alertMessages.length} tín hiệu lên Telegram.`);
    } else {
        console.log(`[${now}] 😴 Lượt này không tìm thấy kèo thỏa mãn.`);
    }
}

// KHỞI CHẠY HỆ THỐNG CHẠY VÒNG LẶP 24/24
function startBot() {
    console.log("🚀 Bot Scan EMA & Price Action Futures đã kích hoạt!");
    console.log(`Hệ thống sẽ tự động quét sau mỗi ${SCAN_INTERVAL_MINUTES} phút.`);
    
    // Chạy lần đầu tiên ngay khi bật bot
    taskScan();

    // Lập lịch chạy lặp đi lặp lại
    setInterval(taskScan, SCAN_INTERVAL_MINUTES * 60 * 1000);
}

startBot();