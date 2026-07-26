/**
 * Script Stress Test chống quá bán (Overselling / Over-spending)
 * Sử dụng API Fetch tích hợp sẵn của Node.js (Node 18+)
 * Chạy bằng lệnh: node overselling-test.js [traditional | pessimistic | atomic]
 */

const walletId = 'test_wallet';
const initialBalance = 1000000;
const deductAmount = 200000;
const totalRequests = 100;
const method = process.argv[2] || 'atomic'; // Mặc định dùng 'atomic' nếu không truyền tham số

async function run() {
  console.log('==================================================================');
  console.log(`BẮT ĐẦU KIỂM THỬ STRESS TEST CHỐNG QUÁ BÁN`);
  console.log(`Phương thức: ${method.toUpperCase()}`);
  console.log(`Số lượng request: ${totalRequests}`);
  console.log(`Số dư ban đầu: ${initialBalance.toLocaleString()} VND`);
  console.log(`Số tiền trừ mỗi request: ${deductAmount.toLocaleString()} VND`);
  console.log('==================================================================\n');

  // Bước 1: Reset số dư ví qua Gateway
  console.log(`[1/3] Đang gửi yêu cầu Reset ví ${walletId} về ${initialBalance.toLocaleString()} VND...`);
  try {
    const resetRes = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: initialBalance })
    });
    if (!resetRes.ok) {
      throw new Error(`Reset ví thất bại với status code ${resetRes.status}`);
    }
    const resetData = await resetRes.json();
    console.log(`-> Reset thành công. Số dư ví hiện tại: ${parseFloat(resetData.balance).toLocaleString()} VND.\n`);
  } catch (err) {
    console.error(`Lỗi kết nối tới Gateway NestJS (port 3000):`, err.message);
    console.error(`Hãy đảm bảo rằng cả Postgres, Redis, Core service (port 8080) và Gateway service (port 3000) đã khởi động.`);
    process.exit(1);
  }

  // Bước 2: Bắn 100 request đồng thời
  console.log(`[2/3] Đang gửi đồng thời ${totalRequests} request trừ tiền song song...`);
  const startTime = Date.now();
  let completed = 0;
  let successCount = 0;
  let failureCount = 0;

  const promises = Array.from({ length: totalRequests }).map(async (_, index) => {
    const reqId = index + 1;
    try {
      const res = await fetch(`http://localhost:3000/gateway/wallets/${walletId}/deduct?method=${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: deductAmount })
      });
      completed++;
      
      if (res.ok) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (e) {
      completed++;
      failureCount++;
    }
  });

  await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  console.log(`-> Đã hoàn thành gửi ${completed} requests trong ${totalTime}ms.`);
  console.log(`-> Số lượng thành công (HTTP 200): ${successCount}`);
  console.log(`-> Số lượng thất bại / bị chặn: ${failureCount}\n`);

  // Bước 3: Đọc lại số dư ví cuối cùng để kiểm tra
  console.log(`[3/3] Đang lấy lại số dư thực tế cuối cùng trong Database...`);
  const balanceRes = await fetch(`http://localhost:3000/gateway/wallets/${walletId}`);
  const balanceData = await balanceRes.json();
  const finalBalance = parseFloat(balanceData.balance);

  console.log('==================================================================');
  console.log(`KẾT QUẢ CUỐI CÙNG:`);
  console.log(`- Số dư ban đầu: ${initialBalance.toLocaleString()} VND`);
  console.log(`- Số dư lý thuyết: 0 VND (chỉ cho phép tối đa 5 giao dịch thành công)`);
  console.log(`- Số dư thực tế: ${finalBalance.toLocaleString()} VND`);
  
  if (finalBalance < 0) {
    console.log(`- KẾT LUẬN: BỊ LỖI OVERSELLING (TIÊU ÂM TIỀN)! ❌`);
  } else if (finalBalance === 0 && successCount === 5) {
    console.log(`- KẾT LUẬN: AN TOÀN TUYỆT ĐỐI! KHÔNG BỊ LỖI QUÁ BÁN. HỆ THỐNG HOẠT ĐỘNG CHUẨN XÁC!  `);
  } else {
    console.log(`- KẾT LUẬN: Số dư an toàn (>= 0) nhưng số giao dịch thành công là ${successCount}.`);
  }
  console.log('==================================================================');
}

run();
