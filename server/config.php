<?php

const BASE_URL = 'https://interactivebulgaria.bg';
const UPLOAD_DIR = __DIR__ . '/uploads';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB limit for safety

/**
 * Ensures the upload directory exists.
 */
function ensure_upload_dir(): void
{
    if (!is_dir(UPLOAD_DIR)) {
        mkdir(UPLOAD_DIR, 0775, true);
    }
}

/**
 * Sends a JSON response and terminates the script.
 */
function respond_json(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}

/**
 * Normalizes a requested filename to avoid path traversal.
 */
function sanitize_filename(?string $value): string
{
    $value = $value ?? '';
    $value = basename($value);
    return trim($value);
}
