// =====================================================
// WATER QUALITY MONITORING DASHBOARD
// LIVE ESP32 + GPS + COLOUR-CODED ALERTS
// =====================================================

// ---------------- DOM HELPER ----------------

const $ = id => document.getElementById(id);


// =====================================================
// MAP INITIALIZATION
// =====================================================

const map = L.map('map').setView([20, 78], 5);

L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        attribution: '© OpenStreetMap contributors'
    }
).addTo(map);

// Blue route line
const track = L.polyline([], {
    color: '#238caf',
    weight: 4
}).addTo(map);

let boat = null;
let history = [];
let lastReceived = 0;
let centered = false;


// =====================================================
// GPS DRIFT FILTER
// =====================================================

const MIN_MOVEMENT_METERS = 15;
const MIN_SPEED_KMH = 0.5;

let lastAcceptedPosition = null;


// =====================================================
// SENSOR CONFIGURATION
// =====================================================

const specs = [
    ['ph', 'pH', 'pH', '#208ba5'],
    ['tds', 'TDS (approx.)', 'ppm', '#35946d'],
    ['turbidityRawADC', 'Turbidity (raw)', 'ADC', '#d99b1c'],
    ['temperature', 'Temperature', '°C', '#517eae']
];


// =====================================================
// STATUS COLOURS
// =====================================================

const STATUS_COLORS = {
    NORMAL: '#228d66',
    CAUTION: '#d5a028',
    CRITICAL: '#d4544b',
    UNKNOWN: '#7892a1'
};

const STATUS_PRIORITY = {
    UNKNOWN: 0,
    NORMAL: 1,
    CAUTION: 2,
    CRITICAL: 3
};


// =====================================================
// CREATE CHART CARDS
// =====================================================

$('charts').innerHTML = specs.map(([key, title, unit]) => `

    <div class="card chartcard">

        <h2>${title}</h2>

        <p class="muted">
            ${unit} · hardware history
        </p>

        <canvas id="chart-${key}"></canvas>

    </div>

`).join('');


// =====================================================
// HELPER FUNCTIONS
// =====================================================

const value = (v, dec = 2) =>
    typeof v === 'number' && Number.isFinite(v)
        ? v.toFixed(dec)
        : 'Not available';

function validNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}


// =====================================================
// TURBIDITY BASELINE
// =====================================================

// First valid turbidity reading is used as baseline.
// Begin testing with clean water.

let turbidityBaseline = null;

function updateTurbidityBaseline() {

    if (turbidityBaseline !== null) {
        return;
    }

    const firstValid = history.find(
        x => validNumber(x.turbidityRawADC)
    );

    if (firstValid) {
        turbidityBaseline = firstValid.turbidityRawADC;
    }
}


// =====================================================
// SENSOR STATUS CLASSIFICATION
// =====================================================

function getSensorStatus(key, reading) {

    if (!validNumber(reading)) {
        return 'UNKNOWN';
    }

    // ---------------- pH ----------------

    if (key === 'ph') {

        if (reading < 5.5 || reading > 9.5) {
            return 'CRITICAL';
        }

        if (reading < 6.5 || reading > 8.5) {
            return 'CAUTION';
        }

        return 'NORMAL';
    }

    // ---------------- TDS ----------------

    if (key === 'tds') {

        if (reading > 600) {
            return 'CRITICAL';
        }

        if (reading > 300) {
            return 'CAUTION';
        }

        return 'NORMAL';
    }

    // ---------------- TEMPERATURE ----------------

    if (key === 'temperature') {

        if (reading > 30) {
            return 'CRITICAL';
        }

        if (reading > 29) {
            return 'CAUTION';
        }

        return 'NORMAL';
    }

    // ---------------- TURBIDITY ----------------

    if (key === 'turbidityRawADC') {

        if (turbidityBaseline === null) {
            return 'UNKNOWN';
        }

        const difference = Math.abs(
            reading - turbidityBaseline
        );

        if (difference > 600) {
            return 'CRITICAL';
        }

        if (difference > 250) {
            return 'CAUTION';
        }

        return 'NORMAL';
    }

    return 'UNKNOWN';
}


// =====================================================
// OVERALL WATER QUALITY STATUS
// =====================================================

function getOverallStatus(reading) {

    let worst = 'UNKNOWN';

    for (const [key] of specs) {

        const status = getSensorStatus(
            key,
            reading[key]
        );

        if (
            STATUS_PRIORITY[status] >
            STATUS_PRIORITY[worst]
        ) {
            worst = status;
        }
    }

    return worst;
}


// =====================================================
// GPS VALIDATION
// =====================================================

function hasValidGPS(reading) {

    return (
        reading &&
        validNumber(reading.latitude) &&
        validNumber(reading.longitude) &&
        reading.latitude >= -90 &&
        reading.latitude <= 90 &&
        reading.longitude >= -180 &&
        reading.longitude <= 180 &&
        reading.gpsStatus === 'FIXED'
    );
}


// =====================================================
// GPS MARKER CREATION
// =====================================================

function createBoatMarker(position) {

    boat = L.circleMarker(position, {

        radius: 10,
        color: 'white',
        weight: 3,
        fillColor: STATUS_COLORS.UNKNOWN,
        fillOpacity: 1

    })
    .addTo(map)
    .bindPopup('Live water quality monitoring station');
}


// =====================================================
// GPS POSITION UPDATE
// =====================================================

function updateBoatPosition(reading) {

    if (!hasValidGPS(reading)) {
        return;
    }

    const newPosition = L.latLng(
        reading.latitude,
        reading.longitude
    );

    // First GPS position
    if (lastAcceptedPosition === null) {

        lastAcceptedPosition = newPosition;

        if (!boat) {
            createBoatMarker(newPosition);
        }

        track.addLatLng(newPosition);

        if (!centered) {
            map.setView(newPosition, 16);
            centered = true;
        }

        return;
    }

    const distance =
        lastAcceptedPosition.distanceTo(newPosition);

    // Ignore GPS drift
    if (distance < MIN_MOVEMENT_METERS) {
        return;
    }

    // Ignore stationary GPS fluctuations
    if (
        validNumber(reading.speed) &&
        reading.speed < MIN_SPEED_KMH
    ) {
        return;
    }

    // Accept movement
    lastAcceptedPosition = newPosition;

    boat.setLatLng(newPosition);

    track.addLatLng(newPosition);
}


// =====================================================
// GPS ROUTE REBUILD
// =====================================================

function rebuildGPSRoute() {

    track.setLatLngs([]);

    lastAcceptedPosition = null;

    if (boat) {
        map.removeLayer(boat);
        boat = null;
    }

    history.forEach(reading => {
        updateBoatPosition(reading);
    });
}


// =====================================================
// UPDATE BOAT MARKER COLOUR
// =====================================================

function updateBoatColor(reading) {

    if (!boat) {
        return;
    }

    const status = getOverallStatus(reading);

    boat.setStyle({
        fillColor: STATUS_COLORS[status]
    });

    boat.bindPopup(`
        <b>Water Quality: ${status}</b><br>
        pH: ${value(reading.ph)}<br>
        TDS: ${value(reading.tds)} ppm<br>
        Turbidity ADC: ${value(reading.turbidityRawADC, 0)}<br>
        Temperature: ${value(reading.temperature)} °C
    `);
}


// =====================================================
// ALERT HISTORY
// =====================================================

let alerts = [];

function generateAlerts(reading) {

    const previous = history.length > 1
        ? history[history.length - 2]
        : null;

    for (const [key, title, unit] of specs) {

        const currentStatus = getSensorStatus(
            key,
            reading[key]
        );

        const previousStatus = previous
            ? getSensorStatus(key, previous[key])
            : 'UNKNOWN';

        // Generate alert only on status change
        if (
            currentStatus !== previousStatus &&
            (
                currentStatus === 'CAUTION' ||
                currentStatus === 'CRITICAL'
            )
        ) {

            alerts.unshift({

                key,
                title,
                unit,

                value: reading[key],

                status: currentStatus,

                timestamp: reading.timestamp
            });
        }
    }

    alerts = alerts.slice(0, 30);
}


// =====================================================
// DISPLAY ALERTS
// =====================================================

function displayAlerts() {

    $('alerts').innerHTML = alerts.length

        ? alerts.slice(0, 8).map(alert => `

            <div class="alert">

                <span style="
                    color:${STATUS_COLORS[alert.status]};
                    font-weight:bold;
                ">
                    ● ${alert.status}
                </span>

                <span>
                    ${alert.title}:
                    ${value(alert.value)}
                    ${alert.unit}
                </span>

                <span>
                    ${new Date(
                        alert.timestamp
                    ).toLocaleTimeString()}
                </span>

            </div>

        `).join('')

        : 'No water quality alerts';
}


// =====================================================
// UPDATE DASHBOARD
// =====================================================

function update() {

    const x = history.at(-1);

    if (!x) {
        return;
    }

    updateTurbidityBaseline();

    // ---------------- DEVICE ----------------

    $('device').textContent =
        'Device: ' + x.deviceId;

    $('clock').textContent =
        'Last received: ' +
        new Date(x.timestamp).toLocaleString();

    // ---------------- SENSOR READINGS ----------------

    $('readings').innerHTML = specs.map(
        ([key, title, unit]) => {

            const reading = x[key];

            const status = getSensorStatus(
                key,
                reading
            );

            const color = STATUS_COLORS[status];

            let description = '';

            if (key === 'turbidityRawADC') {

                description =
                    'Voltage: ' +
                    value(x.turbidityVoltage, 0) +
                    ' mV · Raw ADC';

            } else if (key === 'tds') {

                description =
                    'Approximate TDS estimate';

            } else {

                description =
                    'Live sensor measurement';
            }

            return `

                <div class="reading">

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                    ">

                        <span>${title}</span>

                        <span style="
                            color:${color};
                            font-weight:bold;
                        ">
                            ● ${status}
                        </span>

                    </div>

                    <strong>
                        ${value(reading)}
                        <small>${unit}</small>
                    </strong>

                    <small>${description}</small>

                </div>

            `;

        }
    ).join('');

    // ---------------- GPS INFORMATION ----------------

    const gpsValid = hasValidGPS(x);

    $('gpsBadge').textContent =
        gpsValid ? 'GPS FIXED' : 'GPS NO FIX';

    $('lat').textContent =
        gpsValid
            ? x.latitude.toFixed(6) + '°'
            : 'Not available';

    $('lng').textContent =
        gpsValid
            ? x.longitude.toFixed(6) + '°'
            : 'Not available';

    $('speed').textContent =
        validNumber(x.speed)
            ? value(x.speed) + ' km/h'
            : 'Not available';

    $('sat').textContent =
        `${x.satellites ?? '—'} / ${x.hdop ?? '—'}`;

    // ---------------- MAP ----------------

    rebuildGPSRoute();

    updateBoatColor(x);

    // ---------------- ALERTS ----------------

    displayAlerts();

    // ---------------- GRAPHS ----------------

    drawCharts();
}


// =====================================================
// CENTER MAP BUTTON
// =====================================================

$('center').onclick = () => {

    if (lastAcceptedPosition) {

        map.setView(
            lastAcceptedPosition,
            16
        );
    }
};


// =====================================================
// DRAW SENSOR CHARTS
// =====================================================

function drawCharts() {

    for (const [key, title, unit, color] of specs) {

        const c = $('chart-' + key);

        const ctx = c.getContext('2d');

        const dpr = window.devicePixelRatio || 1;

        const w = c.clientWidth;
        const h = 220;

        if (!w) {
            continue;
        }

        c.width = w * dpr;
        c.height = h * dpr;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const a = history.map(x => x[key]);

        const valid = a.filter(validNumber);

        if (!valid.length) {

            ctx.fillStyle = '#7892a1';

            ctx.fillText(
                'No valid samples yet',
                20,
                40
            );

            continue;
        }

        let lo = Math.min(...valid);
        let hi = Math.max(...valid);

        const pad = (hi - lo) * 0.15 || 1;

        lo -= pad;
        hi += pad;

        const L = 50;
        const R = w - 12;
        const T = 15;
        const B = h - 30;

        ctx.font = '11px Arial';
        ctx.strokeStyle = '#e0eaf0';
        ctx.fillStyle = '#7894a4';

        // Grid
        for (let j = 0; j < 4; j++) {

            const y = T + j * (B - T) / 3;

            ctx.beginPath();
            ctx.moveTo(L, y);
            ctx.lineTo(R, y);
            ctx.stroke();

            ctx.fillText(
                (hi - j * (hi - lo) / 3).toFixed(1),
                4,
                y + 4
            );
        }

        // Graph coordinates
        const point = (v, i) => [

            L +
            (a.length === 1
                ? 0.5
                : i / (a.length - 1)) *
            (R - L),

            B -
            (v - lo) / (hi - lo) *
            (B - T)

        ];

        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;

        ctx.beginPath();

        let started = false;

        a.forEach((v, i) => {

            if (!validNumber(v)) {

                started = false;
                return;
            }

            const [x, y] = point(v, i);

            if (started) {
                ctx.lineTo(x, y);
            } else {
                ctx.moveTo(x, y);
            }

            started = true;
        });

        ctx.stroke();

        // Draw points
        a.forEach((v, i) => {

            if (!validNumber(v)) {
                return;
            }

            const [x, y] = point(v, i);

            ctx.beginPath();

            ctx.arc(
                x,
                y,
                i === a.length - 1 ? 5 : 2.5,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = color;
            ctx.fill();
        });
    }
}


// =====================================================
// RECEIVE SENSOR DATA
// =====================================================

function ingest(x) {

    if (!x || !x.timestamp) {
        return;
    }

    // Avoid duplicate readings
    if (
        history.some(y =>
            y.timestamp === x.timestamp &&
            y.deviceId === x.deviceId
        )
    ) {
        return;
    }

    // Add new reading
    history.push(x);

    // Sort chronologically
    history.sort(
        (a, b) =>
            Date.parse(a.timestamp) -
            Date.parse(b.timestamp)
    );

    // Keep latest 100 readings
    history = history.slice(-100);

    lastReceived = Date.now();

    // Generate alerts
    generateAlerts(x);

    // Update dashboard
    update();
}


// =====================================================
// LOAD PREVIOUS HISTORY
// =====================================================

fetch('/api/sensors/history?limit=100')

    .then(response => response.json())

    .then(rows => {

        rows.forEach(ingest);

        update();
    })

    .catch(error => {

        console.error(
            'Failed to load history:',
            error
        );
    });


// =====================================================
// LIVE DATA STREAM
// =====================================================

const stream = new EventSource('/api/events');

stream.onmessage = event => {

    try {

        const reading = JSON.parse(
            event.data
        );

        ingest(reading);

    } catch (error) {

        console.error(
            'Live data error:',
            error
        );
    }
};


// =====================================================
// BACKEND CONNECTION STATUS
// =====================================================

stream.onerror = () => {

    $('connection').textContent =
        '● Reconnecting to backend…';
};


// =====================================================
// UPDATE CONNECTION INDICATOR
// =====================================================

setInterval(() => {

    $('connection').textContent =

        !lastReceived

            ? '● Waiting for ESP32'

            : Date.now() - lastReceived < 10000

                ? '● LIVE · ESP32 connected'

                : '● STALE · no recent telemetry';

}, 1000);


// =====================================================
// REDRAW GRAPHS ON WINDOW RESIZE
// =====================================================

window.addEventListener(
    'resize',
    drawCharts
);