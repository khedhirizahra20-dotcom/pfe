/*
 * FlexiTrack — ESP32 EMG + RMS + WebSocket
 * Bibliothèque requise : WebSockets by Markus Sattler
 *   → Arduino IDE > Gestionnaire de bibliothèques > "WebSockets"
 *
 * Principe RMS :
 *   1. Échantillonnage à 1000 Hz sur une fenêtre de 100 ms (100 points)
 *   2. Suppression du biais DC (moyenne glissante)
 *   3. RMS = sqrt( mean( (x - mean)² ) )
 *   4. Envoi à FlexiTrack à 10 Hz
 */

#include "WiFi.h"
#include "ESPAsyncWebServer.h"
#include "SPIFFS.h"
#include <WebSocketsClient.h>
#include <math.h>

// ── WiFi ──────────────────────────────────────────────────────────────────────
const char* ssid     = "iPhone de Zeineb";
const char* password = "houcine123456";

// ── FlexiTrack ────────────────────────────────────────────────────────────────
const char* FLEXITRACK_IP   = "172.20.10.11";
const int   FLEXITRACK_PORT = 3000;
const char* WS_PATH         = "/esp32";

// ── Paramètres RMS ────────────────────────────────────────────────────────────
#define PIN_EMG_G     34          // Muscle gauche
#define PIN_EMG_D     35          // Muscle droit
#define WINDOW_SIZE   100         // Points par fenêtre (100 ms à 1000 Hz)
#define SAMPLE_US     1000        // Intervalle d'échantillonnage : 1 ms = 1000 Hz
#define SEND_MS       100         // Envoi WebSocket toutes les 100 ms (10 Hz)
#define ADC_REF_MV    3300.0f     // Tension de référence en mV
#define ADC_MAX       4095.0f     // Résolution 12 bits

// ── Buffers circulaires ───────────────────────────────────────────────────────
static int   bufG[WINDOW_SIZE];
static int   bufD[WINDOW_SIZE];
static int   bufIdx  = 0;
static bool  bufFull = false;

// ── Objets ────────────────────────────────────────────────────────────────────
AsyncWebServer httpServer(80);
WebSocketsClient wsClient;
bool wsConnected = false;

// ── Calcul RMS (suppression DC + RMS de la composante AC) ────────────────────
float calcRMS(int* buf, int size) {
    // Moyenne (biais DC)
    long sum = 0;
    for (int i = 0; i < size; i++) sum += buf[i];
    float mean = (float)sum / size;

    // Variance = mean des carrés de l'écart
    float sumSq = 0.0f;
    for (int i = 0; i < size; i++) {
        float dev = buf[i] - mean;
        sumSq += dev * dev;
    }

    // RMS en ADC brut → conversion en mV
    float rmsRaw = sqrtf(sumSq / size);
    return rmsRaw * (ADC_REF_MV / ADC_MAX);
}

// ── Événements WebSocket ──────────────────────────────────────────────────────
void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            wsConnected = true;
            Serial.println("[FlexiTrack] Connecté ✓");
            break;
        case WStype_DISCONNECTED:
            wsConnected = false;
            Serial.println("[FlexiTrack] Déconnecté — reconnexion...");
            break;
        case WStype_ERROR:
            Serial.println("[FlexiTrack] Erreur WebSocket");
            break;
        default:
            break;
    }
}

void setup() {
    Serial.begin(115200);
    analogReadResolution(12);       // 0–4095
    analogSetAttenuation(ADC_11db); // Plage 0–3.3 V

    if (!SPIFFS.begin(true)) {
        Serial.println("Erreur SPIFFS");
    }

    // Connexion WiFi
    WiFi.begin(ssid, password);
    Serial.print("Connexion WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.print("\nIP ESP32 : ");
    Serial.println(WiFi.localIP());

    // Routes HTTP existantes
    httpServer.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(SPIFFS, "/index.html");
    });
    httpServer.on("/m1", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(200, "text/plain", String(analogRead(PIN_EMG_G)).c_str());
    });
    httpServer.on("/m2", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(200, "text/plain", String(analogRead(PIN_EMG_D)).c_str());
    });
    httpServer.begin();

    // Connexion WebSocket → FlexiTrack
    wsClient.begin(FLEXITRACK_IP, FLEXITRACK_PORT, WS_PATH);
    wsClient.onEvent(onWsEvent);
    wsClient.setReconnectInterval(3000);
}

// ── Boucle principale ─────────────────────────────────────────────────────────
static unsigned long lastSampleUs = 0;
static unsigned long lastSendMs   = 0;

void loop() {
    wsClient.loop();

    unsigned long nowUs = micros();
    unsigned long nowMs = millis();

    // ── Échantillonnage à 1000 Hz ─────────────────────────────────────────────
    if (nowUs - lastSampleUs >= SAMPLE_US) {
        lastSampleUs = nowUs;

        bufG[bufIdx] = analogRead(PIN_EMG_G);
        bufD[bufIdx] = analogRead(PIN_EMG_D);
        bufIdx++;

        if (bufIdx >= WINDOW_SIZE) {
            bufIdx  = 0;
            bufFull = true;
        }
    }

    // ── Envoi RMS à 10 Hz (seulement si fenêtre complète) ────────────────────
    if (wsConnected && bufFull && (nowMs - lastSendMs >= SEND_MS)) {
        lastSendMs = nowMs;

        float rmsG = calcRMS(bufG, WINDOW_SIZE); // mV RMS muscle gauche
        float rmsD = calcRMS(bufD, WINDOW_SIZE); // mV RMS muscle droit

        String msg = String(rmsG, 1) + "," + String(rmsD, 1);
        wsClient.sendTXT(msg);

        Serial.printf("[EMG RMS] G=%.1f mV   D=%.1f mV\n", rmsG, rmsD);
    }
}
