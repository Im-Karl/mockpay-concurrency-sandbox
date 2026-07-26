package com.mockpay.transaction.scheduler;

import com.mockpay.transaction.config.RabbitMQConfig;
import com.mockpay.transaction.entity.OutboxEvent;
import com.mockpay.transaction.repository.OutboxEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
@Slf4j
public class OutboxPublisher {

    private final OutboxEventRepository outboxRepository;
    private final RabbitTemplate rabbitTemplate;

    @Scheduled(fixedDelay = 1000)
    @Transactional
    public void processOutboxEvents() {
        List<OutboxEvent> pendingEvents = outboxRepository.findByStatus("PENDING");
        if (pendingEvents.isEmpty()) {
            return;
        }

        log.info("Outbox Scan: Found {} pending outbox events", pendingEvents.size());

        for (OutboxEvent event : pendingEvents) {
            try {
                // Publish event payload to RabbitMQ Exchange
                rabbitTemplate.convertAndSend(
                        RabbitMQConfig.EXCHANGE,
                        RabbitMQConfig.ROUTING_KEY,
                        event.getPayload()
                );

                // Mark event as processed
                event.setStatus("PROCESSED");
                event.setProcessedAt(LocalDateTime.now());
                outboxRepository.save(event);
                log.info("Successfully published outbox event_id: {} to RabbitMQ", event.getEventId());
            } catch (Exception e) {
                // Retain PENDING status for retry in the next cycle on connection error
                log.error("Failed to publish outbox event to RabbitMQ: {}", e.getMessage());
                break;
            }
        }
    }
}
