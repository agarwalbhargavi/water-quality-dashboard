# Live ESP32 water-quality dashboard

## Requirements
- Node.js 18+ (Node 20/22/24 recommended)
- Arduino IDE with ESP32 board package
- Arduino libraries: OneWire, DallasTemperature, TinyGPSPlus; WiFi and HTTPClient come with ESP32 core
- ESP32 + pH, TDS, turbidity, DS18B20, GPS receiver

## Folder structure
```
water-quality-live/
  package.json
  server.js
  public/
    index.html
    app.js
  firmware/
    water_quality_esp32.ino
  data/
    readings.jsonl      # created automatically on first POST
```

## Start backend (macOS Terminal)
```
cd water-quality-live
npm install
npm start
```
Open `http://localhost:5005` on your computer. `http://localhost:5005/api/health` verifies the server. The browser automatically listens for updates via server-sent events (SSE).

## Find the Mac LAN IP
Run `ipconfig getifaddr en0` (for Wi-Fi on many Macs). If blank, run `ifconfig` and find the active Wi-Fi IPv4 address in System Settings > Wi-Fi > Details > TCP/IP. It might be `192.168.1.5` but **must be checked**. Set `SERVER_URL` in the `.ino` file to `http://YOUR_MAC_LAN_IP:5005/api/sensors`. Do NOT use `localhost` or `127.0.0.1` in the ESP32 sketch.

## Arduino configuration
1. In `firmware/water_quality_esp32.ino`, replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with your 2.4 GHz Wi-Fi credentials. **Do not commit passwords to GitHub.**
2. Replace `SERVER_URL` with the Mac's current Wi-Fi IPv4 address.
3. ESP32 RX16 <- GPS TX; ESP32 TX17 -> GPS RX (if used); connect grounds. `TX2/RX2` are UART labels, not the same as GPS TX/RX pin directions. Check your ESP32 board pinout and GPS module voltage requirements.
4. Select your ESP32 board and serial port in Arduino IDE; upload; open Serial Monitor at 115200 baud.
5. Test GPS outdoors with clear sky. `GPS chars: 0` means serial data is not arriving: check power, common ground, swapped RX/TX, baud rate (often 9600), and wiring. Nonzero chars with NO_FIX means data is arriving but the receiver has not yet obtained a valid location; allow several minutes outdoors. Do not invent coordinates when there is no fix.
6. Keep `npm start` running on the computer. Watch the serial monitor for `HTTP POST status: 201`. The dashboard updates automatically, with no second terminal or sample-data command needed.

## Test backend without hardware (optional)
In a **second** terminal:
```
curl -i -X POST http://localhost:5005/api/sensors \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"test-only","ph":7.2,"tds":450,"turbidityRawADC":1800,"turbidityVoltage":1450,"temperature":27.3,"latitude":13.08,"longitude":80.3,"speed":0,"satellites":8,"hdop":1.2}'
```
The test sample persists to `data/readings.jsonl`. Delete that file with the server stopped if you want to clear test history. This is a test only, not live sensor data.

## Troubleshooting
- `HTTP -1`: wrong IP, different networks, firewall blocking port 5005, server not running, or hotspot client isolation. On the ESP32 network, test `http://YOUR_MAC_LAN_IP:5005/api/health` from another phone/computer. macOS may prompt to allow Node incoming connections.
- `HTTP 400`: invalid payload; inspect response body in Serial Monitor.
- `HTTP 201`: saved and broadcast; reload browser if necessary.
- Browser waiting: verify `/api/health` and `/api/sensors/latest`, then browser DevTools Console/Network. CDN internet access is needed for Leaflet map tiles/library.
- GPS fix missing: use outdoor sky view; inspect `GPS chars` and wiring.
- Temperature missing: check DS18B20 power and a typical 4.7 kΩ pull-up from data to 3.3V.
- Analog inputs must never exceed ESP32 safe input voltage. Check sensor module output range, grounding, and calibration.

## Measurement cautions
- The provided turbidity code reports **raw ADC and millivolts**, NOT NTU. The dashboard intentionally does not fabricate NTU. Calibrate your sensor and implement a conversion before reporting NTU.
- The supplied TDS polynomial is an approximate formula for compatible probes and **not a validated seawater salinity/TDS measurement**. Marine water near 35,000 ppm exceeds the useful range of many low-cost TDS probes. Verify sensor range and calibrate for your environment.
- pH calibration voltages are example values; perform actual buffer calibration. The dashboard's alert rules are provisional, not regulatory thresholds.
- The firmware uses non-blocking DS18B20 conversion setup; the first measurement may be unavailable until conversion completes. Repeated POST requests every ~2 seconds may briefly pause GPS parsing; UART buffer is increased to reduce dropped bytes.
- For deployment beyond a trusted local network, add authentication, TLS, rate limiting and database retention policies.
# water-quality-dashboard
