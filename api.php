<?php
http_response_code(410);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['success'=>false,'message'=>'Utilisez le backend Node.js sur Hetzner via /api. Ce point PHP historique n’est plus utilisé.']);
