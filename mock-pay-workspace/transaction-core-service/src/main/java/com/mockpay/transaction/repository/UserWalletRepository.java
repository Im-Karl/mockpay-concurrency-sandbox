package com.mockpay.transaction.repository;

import com.mockpay.transaction.entity.UserWallet;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.Optional;

public interface UserWalletRepository extends JpaRepository<UserWallet, String> {

    @Modifying
    @Query(value = "UPDATE user_wallets SET balance = balance - :amount, updated_at = NOW() " +
                   "WHERE wallet_id = :walletId AND balance >= :amount", nativeQuery = true)
    int decreaseBalance(@Param("walletId") String walletId, @Param("amount") BigDecimal amount);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM UserWallet w WHERE w.walletId = :walletId")
    Optional<UserWallet> findByIdForUpdate(@Param("walletId") String walletId);

    @Modifying
    @Query(value = "UPDATE user_wallets SET balance = :balance, updated_at = NOW() WHERE wallet_id = :walletId", nativeQuery = true)
    int updateBalance(@Param("walletId") String walletId, @Param("balance") BigDecimal balance);
}
