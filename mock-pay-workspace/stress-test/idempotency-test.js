/**
 * Script Kiểm thử Chống trùng lặp giao dịch (Idempotency Test)
 * Sử dụng API Fetch tích hợp sẵn của Node.js (Node 18+)
 * Chạy bằng lệnh: 
 *   - Redis Guard (Fast-path): node idempotency-test.js
 *   - Bypass Redis (Slow-path Postgres): node idempotency-test.js bypass
 */

const walletId = 'test_wallet';
const initialBalance = 10000000;
const deductAmount = 200000;
const totalRequests = 10;
const idempotencyKey = `pay_evt_cli_${Math.floor(Math.random() * 10000000)}`;
const bypassRedis = process.argv[2] === 'bypass';

async function run() {
  console.log('==================================================================');
  console.log(`BẮT ĐẦU KIỂM THỬ CHỐNG TRÙNG LẶP (IDEMPOTENCY)`);
  console.log(`Chế độ: ${bypassRedis ? 'BYPASS REDIS (Slow-path DB)' : 'REDIS GUARD (Fast-path)'}`);
  console.log(`X-Idempotency-Key: ${idempotencyKey}`);
  console.log(`Số lượng request đồng thời: ${totalRequests}`);
  console.log('==================================================================\n');

  // Bước 1: Reset ví về 10,000,000 VND
  console.log(`[1/3] Đang reset ví ${walletId} về ${initialBalance.toLocaleString()} VND...`);
  const resetRes = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ balance: initialBalance })
  });
  const resetData = await resetRes.json();
  console.log(`-> Số dư hiện tại: ${parseFloat(resetData.balance).toLocaleString()} VND.\n`);

  // Bước 2: Bắn 10 request đồng thời cùng 1 key
  console.log(`[2/3] Đang gửi đồng thời ${totalRequests} request trùng X-Idempotency-Key...`);
  
  const startTime = Date.now();
  const promises = Array.from({ length: totalRequests }).map(async (_, index) => {
    const reqId = index + 1;
    const startReq = Date.now();
    try {
      const url = `http://localhost:3000/gateway/wallets/${walletId}/deduct?method=atomic&bypassRedis=${bypassRedis}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ amount: deductAmount })
      });
      const latency = Date.now() - startReq;
      const status = res.status;
      let bodyText = '';
      try {
        const data = await res.json();
        bodyText = JSON.stringify(data);
      } catch (e) {
        bodyText = await res.text();
      }
      return { id: reqId, status, latency, response: bodyText };
    } catch (err) {
      const latency = Date.now() - startReq;
      return { id: reqId, status: 'Network Error', latency, response: err.message };
    }
  });

  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  
  console.log(`-> Kết quả chi tiết 10 requests:`);
  console.table(results);

  // Thống kê kết quả
  const status200 = results.filter(r => r.status === 200).length;
  const status409 = results.filter(r => r.status === 409).length;
  const status500 = results.filter(r => r.status === 500).length;

  // Bước 3: Đọc lại số dư ví để xác minh chỉ có đúng 1 giao dịch thực hiện
  console.log(`\n[3/3] Đang lấy lại số dư thực tế cuối cùng...`);
  const balanceRes = await fetch(`http://localhost:3000/gateway/wallets/${walletId}`);
  const balanceData = await balanceRes.json();
  const finalBalance = parseFloat(balanceData.balance);

  console.log('==================================================================');
  console.log(`KẾT QUẢ PHÂN TÍCH:`);
  console.log(`- Số lượng request thành công (200 OK): ${status200}`);
  console.log(`- Số lượng request bị chặn bởi Redis (409 Conflict): ${status409}`);
  console.log(`- Số lượng request bị chặn bởi Postgres (500 Error): ${status500}`);
  console.log(`- Số dư ví cuối cùng: ${finalBalance.toLocaleString()} VND (mong đợi: 9,800,000 VND)`);

  if (status200 === 1 && (status409 === 9 || status500 === 9) && finalBalance === 9800000) {
    console.log(`- KẾT LUẬN: KIỂM THỬ THÀNH CÔNG! CHỐNG TRÙNG LẶP HOÀN HẢO! ✅`);
  } else {
    console.log(`- KẾT LUẬN: THẤT BẠI! Hệ thống không hoạt động đúng cơ chế chống trùng lặp. ❌`);
  }
  console.log('==================================================================');
}

run();
