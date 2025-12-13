<?php

require __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond_json(405, ['error' => 'Method not allowed']);
}

$rawInput = file_get_contents('php://input');
$payload = json_decode($rawInput, true);

if (!$payload || empty($payload['imageData'])) {
    respond_json(400, ['error' => 'Missing image payload.']);
}

$matches = [];
if (!preg_match('/^data:image\/(png|jpe?g);base64,(.+)$/', $payload['imageData'], $matches)) {
    respond_json(400, ['error' => 'Unsupported image format. Use PNG or JPEG data URLs.']);
}

$extension = strtolower($matches[1]) === 'jpeg' ? 'jpg' : strtolower($matches[1]);
$imageBinary = base64_decode($matches[2], true);

if ($imageBinary === false) {
    respond_json(400, ['error' => 'Invalid base64 payload.']);
}

if (strlen($imageBinary) > MAX_UPLOAD_BYTES) {
    respond_json(400, ['error' => 'Image exceeds maximum allowed size.']);
}

ensure_upload_dir();

$filename = uniqid('selfy_', true) . '.' . $extension;
$filePath = rtrim(UPLOAD_DIR, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $filename;

if (file_put_contents($filePath, $imageBinary) === false) {
    respond_json(500, ['error' => 'Failed to store image.']);
}

$downloadUrl = BASE_URL . '/server/download.php?id=' . rawurlencode($filename);

respond_json(200, [
    'success' => true,
    'downloadUrl' => $downloadUrl,
]);
