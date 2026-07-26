package com.mockpay.transaction;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class TransactionCoreApplication {
    public static void main(String[] args) {
        SpringApplication.run(TransactionCoreApplication.class, args);
    }
}
