-- 1. Bảng quản lý số dư ví người dùng (Đảm bảo tính nhất quán số dư)
CREATE TABLE IF NOT EXISTS user_wallets (
    wallet_id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL UNIQUE,
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'VND',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_positive_balance CHECK (balance >= 0) -- Ràng buộc mức DB không cho phép số dư âm
);

-- 2. Bảng lưu trữ lịch sử giao dịch (Chốt chặn Idempotency mức Slow-path)
CREATE TABLE IF NOT EXISTS payment_transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    wallet_id VARCHAR(50) NOT NULL REFERENCES user_wallets(wallet_id),
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(10) NOT NULL, -- 'CHARGE' (Trừ tiền) hoặc 'REFUND' (Cộng tiền)
    status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'FAILED', 'PENDING'
    idempotency_key VARCHAR(100) NOT NULL UNIQUE, -- RÀNG BUỘC DUY NHẤT (Unique Constraint) chống trùng
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- 3. Bảng Outbox lưu trữ sự kiện cần gửi sang RabbitMQ (Outbox Pattern)
CREATE TABLE IF NOT EXISTS outbox_events (
    event_id VARCHAR(50) PRIMARY KEY,
    aggregate_type VARCHAR(50) NOT NULL, -- Ví dụ: 'PAYMENT'
    aggregate_id VARCHAR(50) NOT NULL,   -- Khớp với transaction_id
    event_type VARCHAR(50) NOT NULL,    -- Ví dụ: 'PAYMENT_SUCCESSFUL'
    payload TEXT NOT NULL,             -- Nội dung sự kiện gửi đi (JSON string)
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSED', 'FAILED'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- 4. Tạo Covering Index để tối ưu truy vấn lịch sử giao dịch
CREATE INDEX IF NOT EXISTS idx_payments_covering 
ON payment_transactions(wallet_id, status, created_at) 
INCLUDE (transaction_id, amount); 
