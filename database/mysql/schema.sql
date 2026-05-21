-- Create database
CREATE DATABASE IF NOT EXISTS fullstack_db;
USE fullstack_db;

-- Create users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  hashed_password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notes table for QuickNotes data
CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
  body TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notes_user_id (user_id),
  INDEX idx_notes_user_updated_at (user_id, updated_at)
);

-- Create greetings table
CREATE TABLE IF NOT EXISTS greetings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample data (idempotent)
INSERT IGNORE INTO greetings (id, message) VALUES (1, 'Hello, World!');
INSERT IGNORE INTO greetings (id, message) VALUES (2, 'Welcome to Full Stack Development!');
INSERT IGNORE INTO greetings (id, message) VALUES (3, 'MySQL, Node.js, and React are working together!');
