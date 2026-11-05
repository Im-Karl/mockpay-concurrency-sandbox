package com.mockpay.transaction.controller;

import com.mockpay.transaction.entity.UserWallet;
import com.mockpay.transaction.repository.UserWalletRepository;
import com.mockpay.transaction.service.PaymentService;
import com.mockpay.transaction.service.PaymentService.InsufficientBalanceException;
import com.mockpay.transaction.service.PaymentService.PaymentRequest;
import com.mockpay.transaction.service.PaymentService.TransactionResult;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

@RestController
@RequestMapping("/api/wallets")
@RequiredArgsConstructor
// TODO: Thay @CrossOrigin("*") bằng CORS cấu hình đúng origin production.
// TODO: Thêm Spring Security + JWT để bảo vệ endpoint này.

public class WalletController {

    private final PaymentService paymentService;
    private final UserWalletRepository userWalletRepository;

    @PostMapping
    public ResponseEntity<UserWallet> getOrCreateWallet(@RequestBody CreateWalletRequest request) {
        UserWallet wallet = paymentService.getOrCreateWallet(request.getId(), request.getInitialBalance());
        return ResponseEntity.ok(wallet);
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserWallet> getWallet(@PathVariable String id) {
        try {
            UserWallet wallet = paymentService.getOrCreateWallet(id, BigDecimal.ZERO);
            return ResponseEntity.ok(wallet);
        } catch (Exception e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/{id}/deduct")
    public ResponseEntity<?> deduct(
            @PathVariable String id,
            @RequestParam(defaultValue = "atomic") String method,
            @RequestParam(defaultValue = "0") Long latency,
            @RequestBody DeductBody body) {
        try {
            PaymentRequest req = new PaymentRequest();
            req.setWalletId(id);
            req.setAmount(body.getAmount());
            req.setIdempotencyKey(body.getIdempotencyKey());
            req.setMethod(method);
            req.setLatency(latency);

            TransactionResult result = paymentService.processPayment(req);
            return ResponseEntity.ok(result);
        } catch (InsufficientBalanceException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            // Bao gồm lỗi trùng lặp khoá ngoại vi (idempotency key constraint)
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Database Transaction Error"));
        }
    }

    @PostMapping("/{id}/reset")
    public ResponseEntity<UserWallet> resetWallet(@PathVariable String id, @RequestBody ResetBody request) {
        UserWallet wallet = paymentService.getOrCreateWallet(id, BigDecimal.ZERO);
        wallet.setBalance(request.getBalance());
        wallet.setUpdatedAt(LocalDateTime.now());
        UserWallet saved = userWalletRepository.save(wallet);
        return ResponseEntity.ok(saved);
    }

    @Data
    public static class CreateWalletRequest {
        private String id;
        private BigDecimal initialBalance;
    }

    @Data
    public static class DeductBody {
        private BigDecimal amount;
        private String idempotencyKey;
    }

    @Data
    public static class ResetBody {
        private BigDecimal balance;
    }
}
