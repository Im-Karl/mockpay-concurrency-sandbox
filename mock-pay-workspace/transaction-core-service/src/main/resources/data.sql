INSERT INTO user_wallets (wallet_id, user_id, balance, currency, updated_at)
VALUES ('test_wallet', 'user_test_wallet', 10000000.00, 'VND', NOW())
ON CONFLICT (wallet_id) DO NOTHING;
