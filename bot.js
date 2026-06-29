const { EMA } = require('technicalindicators');
const Binance = require('binance-api-node').default;

const client = Binance();

// CẤU HÌNH CÁC THAM SỐ
const TIMEFRAMES = ['15m', '1h']; 
const THRESHOLD_PERCENT = 0.4; // Tăng nhẹ lên 0.4% để quét được râu nến quét qua EMA 200

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

// Hàm nhận diện Price Action
function detectPriceAction(open1, high1, low1, close1, open2, close2) {
    const body1 = Math.abs(close1 - open1);
    const totalRange1 = high1 - low1;
    if (totalRange1 === 0) return null;

    // 1. Kiểm tra PIN BAR (Nến rút râu)
    const isBullishPinBar = (close1 > open1) && ((open1 - low1) / totalRange1 > 0.6); 
    const isBearishPinBar = (close1 < open1) && ((high1 - open1) / totalRange1 > 0.6);

    if (isBullishPinBar) return '🔴 Tín hiệu: PIN BAR TĂNG GIÁ (Rút râu dưới)';
    if (isBearishPinBar) return '🟢 Tín hiệu: PIN BAR GIẢM GIÁ (Rút râu trên)';

    // 2. Kiểm tra ENGULFING (Nhấn chìm)
    const body2 = Math.abs(close2 - open2);
    const isBullishEngulfing = (close2 < open2) && (close1 > open1) && (close1 > open2) && (open1 < close2);
    const isBearishEngulfing = (close2 > open2) && (close1 < open1) && (close1 < open2) && (open1 > close2);

    if (isBullishEngulfing) return '⚡ Tín hiệu: BULLISH ENGULFING (Nhấn chìm tăng)';
    if (isBearishEngulfing) return '⚡ Tín hiệu: BEARISH ENGULFING (Nhấn chìm giảm)';

    return 'Nến tiêu chuẩn (No PA Pattern)';
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
        
        // Nến vừa đóng hoàn toàn (Nến 1)
        const c1 = closes[len - 2]; const o1 = opens[len - 2];
        const h1 = highs[len - 2];  const l1 = lows[len - 2];

        // Nến trước đó (Nến 2)
        const c2 = closes[len - 3]; const o2 = opens[len - 3];

        // Lấy giá trị EMA tại cây nến vừa đóng (index -2)
        const e21_1 = ema21[ema21.length - 2];
        const e50_1 = ema50[ema50.length - 2];
        const e89_1 = ema89[ema89.length - 2];
        const e200_1 = ema200[ema200.length - 2];

        // Lấy giá trị EMA tại cây nến trước (index -3)
        const e21_2 = ema21[ema21.length - 3];
        const e50_2 = ema50[ema50.length - 3];
        const e89_2 = ema89[ema89.length - 3];
        const e200_2 = ema200[ema200.length - 3];

        // Kiểm tra khoảng cách đến EMA 200
        const distancePercent = (Math.abs(c1 - e200_1) / e200_1) * 100;
        if (distancePercent > THRESHOLD_PERCENT) return null;

        // XU HƯỚNG TĂNG ĐỒNG THUẬN (Kiểm tra cấu trúc EMA xếp chồng)
        const isLongTrend = 
            (c1 > e200_1 && c2 > e200_2) && 
            (c1 > e21_1 && e21_1 > e50_1 && e50_1 > e89_1 && e89_1 > e200_1) &&
            (c2 > e21_2 && e21_2 > e50_2 && e50_2 > e89_2 && e89_2 > e200_2);

        // XU HƯỚNG GIẢM ĐỒNG THUẬN
        const isShortTrend = 
            (c1 < e200_1 && c2 < e200_2) && 
            (c1 < e21_1 && e21_1 < e50_1 && e50_1 < e89_1 && e89_1 < e200_1) &&
            (c2 < e21_2 && e21_2 < e50_2 && e50_2 < e89_2 && e89_2 < e200_2);

        if (isLongTrend || isShortTrend) {
            // Nếu xu hướng chuẩn, tiến hành phân tích Price Action của 2 cây nến này
            const paSignal = detectPriceAction(o1, h1, l1, c1, o2, c2);
            
            // Lọc ra các thiết lập đồng thuận (Ví dụ xu hướng tăng + Pin bar tăng hoặc Nhấn chìm tăng)
            if (isLongTrend && (paSignal.includes('TĂNG GIÁ') || paSignal.includes('BULLISH'))) {
                return { symbol, timeframe, Setup: 'LONG 📈', PA: paSignal, Dist: distancePercent.toFixed(2) + '%' };
            }
            if (isShortTrend && (paSignal.includes('GIẢM GIÁ') || paSignal.includes('BEARISH'))) {
                return { symbol, timeframe, Setup: 'SHORT 📉', PA: paSignal, Dist: distancePercent.toFixed(2) + '%' };
            }
        }
    } catch (error) {
        return null;
    }
    return null;
}

async function startAdvancedScan() {
    console.log(`[${new Date().toLocaleTimeString()}] 🦅 Bắt đầu săn thiết lập EMA + PRICE ACTION...`);
    const pairs = await getFuturesUSDTPairs();
    
    for (const timeframe of TIMEFRAMES) {
        console.log(`\n--- KHUNG: ${timeframe} ---`);
        let count = 0;
        for (let i = 0; i < pairs.length; i++) {
            const result = await checkEMAPriceAction(pairs[i], timeframe);
            if (result) {
                count++;
                console.log(`🔥 [KÈO ĐẸP] ${result.symbol} | Hướng: ${result.Setup} | ${result.PA} | Cách EMA200: ${result.Dist}`);
            }
            await new Promise(res => setTimeout(res, 40));
        }
        if (count === 0) console.log(`Không có thiết lập Price Action nào đẹp tại EMA 200.`);
    }
    console.log(`\n[${new Date().toLocaleTimeString()}]  Quét hoàn tất.`);
}

startAdvancedScan();