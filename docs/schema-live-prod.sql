CREATE TABLE `admin_sessions` (
  `token` varchar(64) NOT NULL,
  `expires` bigint(20) NOT NULL,
  PRIMARY KEY (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `capital_equipment` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `description` text NOT NULL,
  `purchase_date` date NOT NULL,
  `purchase_price` decimal(10,2) NOT NULL,
  `receipt_filename` varchar(255) DEFAULT NULL,
  `receipt_orig_name` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `customer_login_attempts` (
  `email_hash` char(32) NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_at` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`email_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `customers` (
  `id` varchar(32) NOT NULL,
  `first_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `sec_question` varchar(255) DEFAULT NULL,
  `sec_answer` varchar(255) DEFAULT NULL,
  `order_count` int(11) DEFAULT 0,
  `joined_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `email_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sent_at` datetime NOT NULL DEFAULT current_timestamp(),
  `email_type` varchar(50) NOT NULL,
  `sent_to` varchar(255) NOT NULL,
  `order_id` varchar(100) NOT NULL,
  `subject` varchar(255) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'sent',
  `error_msg` text DEFAULT NULL,
  `email_body` longtext DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `faqs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `question` text NOT NULL,
  `answer` text NOT NULL,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` varchar(32) NOT NULL,
  `product_id` varchar(32) DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `quantity` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `order_id` (`order_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=345 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `orders` (
  `id` varchar(32) NOT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(50) DEFAULT NULL,
  `shipping_address` text DEFAULT NULL,
  `shipping_carrier` varchar(20) DEFAULT 'USPS',
  `tracking_number` varchar(500) DEFAULT NULL,
  `confirm_sent_at` datetime DEFAULT NULL,
  `shipping_sent_at` datetime DEFAULT NULL,
  `total` decimal(10,2) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT 'Square',
  `status` varchar(50) DEFAULT 'Awaiting Payment',
  `square_payment_id` varchar(255) DEFAULT NULL,
  `order_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `tax_amount` decimal(10,2) DEFAULT 0.00,
  `tax_swept_date` date DEFAULT NULL,
  `order_type` varchar(20) NOT NULL DEFAULT 'Online',
  `transaction_fee` decimal(8,2) NOT NULL DEFAULT 0.00,
  `payment_configuration` varchar(20) DEFAULT 'Online',
  `check_number` varchar(40) DEFAULT NULL,
  `refunded_amount` decimal(10,2) DEFAULT 0.00,
  `paypal_capture_id` varchar(60) DEFAULT NULL,
  `paypal_surcharge` decimal(10,2) DEFAULT 0.00,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `products` (
  `id` varchar(32) NOT NULL,
  `sku` varchar(50) DEFAULT '',
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `stock` int(11) NOT NULL DEFAULT 0,
  `category` varchar(100) DEFAULT NULL,
  `badge` varchar(100) DEFAULT NULL,
  `img1` mediumtext DEFAULT NULL,
  `img2` mediumtext DEFAULT NULL,
  `img3` mediumtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `weight` decimal(6,2) DEFAULT 0.00,
  `size` varchar(255) DEFAULT '',
  `sell` tinyint(1) NOT NULL DEFAULT 1,
  `ship_mode` varchar(10) NOT NULL DEFAULT 'weight',
  `ship_fixed` decimal(10,2) NOT NULL DEFAULT 0.00,
  `coming_soon` tinyint(4) NOT NULL DEFAULT 0,
  `cogm` decimal(10,2) NOT NULL DEFAULT 0.00,
  `launch_date` date NOT NULL DEFAULT '2026-07-01',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `prompt_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `category` varchar(100) NOT NULL DEFAULT '',
  `prompt` text NOT NULL,
  `notes` text NOT NULL DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rate_limits` (
  `key_hash` char(32) NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_at` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`key_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `refunds` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` varchar(40) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `method` varchar(20) NOT NULL,
  `square_refund_id` varchar(60) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'Completed',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `reviews` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `customer_name` varchar(255) NOT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `rating` int(11) DEFAULT 5,
  `review_text` text NOT NULL,
  `status` enum('pending','approved') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `settings` (
  `key_name` varchar(100) NOT NULL,
  `value` longtext DEFAULT NULL,
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `studio_inquiries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `name` varchar(120) NOT NULL,
  `email` varchar(190) NOT NULL,
  `phone` varchar(40) NOT NULL DEFAULT '',
  `project_type` varchar(80) NOT NULL DEFAULT '',
  `budget` varchar(60) NOT NULL DEFAULT '',
  `timeline` varchar(60) NOT NULL DEFAULT '',
  `description` text DEFAULT NULL,
  `contact_pref` varchar(20) NOT NULL DEFAULT '',
  `inspiration` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'inquiry',
  `ip` varchar(45) NOT NULL DEFAULT '',
  `due_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `studio_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `section` varchar(12) NOT NULL,
  `title` varchar(150) NOT NULL DEFAULT '',
  `data` text DEFAULT NULL,
  `image` varchar(255) NOT NULL DEFAULT '',
  `sort_order` int(11) DEFAULT 0,
  `active` tinyint(4) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `studio_project_notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL,
  `note_text` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `subscribers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `subscribed_at` timestamp NULL DEFAULT current_timestamp(),
  `source` varchar(160) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `tax_sweeps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sweep_date` date NOT NULL,
  `period_from` datetime NOT NULL,
  `period_to` datetime NOT NULL,
  `order_count` int(11) NOT NULL DEFAULT 0,
  `total_tax` decimal(10,2) NOT NULL DEFAULT 0.00,
  `order_ids` text DEFAULT NULL,
  `order_details` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE `tn_city_tax` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `city` varchar(100) NOT NULL,
  `county` varchar(50) NOT NULL,
  `tax_rate` decimal(5,4) NOT NULL COMMENT 'Total rate e.g. 0.0975 = 9.75%',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `city_county` (`city`,`county`)
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

