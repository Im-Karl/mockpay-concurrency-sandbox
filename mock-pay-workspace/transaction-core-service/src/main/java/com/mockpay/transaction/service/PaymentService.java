package com.mockpay.transaction.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mockpay.transaction.entity.OutboxEvent;
import com.mockpay.transaction.entity.PaymentTransaction;
import com.mockpay.transaction.entity.UserWallet;
import com.mockpay.transaction.repository.OutboxEventRepository;
import com.mockpay.transaction.repository.PaymentTransactionRepository;
import com.mockpay.transaction.repository.UserWalletRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class PaymentService {

    private final UserWalletRepository walletRepository;
    private final PaymentTransactionRepository transactionRepository;
    private final OutboxEventRepository outboxRepository;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public UserWallet getOrCreateWallet(String walletId, BigDecimal initialBalance) {
        return transactionTemplate.execute(status -> 
            walletRepository.findById(walletId)
                .orElseGet(() -> {
                    UserWallet wallet = new UserWallet();
                    wallet.setWalletId(walletId);
                    wallet.setUserId("user_" + walletId);
                    wallet.setBalance(initialBalance);
                    wallet.setCurrency("VND");
                    wallet.setUpdatedAt(LocalDateTime.now());
                    return walletRepository.save(wallet);
                })
        );
    }

    public TransactionResult processPayment(PaymentRequest request) {
        String walletId = request.getWalletId();
        BigDecimal amount = request.getAmount();
        String method = request.getMethod() != null ? request.getMethod().toLowerCase() : "atomic";
        long latency = request.getLatency() != null ? request.getLatency() : 0;

        if ("atomic".equals(method)) {
            // 1. ATOMIC: Sleep outside of Transaction (Lock-free & Connection-free)
            if (latency > 0) {
                try {
                    Thread.sleep(latency);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }

            return transactionTemplate.execute(status -> {
                int rowsAffected = walletRepository.decreaseBalance(walletId, amount);
                if (rowsAffected == 0) {
                    UserWallet wallet = walletRepository.findById(walletId)
                            .orElseThrow(() -> new RuntimeException("Wallet not found: " + walletId));
                    if (wallet.getBalance().compareTo(amount) < 0) {
                        throw new InsufficientBalanceException("Insufficient balance to execute transaction.");
                    }
                    throw new RuntimeException("Concurrent update conflict.");
                }

                PaymentTransaction tx = createSuccessTransaction(walletId, amount, request.getIdempotencyKey());
                transactionRepository.save(tx);
                saveOutboxEvent(tx);

                return new TransactionResult(tx.getTransactionId(), "SUCCESS", balanceForWallet(walletId));
            });

        } else if ("pessimistic".equals(method)) {
            // 2. PESSIMISTIC: Sleep inside of Transaction holding the Row Lock
            return transactionTemplate.execute(status -> {
                UserWallet wallet = walletRepository.findByIdForUpdate(walletId)
                        .orElseThrow(() -> new RuntimeException("Wallet not found: " + walletId));

                if (latency > 0) {
                    try {
                        log.info("Holding pessimistic lock & sleeping for {}ms", latency);
                        Thread.sleep(latency); // Sleep inside transaction holding lock and connection
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }

                if (wallet.getBalance().compareTo(amount) < 0) {
                    throw new InsufficientBalanceException("Insufficient balance to execute transaction.");
                }

                PaymentTransaction tx = createSuccessTransaction(walletId, amount, request.getIdempotencyKey());
                transactionRepository.save(tx);

                wallet.setBalance(wallet.getBalance().subtract(amount));
                wallet.setUpdatedAt(LocalDateTime.now());
                walletRepository.save(wallet);

                saveOutboxEvent(tx);

                return new TransactionResult(tx.getTransactionId(), "SUCCESS", wallet.getBalance());
            });

        } else {
            // 3. TRADITIONAL: Sleep inside transaction between read and write (causing race conditions)
            return transactionTemplate.execute(status -> {
                UserWallet wallet = walletRepository.findById(walletId)
                        .orElseThrow(() -> new RuntimeException("Wallet not found: " + walletId));

                if (latency > 0) {
                    try {
                        Thread.sleep(latency); // Sleep to allow concurrent reads to get stale balance
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }

                if (wallet.getBalance().compareTo(amount) < 0) {
                    throw new InsufficientBalanceException("Insufficient balance to execute transaction.");
                }

                PaymentTransaction tx = createSuccessTransaction(walletId, amount, request.getIdempotencyKey());
                transactionRepository.save(tx);

                wallet.setBalance(wallet.getBalance().subtract(amount));
                wallet.setUpdatedAt(LocalDateTime.now());
                walletRepository.save(wallet);

                saveOutboxEvent(tx);

                return new TransactionResult(tx.getTransactionId(), "SUCCESS", wallet.getBalance());
            });
        }
    }

    private PaymentTransaction createSuccessTransaction(String walletId, BigDecimal amount, String idempotencyKey) {
        PaymentTransaction tx = new PaymentTransaction();
        tx.setTransactionId(UUID.randomUUID().toString());
        tx.setWalletId(walletId);
        tx.setAmount(amount);
        tx.setType("CHARGE");
        tx.setStatus("SUCCESS");
        tx.setIdempotencyKey(idempotencyKey);
        tx.setCreatedAt(LocalDateTime.now());
        return tx;
    }

    private void saveOutboxEvent(PaymentTransaction tx) {
        OutboxEvent event = new OutboxEvent();
        event.setEventId(UUID.randomUUID().toString());
        event.setAggregateType("PAYMENT");
        event.setAggregateId(tx.getTransactionId());
        event.setEventType("PAYMENT_SUCCESSFUL");
        event.setPayload(convertToJson(tx));
        event.setStatus("PENDING");
        event.setCreatedAt(LocalDateTime.now());
        outboxRepository.save(event);
    }

    private BigDecimal balanceForWallet(String walletId) {
        return walletRepository.findById(walletId)
                .map(UserWallet::getBalance)
                .orElse(BigDecimal.ZERO);
    }

    private String convertToJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }

    // Custom DTOs & Exceptions
    @lombok.Data
    @lombok.AllArgsConstructor
    @lombok.NoArgsConstructor
    public static class PaymentRequest {
        private String walletId;
        private BigDecimal amount;
        private String idempotencyKey;
        private String method;
        private Long latency;
    }

    @lombok.Data
    @lombok.AllArgsConstructor
    public static class TransactionResult {
        private String transactionId;
        private String status;
        private BigDecimal balance;
    }

    public static class InsufficientBalanceException extends RuntimeException {
        public InsufficientBalanceException(String message) {
            super(message);
        }
    }
}
