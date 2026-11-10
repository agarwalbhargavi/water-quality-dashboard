const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = Number(process.env.PORT || 5005);
const DB = path.join(__dirname, 'data', 'readings.jsonl');
const MAX_HISTORY = 500;
let history = [];
let clients = new Set();
fs.mkdirSync(path.dirname(DB), {recursive:true});
if (fs.existsSync(DB)) {
  const lines = fs.readFileSync(DB,'utf8').trim().split('\n').filter(Boolean);
  history = lines.slice(-MAX_HISTORY).flatMap(line => { try {return [JSON.parse(line)]} catch {return []} });
}
app.use(express.json({limit:'20kb'}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health', (_req,res) => res.json({ok:true,latest:history.at(-1)?.timestamp||null,count:history.length}));
app.get('/api/sensors/latest', (_req,res) => res.json(history.at(-1)||null));
app.get('/api/sensors/history', (req,res) => {
  const n = Math.min(Math.max(parseInt(req.query.limit,10)||100,1),MAX_HISTORY);
  res.json(history.slice(-n));
});
app.get('/api/events', (req,res) => {
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  const keepalive = setInterval(()=>res.write(': keepalive\n\n'),20000);
  req.on('close',()=>{clearInterval(keepalive);clients.delete(res)});
});
const numeric = (value,min,max) => value===null || value===undefined ? null : (typeof value==='number' && Number.isFinite(value) && value>=min && value<=max ? value : undefined);
app.post('/api/sensors',(req,res)=>{
  const x=req.body;
  if(!x || typeof x!=='object' || Array.isArray(x)) return res.status(400).json({error:'JSON object required'});
  const fields = {
    ph:numeric(x.ph,0,14),tds:numeric(x.tds,0,1000000),temperature:numeric(x.temperature,-55,125),
    turbidityRawADC:numeric(x.turbidityRawADC,0,4095),turbidityVoltage:numeric(x.turbidityVoltage,0,3300),
    phVoltage:numeric(x.phVoltage,0,3.3),tdsRawADC:numeric(x.tdsRawADC,0,4095),
    latitude:numeric(x.latitude,-90,90),longitude:numeric(x.longitude,-180,180),
    satellites:numeric(x.satellites,0,100),hdop:numeric(x.hdop,0,100),speed:numeric(x.speed,0,500)
  };
  if(Object.values(fields).some(v=>v===undefined)) return res.status(400).json({error:'Invalid numeric field'});
  if((fields.latitude===null)!==(fields.longitude===null)) return res.status(400).json({error:'Latitude and longitude must both be present or null'});
  if(typeof x.deviceId!=='string'||x.deviceId.length>100) return res.status(400).json({error:'deviceId required'});
  const item={deviceId:x.deviceId,...fields,gpsStatus:fields.latitude!==null?'FIXED':'NO_FIX',timestamp:new Date().toISOString()};
  // Raw turbidity ADC/mV is not NTU. Do not fabricate NTU from uncalibrated readings.
  history.push(item); if(history.length>MAX_HISTORY)history.shift();
  fs.appendFile(DB,JSON.stringify(item)+'\n',err=>{if(err)console.error('Persistence error:',err)});
  for(const client of clients)client.write(`data: ${JSON.stringify(item)}\n\n`);
  console.log(item.timestamp,item.deviceId,'pH',item.ph,'GPS',item.latitude,item.longitude);
  res.status(201).json({ok:true,timestamp:item.timestamp});
});
app.listen(PORT,'0.0.0.0',()=>console.log(`Dashboard: http://localhost:${PORT} (listening on 0.0.0.0)`));
