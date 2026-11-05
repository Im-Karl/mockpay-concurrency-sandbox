package com.mockpay.transaction.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mockpay.transaction.entity.OutboxEvent;
import com.mockpay.transaction.entity.PaymentTransaction;
import com.mockpay.transaction.entity.UserWallet;
import com.mockpay.transaction.repository.OutboxEventRepository;
import com.mockpay.transaction.repository.PaymentTransactionRepository;
import com.mockpay.transaction.repository.UserWalletRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PaymentServiceTest {

    @Mock
    private UserWalletRepository walletRepository;

    @Mock
    private PaymentTransactionRepository transactionRepository;

    @Mock
    private OutboxEventRepository outboxRepository;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private TransactionTemplate transactionTemplate;

    @Captor
    private ArgumentCaptor<PaymentTransaction> transactionCaptor;

    @Captor
    private ArgumentCaptor<OutboxEvent> eventCaptor;

    private PaymentService service;

    @BeforeEach
    void setUp() {
        service = new PaymentService(
                walletRepository,
                transactionRepository,
                outboxRepository,
                objectMapper,
                transactionTemplate
        );

        // Giả lập TransactionTemplate chạy callback ngay lập tức (không cần DB thật)
        when(transactionTemplate.execute(any())).thenAnswer(invocation -> {
            var callback = invocation.getArgument(0);
            return callback.execute(null);
        });
    }

    @Test
    void atomicMode_shouldDeductBalanceAndReturnSuccess() {
        String walletId = "wallet_1";
        BigDecimal amount = new BigDecimal("200000");

        UserWallet wallet = new UserWallet();
        wallet.setWalletId(walletId);
        wallet.setUserId("user_1");
        wallet.setBalance(new BigDecimal("1000000"));
        wallet.setCurrency("VND");

        when(walletRepository.findById(walletId))
                .thenReturn(java.util.Optional.of(wallet));
        when(walletRepository.decreaseBalance(walletId, amount)).thenReturn(1);

        PaymentService.PaymentRequest req = new PaymentService.PaymentRequest();
        req.setWalletId(walletId);
        req.setAmount(amount);
        req.setIdempotencyKey("key-1");
        req.setMethod("atomic");
        req.setLatency(0L);

        PaymentService.TransactionResult result = service.processPayment(req);

        assertEquals("SUCCESS", result.getStatus());
        verify(transactionRepository).save(transactionCaptor.capture());
        assertEquals(walletId, transactionCaptor.getValue().getWalletId());
        assertEquals(amount, transactionCaptor.getValue().getAmount());
        verify(outboxRepository).save(eventCaptor.capture());
        assertEquals("PAYMENT_SUCCESSFUL", eventCaptor.getValue().getEventType());
    }

    @Test
    void atomicMode_shouldRejectWhenBalanceInsufficient() {
        String walletId = "wallet_1";
        BigDecimal amount = new BigDecimal("999999999");

        UserWallet wallet = new UserWallet();
        wallet.setWalletId(walletId);
        wallet.setUserId("user_1");
        wallet.setBalance(new BigDecimal("100000"));
        wallet.setCurrency("VND");

        when(walletRepository.findById(walletId))
                .thenReturn(java.util.Optional.of(wallet));
        when(walletRepository.decreaseBalance(walletId, amount)).thenReturn(0);

        PaymentService.PaymentRequest req = new PaymentService.PaymentRequest();
        req.setWalletId(walletId);
        req.setAmount(amount);
        req.setIdempotencyKey("key-2");
        req.setMethod("atomic");
        req.setLatency(0L);

        assertThrows(PaymentService.InsufficientBalanceException.class, () -> service.processPayment(req));
        verify(transactionRepository, never()).save(any());
    }

    @Test
    void pessimisticMode_shouldDeductBalance() {
        String walletId = "wallet_1";
        BigDecimal amount = new BigDecimal("200000");

        UserWallet wallet = new UserWallet();
        wallet.setWalletId(walletId);
        wallet.setUserId("user_1");
        wallet.setBalance(new BigDecimal("1000000"));
        wallet.setCurrency("VND");

        when(walletRepository.findByIdForUpdate(walletId)).thenReturn(java.util.Optional.of(wallet));

        PaymentService.PaymentRequest req = new PaymentService.PaymentRequest();
        req.setWalletId(walletId);
        req.setAmount(amount);
        req.setIdempotencyKey("key-3");
        req.setMethod("pessimistic");
        req.setLatency(0L);

        PaymentService.TransactionResult result = service.processPayment(req);

        assertEquals("SUCCESS", result.getStatus());
        assertTrue(wallet.getBalance().compareTo(new BigDecimal("800000")) == 0);
        verify(transactionRepository).save(any());
    }

    @Test
    void traditionalMode_shouldAllowRaceConditionDemonstration() {
        String walletId = "wallet_1";
        BigDecimal amount = new BigDecimal("200000");

        UserWallet wallet = new UserWallet();
        wallet.setWalletId(walletId);
        wallet.setUserId("user_1");
        wallet.setBalance(new BigDecimal("1000000"));
        wallet.setCurrency("VND");

        when(walletRepository.findById(walletId)).thenReturn(java.util.Optional.of(wallet));

        PaymentService.PaymentRequest req = new PaymentService.PaymentRequest();
        req.setWalletId(walletId);
        req.setAmount(amount);
        req.setIdempotencyKey("key-4");
        req.setMethod("traditional");
        req.setLatency(0L);

        PaymentService.TransactionResult result = service.processPayment(req);

        assertEquals("SUCCESS", result.getStatus());
        verify(transactionRepository).save(any());
    }

    @Test
    void createSuccessTransaction_shouldSetCorrectFields() {
        var tx = service.createSuccessTransaction("wallet_1", new BigDecimal("100"), "key-x");

        assertEquals("wallet_1", tx.getWalletId());
        assertEquals(new BigDecimal("100"), tx.getAmount());
        assertEquals("CHARGE", tx.getType());
        assertEquals("SUCCESS", tx.getStatus());
        assertEquals("key-x", tx.getIdempotencyKey());
        assertNotNull(tx.getTransactionId());
        assertNotNull(tx.getCreatedAt());
    }

    @Test
    void convertToJson_shouldReturnJsonString() throws Exception {
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"a\":1}");
        String json = service.convertToJson(new Object());
        assertEquals("{\"a\":1}", json);
    }
}
