#include <WiFi.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPSPlus.h>

// EDIT THESE: use a 2.4 GHz network; computer and ESP32 must be on the same LAN.
const char* WIFI_SSID = "bhargavi";
const char* WIFI_PASSWORD = "bhargavi123";
// Computer's LAN IPv4, NOT localhost, NOT the ESP32's IP.
const char* SERVER_URL = "http://10.231.142.92:5005/api/sensors";
#define PH_PIN 34
#define TDS_PIN 32
#define TURBIDITY_PIN 35
#define TEMP_PIN 4
// ESP32 RX16 connects to GPS TX; ESP32 TX17 connects to GPS RX.
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17
const float PH4_VOLTAGE=1.50,PH7_VOLTAGE=2.00,PH9_VOLTAGE=2.50;
const unsigned long SENSOR_INTERVAL=2000, WIFI_RETRY_INTERVAL=10000, GPS_MAX_AGE=5000;
OneWire oneWire(TEMP_PIN);
DallasTemperature tempSensor(&oneWire);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
unsigned long lastSensorTime=0,lastWiFiRetry=0;
float temperatureC=DEVICE_DISCONNECTED_C,phVoltage=0,pH=0,tdsPPM=0;
int tdsRaw=0,turbidityRaw=0,turbidityMilliVolts=0;
void readGPS(){while(gpsSerial.available())gps.encode(gpsSerial.read());}
bool gpsFixed(){return gps.location.isValid()&&gps.location.age()<GPS_MAX_AGE;}
void connectWiFi(){if(WiFi.status()==WL_CONNECTED)return;Serial.println("Connecting to Wi-Fi...");WiFi.disconnect();WiFi.begin(WIFI_SSID,WIFI_PASSWORD);}
void readTemperature(){tempSensor.requestTemperatures();temperatureC=tempSensor.getTempCByIndex(0);}
void readPH(){long total=0;for(int i=0;i<100;i++){total+=analogRead(PH_PIN);readGPS();delay(5);}phVoltage=(total/100.0f)*3.3f/4095.0f;if(phVoltage>=PH7_VOLTAGE)pH=7+(phVoltage-PH7_VOLTAGE)/(PH9_VOLTAGE-PH7_VOLTAGE)*2;else pH=7+(phVoltage-PH7_VOLTAGE)/(PH7_VOLTAGE-PH4_VOLTAGE)*3;pH=constrain(pH,0.0f,14.0f);}
void readTDS(){tdsRaw=analogRead(TDS_PIN);float v=analogReadMilliVolts(TDS_PIN)/1000.0f;float comp=temperatureC==DEVICE_DISCONNECTED_C?1.0f:1+0.02f*(temperatureC-25);v/=comp;tdsPPM=(133.42f*v*v*v-255.86f*v*v+857.39f*v)*0.5f;if(tdsPPM<0)tdsPPM=0;}
void readTurbidity(){turbidityRaw=analogRead(TURBIDITY_PIN);turbidityMilliVolts=analogReadMilliVolts(TURBIDITY_PIN);}
void sendData(){if(WiFi.status()!=WL_CONNECTED){Serial.println("POST skipped: Wi-Fi disconnected");return;}WiFiClient client;HTTPClient http;http.setTimeout(4000);if(!http.begin(client,SERVER_URL)){Serial.println("Invalid server URL");return;}http.addHeader("Content-Type","application/json");String j="{";j+="\"deviceId\":\"ocean-cleaner-esp32\",";j+="\"ph\":"+String(pH,2)+",\"phVoltage\":"+String(phVoltage,3)+",";j+="\"tds\":"+String(tdsPPM,2)+",\"tdsRawADC\":"+String(tdsRaw)+",";j+="\"turbidityRawADC\":"+String(turbidityRaw)+",\"turbidityVoltage\":"+String(turbidityMilliVolts)+",";j+="\"temperature\":";j+=temperatureC==DEVICE_DISCONNECTED_C?"null":String(temperatureC,2);j+=",\"latitude\":";j+=gpsFixed()?String(gps.location.lat(),6):"null";j+=",\"longitude\":";j+=gpsFixed()?String(gps.location.lng(),6):"null";j+=",\"gpsStatus\":\"";j+=gpsFixed()?"FIXED":"NO_FIX";j+="\",\"satellites\":";j+=(gps.satellites.isValid()&&gps.satellites.age()<GPS_MAX_AGE)?String(gps.satellites.value()):"null";j+=",\"hdop\":";j+=(gps.hdop.isValid()&&gps.hdop.age()<GPS_MAX_AGE)?String(gps.hdop.hdop(),2):"null";j+=",\"speed\":";j+=(gpsFixed()&&gps.speed.isValid()&&gps.speed.age()<GPS_MAX_AGE)?String(gps.speed.kmph(),2):"null";j+="}";Serial.println(j);int code=http.POST(j);Serial.printf("HTTP POST status: %d\n",code);if(code<0)Serial.println(http.errorToString(code));else Serial.println(http.getString());http.end();}
void setup(){Serial.begin(115200);analogReadResolution(12);analogSetPinAttenuation(PH_PIN,ADC_11db);analogSetPinAttenuation(TDS_PIN,ADC_11db);analogSetPinAttenuation(TURBIDITY_PIN,ADC_11db);tempSensor.begin();tempSensor.setWaitForConversion(false);gpsSerial.setRxBufferSize(1024);gpsSerial.begin(9600,SERIAL_8N1,GPS_RX_PIN,GPS_TX_PIN);WiFi.mode(WIFI_STA);WiFi.setSleep(false);connectWiFi();lastSensorTime=millis()-SENSOR_INTERVAL;Serial.println("ESP32 water monitoring started");}
void loop(){readGPS();unsigned long now=millis();if(WiFi.status()!=WL_CONNECTED&&now-lastWiFiRetry>=WIFI_RETRY_INTERVAL){lastWiFiRetry=now;connectWiFi();}if(now-lastSensorTime>=SENSOR_INTERVAL){lastSensorTime=now;readTemperature();readGPS();readPH();readTDS();readTurbidity();readGPS();Serial.printf("WiFi: %s | GPS: %s | sats: %d | GPS chars: %lu\n",WiFi.status()==WL_CONNECTED?"CONNECTED":"DISCONNECTED",gpsFixed()?"FIXED":"NO_FIX",gps.satellites.isValid()?gps.satellites.value():0,gps.charsProcessed());sendData();}}
