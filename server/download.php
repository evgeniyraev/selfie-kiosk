<?php

require __DIR__ . '/config.php';

$fileId = sanitize_filename($_GET['id'] ?? '');

$uploadsRoot = realpath(UPLOAD_DIR);
$targetPath = $fileId ? realpath(UPLOAD_DIR . DIRECTORY_SEPARATOR . $fileId) : false;
$isValidFile = $uploadsRoot && $targetPath && strpos($targetPath, $uploadsRoot) === 0 && is_file($targetPath);

if (!$isValidFile) {
    http_response_code(404);
    echo <<<HTML
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Photo not found</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b1120; color:#fff; margin:0; display:flex; min-height:100vh; align-items:center; justify-content:center; text-align:center; padding:20px;}
      .card { padding:32px; background:rgba(255,255,255,0.05); border-radius:24px; max-width:480px; }
      a { color:#61dafb; text-decoration:none; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Photo not found</h1>
      <p>The link you opened has expired or is invalid. Please capture a new selfie to generate a fresh QR code.</p>
      <p><a href="https://interactivebulgaria.bg/">interactivebulgaria.bg</a></p>
    </div>
  </body>
</html>
HTML;
    exit;
}

$relativePath = 'uploads/' . rawurlencode($fileId);
$lastModified = date('F j, Y g:i A', filemtime($targetPath));

?>
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your holiday selfie is ready</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: radial-gradient(circle at top, #1f2937 0%, #030712 80%);
        color: #f9fafb;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      main {
        width: min(900px, 100%);
        background: rgba(15, 23, 42, 0.85);
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.7);
        border-radius: 32px;
        overflow: hidden;
      }
      .photo-wrapper {
        width: 100%;
        aspect-ratio: 3 / 2;
        background: #111827;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .photo-wrapper img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: 24px;
        box-shadow: inset 0 0 45px rgba(0, 0, 0, 0.35);
      }
      .meta {
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .meta h1 {
        font-size: clamp(24px, 5vw, 36px);
        margin: 0;
      }
      .meta p {
        margin: 0;
        color: #cbd5f5;
      }
      .actions {
        margin-top: 20px;
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }
      .actions a {
        flex: 1;
        min-width: 200px;
        text-align: center;
        text-decoration: none;
        padding: 14px 24px;
        border-radius: 999px;
        font-weight: 600;
        transition: transform 150ms ease, box-shadow 150ms ease;
      }
      .actions a.primary {
        background: linear-gradient(135deg, #fb7185, #f43f5e);
        color: #fff;
        box-shadow: 0 20px 40px rgba(244, 63, 94, 0.35);
      }
      .actions a.secondary {
        border: 2px solid rgba(148, 163, 184, 0.5);
        color: #e2e8f0;
      }
      .actions a:hover {
        transform: translateY(-2px);
      }
      footer {
        padding: 16px 32px 32px;
        text-align: center;
        font-size: 14px;
        color: #94a3b8;
      }
      @media (max-width: 640px) {
        main {
          border-radius: 24px;
        }
        .photo-wrapper {
          aspect-ratio: 3 / 4;
          padding: 10px;
        }
        .meta {
          padding: 20px;
        }
        .actions {
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="photo-wrapper">
        <img src="<?= htmlspecialchars($relativePath, ENT_QUOTES) ?>" alt="Your captured photo" />
      </div>
      <div class="meta">
        <h1>Your holiday selfie is ready!</h1>
        <div class="actions">
          <a class="primary" href="<?= htmlspecialchars($relativePath, ENT_QUOTES) ?>" download>Download photo</a>
        </div>
      </div>
    </main>
  </body>
</html>
