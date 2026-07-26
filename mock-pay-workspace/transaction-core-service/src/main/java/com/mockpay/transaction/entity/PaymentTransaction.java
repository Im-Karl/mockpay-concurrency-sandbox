package com.mockpay.transaction.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "payment_transactions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PaymentTransaction {
    @Id
    @Column(name = "transaction_id", length = 50)
    private String transactionId;

    @Column(name = "wallet_id", length = 50, nullable = false)
    private String walletId;

    @Column(name = "amount", nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(name = "type", length = 10, nullable = false)
    private String type; // 'CHARGE' or 'REFUND'

    @Column(name = "status", length = 20, nullable = false)
    private String status; // 'SUCCESS', 'FAILED', 'PENDING'

    @Column(name = "idempotency_key", length = 100, nullable = false, unique = true)
    private String idempotencyKey;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "description")
    private String description;
}
