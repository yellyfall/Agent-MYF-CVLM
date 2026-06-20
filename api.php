<?php
/**
 * Agent IA de MYF - API Backend
 * Fichier : api.php
 * Placer dans : C:\laragon\www\myf\api.php
 */

header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── FICHIER DE BASE DE DONNEES ─────────────────────────────────────────────
define('DB_FILE', __DIR__ . '/myf_data.json');

function readDB() {
    if (!file_exists(DB_FILE)) {
        $default = ["admin_key" => "", "users" => []];
        file_put_contents(DB_FILE, json_encode($default, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return $default;
    }
    $content = file_get_contents(DB_FILE);
    $data = json_decode($content, true);
    if (!$data) return ["admin_key" => "", "users" => []];
    return $data;
}

function writeDB($data) {
    file_put_contents(DB_FILE, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function resp($success, $data = [], $message = "") {
    echo json_encode(["success" => $success, "message" => $message, "data" => $data]);
    exit;
}

// ── LECTURE ACTION ─────────────────────────────────────────────────────────
$body = json_decode(file_get_contents("php://input"), true) ?? [];
$action = $body["action"] ?? $_GET["action"] ?? "";

// ── ACTIONS ───────────────────────────────────────────────────────────────

// Vérifier si admin key est définie
if ($action === "check_setup") {
    $db = readDB();
    resp(true, ["configured" => !empty($db["admin_key"])]);
}

// Admin : sauvegarder la clé API
if ($action === "admin_set_key") {
    $key = trim($body["key"] ?? "");
    if (empty($key)) resp(false, [], "Clé API manquante.");
    
    // Vérification de la clé via Mistral
    $ch = curl_init("https://api.mistral.ai/v1/models");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer $key"],
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        $errData = json_decode($result, true);
        $msg = $errData["message"] ?? $errData["detail"] ?? "Clé API invalide (HTTP $httpCode)";
        resp(false, [], $msg);
    }

    $db = readDB();
    $db["admin_key"] = $key;
    writeDB($db);
    resp(true, [], "Clé API sauvegardée et vérifiée.");
}

// Admin : vérifier la clé pour se connecter
if ($action === "admin_login") {
    $key = trim($body["key"] ?? "");
    if (empty($key)) resp(false, [], "Clé API manquante.");
    $db = readDB();
    if ($db["admin_key"] !== $key) resp(false, [], "Clé API incorrecte. Vous devez utiliser la même clé que celle configurée.");
    resp(true, ["role" => "admin"]);
}

// Admin : récupérer la liste des users
if ($action === "get_users") {
    $key = trim($body["admin_key"] ?? "");
    $db = readDB();
    if ($db["admin_key"] !== $key) resp(false, [], "Non autorisé.");
    resp(true, ["users" => $db["users"]]);
}

// Admin : créer un utilisateur
if ($action === "create_user") {
    $key = trim($body["admin_key"] ?? "");
    $db = readDB();
    if ($db["admin_key"] !== $key) resp(false, [], "Non autorisé.");

    $username = trim($body["username"] ?? "");
    $password = trim($body["password"] ?? "");
    $fullname = trim($body["fullname"] ?? "");
    $expires  = trim($body["expires"] ?? "");  // date YYYY-MM-DD ou vide

    if (empty($username) || empty($password)) resp(false, [], "Nom d'utilisateur et mot de passe requis.");

    foreach ($db["users"] as $u) {
        if ($u["username"] === $username) resp(false, [], "Ce nom d'utilisateur existe déjà.");
    }

    $db["users"][] = [
        "id"        => uniqid("u_", true),
        "username"  => $username,
        "password"  => $password,
        "fullname"  => $fullname ?: $username,
        "status"    => "active",
        "expires"   => $expires,
        "createdAt" => date("d/m/Y"),
    ];
    writeDB($db);
    resp(true, [], "Accès créé avec succès.");
}

// Admin : modifier statut ou supprimer
if ($action === "update_user") {
    $key = trim($body["admin_key"] ?? "");
    $db = readDB();
    if ($db["admin_key"] !== $key) resp(false, [], "Non autorisé.");

    $id     = $body["id"] ?? "";
    $op     = $body["op"] ?? "";  // pause | resume | delete | set_expiry

    foreach ($db["users"] as &$u) {
        if ($u["id"] === $id) {
            if ($op === "pause")       $u["status"] = "paused";
            elseif ($op === "resume")  $u["status"] = "active";
            elseif ($op === "delete")  { $u = null; break; }
            elseif ($op === "set_expiry") $u["expires"] = $body["expires"] ?? "";
            break;
        }
    }
    $db["users"] = array_values(array_filter($db["users"]));
    writeDB($db);
    resp(true, [], "Mise à jour effectuée.");
}

// Utilisateur : connexion
if ($action === "user_login") {
    $username = trim($body["username"] ?? "");
    $password = trim($body["password"] ?? "");
    $db = readDB();

    if (empty($db["admin_key"])) resp(false, [], "L'administrateur n'a pas encore configuré son accès. Veuillez le contacter.");

    foreach ($db["users"] as $u) {
        if ($u["username"] === $username && $u["password"] === $password) {
            if ($u["status"] === "paused") resp(false, [], "Votre accès est temporairement suspendu. Contactez l'administrateur.");

            // Vérification expiration
            if (!empty($u["expires"])) {
                $expDate = DateTime::createFromFormat("Y-m-d", $u["expires"]);
                if ($expDate && $expDate < new DateTime()) {
                    resp(false, [], "Votre accès a expiré le " . $expDate->format("d/m/Y") . ". Contactez l'administrateur.");
                }
            }

            resp(true, [
                "username" => $u["username"],
                "fullname" => $u["fullname"],
                "role"     => "user",
                "api_key"  => $db["admin_key"],
            ]);
        }
    }
    resp(false, [], "Nom d'utilisateur ou mot de passe incorrect.");
}

// Requête inconnue
resp(false, [], "Action inconnue : $action");
?>
