const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const proxy = require('express-http-proxy');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Trust proxy for X-Forwarded-For headers from Render
app.set('trust proxy', true);

// --- Email Notifications (SMTP via Resend) ---
const sentEmails = new Set(); // Prevent duplicate emails for the same charge
async function sendAdminNotification(charge) {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!apiKey || !adminEmail) {
    console.warn('⚠️ SMTP/Resend not configured. Skipping email notification.');
    return;
  }

  if (sentEmails.has(charge.id)) return;
  sentEmails.add(charge.id);

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true, // Use SSL for port 465
      auth: {
        user: 'resend',
        pass: apiKey,
      },
    });

    const amount = charge.fiat_value ? `$${(charge.fiat_value / 100).toFixed(2)}` : (charge.amount / 1e8).toFixed(8) + ' BTC';
    
    await transporter.sendMail({
      from: 'CashApp Alerts <alerts@pay.cashap.shop>',
      to: adminEmail,
      subject: `💰 New Payment Received: ${amount}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333; background-color: #f9f9f9; border-radius: 10px; max-width: 600px; margin: auto; border: 1px solid #eee;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #00FF41; margin: 0; font-size: 24px;">Payment Confirmed!</h2>
            <p style="color: #666; margin: 5px 0;">A new transaction has been successfully paid.</p>
          </div>
          
          <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #eee;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; color: #888; font-size: 14px; border-bottom: 1px solid #f5f5f5;">Amount</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; font-size: 18px; color: #000; border-bottom: 1px solid #f5f5f5;">${amount}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888; font-size: 14px; border-bottom: 1px solid #f5f5f5;">Status</td>
                <td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #f5f5f5;"><span style="background: #00FF41; color: #000; padding: 4px 10px; border-radius: 100px; font-size: 12px; font-weight: bold; text-transform: uppercase;">${charge.status}</span></td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888; font-size: 14px; border-bottom: 1px solid #f5f5f5;">Invoice ID</td>
                <td style="padding: 10px 0; text-align: right; font-family: monospace; font-size: 13px; color: #00FF41; border-bottom: 1px solid #f5f5f5;">${charge.id}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888; font-size: 14px; border-bottom: 1px solid #f5f5f5;">Customer Email</td>
                <td style="padding: 10px 0; text-align: right; font-size: 14px; color: #333; border-bottom: 1px solid #f5f5f5;">${charge.customer_email || 'Guest'}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888; font-size: 14px;">Description</td>
                <td style="padding: 10px 0; text-align: right; font-size: 14px; color: #333;">${charge.description || 'N/A'}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #888;">
            <p>This is an automated alert from your Admin Panel.</p>
            <p>&copy; ${new Date().getFullYear()} CashApp Gateway</p>
          </div>
        </div>
      `
    });
    console.log(`📧 SMTP Notification email sent for charge ${charge.id}`);
  } catch (error) {
    console.error('❌ SMTP Email notification failed:', error.message);
  }
}

// --- Production Security ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https://api.qrserver.com"],
      frameSrc: ["'self'", "https:"],
      connectSrc: ["'self'", "https://pay.polapine.com", "https://ohkessuokmozfwldmqgs.supabase.co", "https://api.coingecko.com"]
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/api/check-payment', // Skip rate limit for status checks
  keyGenerator: (req) => req.ip // Use req.ip for proper proxy support
});

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);

// --- Environment Configuration ---
const POLAPINE_API_KEY = process.env.POLAPINE_API_KEY;
const POLAPINE_API_SECRET = process.env.POLAPINE_API_SECRET;
const POLAPINE_API_KEY_B = process.env.POLAPINE_API_KEY_B;
const POLAPINE_API_SECRET_B = process.env.POLAPINE_API_SECRET_B;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const POLAPINE_BASE_URL = IS_PRODUCTION
  ? 'https://pay.polapine.com/api/v1'
  : 'https://pay.polapine.com/api/sandbox';

// Fail fast if keys are missing in production
if (!POLAPINE_API_KEY || !POLAPINE_API_SECRET) {
  console.warn('CRITICAL: POLAPINE API keys (A) are missing. Application may not function correctly.');
}
if (!POLAPINE_API_KEY_B || !POLAPINE_API_SECRET_B) {
  console.warn('WARNING: POLAPINE API keys (B) are missing. ecashapp3 endpoint will not work.');
}

// --- API Routes ---
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { amount, customer_name, customer_email, order_reference, payment_method } = req.body;

    // Strict Input Validation
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!customer_email || !customer_email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid customer email is required' });
    }

    const port = process.env.PORT || 3050;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    const invoiceData = {
      amount: parseFloat(amount),
      order_reference: order_reference || `ORD-${Date.now()}`,
      customer_name: customer_name || 'Customer',
      customer_email: customer_email,
      webhook_url: `${baseUrl}/webhook`,
      return_url: `${baseUrl}/success`,
      metadata: {
        created_at: new Date().toISOString(),
        source: 'checkout-prod'
      }
    };

    const response = await axios.post(
      `${POLAPINE_BASE_URL}/create-invoice`,
      invoiceData,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY,
          'X-API-Secret': POLAPINE_API_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout for production reliability
      }
    );

    const paymentData = response.data;
    const invoiceId = paymentData.data?.invoice?.invoice_id;
    
    if (!invoiceId) {
        throw new Error('Invoice ID missing from provider response');
    }

    const methodToUse = payment_method || 'ecashapp';
    const paymentUrl = `https://pay.polapine.com/${methodToUse}/${invoiceId}`;

    res.json({
      success: true,
      invoice_id: invoiceId,
      payment_url: paymentUrl,
      amount: paymentData.data.invoice.amount,
      status: paymentData.data.invoice.status,
      payment_method: methodToUse
    });

  } catch (error) {
    console.error('Invoice Creation Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: IS_PRODUCTION ? 'Failed to process payment request' : (error.response?.data?.message || error.message)
    });
  }
});

// --- Second Invoice Endpoint (Using API Key B) ---
app.post('/api/create-invoice-b', async (req, res) => {
  try {
    const { amount, customer_name, customer_email, order_reference, payment_method } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!customer_email || !customer_email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid customer email is required' });
    }
    if (!POLAPINE_API_KEY_B || !POLAPINE_API_SECRET_B) {
      return res.status(500).json({ success: false, message: 'API Key B not configured' });
    }

    const port = process.env.PORT || 3050;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    const invoiceData = {
      amount: parseFloat(amount),
      order_reference: order_reference || `ORD-${Date.now()}`,
      customer_name: customer_name || 'Customer',
      customer_email: customer_email,
      webhook_url: `${baseUrl}/webhook`,
      return_url: `${baseUrl}/success`,
      metadata: {
        created_at: new Date().toISOString(),
        source: 'checkout-prod-b'
      }
    };

    const response = await axios.post(
      `${POLAPINE_BASE_URL}/create-invoice`,
      invoiceData,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY_B,
          'X-API-Secret': POLAPINE_API_SECRET_B,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const paymentData = response.data;
    console.log('📊 Full Polapine Response (B):', JSON.stringify(paymentData, null, 2));

    const invoiceId = paymentData.data?.invoice?.invoice_id;

    if (!invoiceId) {
        console.error('❌ Invoice ID not found. Response structure:', paymentData);
        throw new Error(`Invoice ID missing from provider response. Got: ${JSON.stringify(paymentData)}`);
    }

    const methodToUse = payment_method || 'ecashapp3';
    const paymentUrl = `https://pay.polapine.com/${methodToUse}/${invoiceId}`;

    res.json({
      success: true,
      invoice_id: invoiceId,
      payment_url: paymentUrl,
      amount: paymentData.data.invoice.amount,
      status: paymentData.data.invoice.status,
      payment_method: methodToUse
    });

  } catch (error) {
    console.error('Invoice Creation Error (B):', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: IS_PRODUCTION ? 'Failed to process payment request' : (error.response?.data?.message || error.message)
    });
  }
});

// --- Webhook Handling (OpenNode) ---
app.post('/webhook', (req, res) => {
  const crypto = require('crypto');
  const event = req.body;
  const receivedHash = req.headers['hashed_order'];
  const OPENNODE_API_KEY = process.env.OPENNODE_API_KEY;

  console.log('🔔 [WEBHOOK] Received at', new Date().toISOString());
  console.log('   Charge ID:', event.id);
  console.log('   Status:', event.status);
  console.log('   Amount:', event.amount, event.currency);

  // Verify signature per OpenNode docs: hashed_order = HMAC-SHA256(charge_id, API_KEY)
  if (event.id && receivedHash && OPENNODE_API_KEY) {
    const expectedHash = crypto
      .createHmac('sha256', OPENNODE_API_KEY)
      .update(event.id)
      .digest('hex');

    if (expectedHash !== receivedHash) {
      console.error('❌ Webhook signature mismatch');
      return res.status(401).send('Invalid signature');
    }
    console.log('✅ Webhook signature verified');
  } else {
    console.warn('⚠️ Could not verify signature (missing headers/key)');
  }

  // Process the event
  if (event.status === 'paid' || event.status === 'completed') {
    console.log(`💰 Payment confirmed for charge ${event.id}`);
    console.log(`   Email: ${event.customer_email}`);
    console.log(`   Amount: ${event.amount} ${event.currency}`);
    // TODO: Update your database here
    // - Mark transaction as completed
    // - Send confirmation email
    sendAdminNotification(event);
    // - Trigger downstream actions
  } else if (event.status === 'expired') {
    console.log(`⏱️ Charge ${event.id} expired`);
  } else if (event.status === 'underpaid') {
    console.log(`⚠️ Charge ${event.id} underpaid`);
  }

  // Always return 200 quickly
  res.status(200).send('OK');
});

// GET route just to test if the webhook URL is reachable
app.get('/webhook', (req, res) => {
  res.send('Webhook endpoint is active. Use POST to send data.');
});

// --- Payment Invoice Details (for pay-invoice.html) ---
app.get('/api/get-invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const response = await axios.get(
      `${POLAPINE_BASE_URL}/invoices`,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY,
          'X-API-Secret': POLAPINE_API_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const invoiceData = response.data;

    if (!invoiceData.success || !invoiceData.data?.invoices) {
      return res.status(404).json({ success: false, message: 'Invoices not found' });
    }

    console.log('📋 Available invoices:', JSON.stringify(invoiceData.data.invoices, null, 2));
    console.log('🔍 Searching for invoiceId:', invoiceId);

    // Find the specific invoice
    const invoice = invoiceData.data.invoices.find(inv => inv.invoice_id === invoiceId);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.json({
      success: true,
      invoice: {
        invoice_id: invoice.invoice_id,
        amount: invoice.amount,
        status: invoice.status,
        created_at: invoice.created_at,
        expires_at: invoice.expires_at || new Date(new Date(invoice.created_at).getTime() + 3600000).toISOString()
      },
      payment_url: `https://pay.polapine.com/pay/@cashapppro/${invoiceId}?amount=${invoice.amount}`
    });

  } catch (error) {
    console.error('Get Invoice Error:', error.response?.status, error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' });
  }
});

// --- Check Payment Status ---
app.get('/api/check-payment/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const response = await axios.get(
      `${POLAPINE_BASE_URL}/invoices`,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY,
          'X-API-Secret': POLAPINE_API_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const invoiceData = response.data;

    if (!invoiceData.success || !invoiceData.data?.invoices) {
      return res.json({ paid: false, status: 'error' });
    }

    const invoice = invoiceData.data.invoices.find(inv => inv.invoice_id === invoiceId);

    if (!invoice) {
      return res.json({ paid: false, status: 'not_found' });
    }

    const isPaid = invoice.status === 'completed' || invoice.status === 'paid';

    res.json({
      success: true,
      paid: isPaid,
      status: invoice.status,
      invoice_id: invoiceId
    });

  } catch (error) {
    console.error('Check Payment Error:', error.message);
    res.json({ paid: false, status: 'error' });
  }
});

// --- Admin Panel ---
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const adminSessions = new Set();

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = require('crypto').randomBytes(32).toString('hex');
    adminSessions.add(token);
    // Auto-expire token after 24 hours
    setTimeout(() => adminSessions.delete(token), 24 * 60 * 60 * 1000);
    console.log('✅ Admin login successful');
    return res.json({ success: true, token });
  }
  console.warn('❌ Admin login failed');
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Admin auth middleware
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// Admin: List all OpenNode charges
app.get('/api/admin/charges', requireAdmin, async (req, res) => {
  try {
    const OPENNODE_API_KEY = process.env.OPENNODE_API_KEY;
    if (!OPENNODE_API_KEY) {
      return res.status(500).json({ success: false, message: 'OPENNODE_API_KEY not configured' });
    }

    const OPENNODE_API_URL = 'https://api.opennode.com/v1';
    console.log('📊 [ADMIN] Fetching all charges from OpenNode...');

    const response = await axios.get(`${OPENNODE_API_URL}/charges`, {
      headers: {
        'Authorization': OPENNODE_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const charges = response.data?.data || [];
    console.log(`📊 [ADMIN] Retrieved ${charges.length} charges`);
    if (charges.length > 0) {
      const sample = charges[0];
      console.log('📊 [ADMIN] Sample charge fields:', JSON.stringify({
        id: sample.id, amount: sample.amount, source_fiat_value: sample.source_fiat_value,
        fiat_value: sample.fiat_value, currency: sample.currency, status: sample.status
      }));
    }

    res.json({ success: true, charges });
  } catch (error) {
    console.error('❌ [ADMIN] Fetch charges error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to fetch charges from OpenNode',
      debug: IS_PRODUCTION ? undefined : error.message
    });
  }
});

// Admin: Logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.json({ success: true });
});

// Serve Admin Panel
app.get('/admin', (_req, res) => res.sendFile(__dirname + '/public/admin.html'));

// --- Payment Checkout Pages ---
app.get('/payme', (_req, res) => res.sendFile(__dirname + '/public/payme.html'));
app.get('/cashapp', (_req, res) => res.sendFile(__dirname + '/public/cashapp.html'));
app.get('/applepay', (_req, res) => res.sendFile(__dirname + '/public/applepay.html'));

// --- Payment Invoice Router (Polapine or OpenNode) ---
app.get('/pay/invoice/:id', (req, res, next) => {
  const { id } = req.params;
  const method = req.query.method;

  // If it has a method param, it's a Polapine invoice → proxy to Polapine
  if (method) {
    req.url = `/${method}/${id}`;
    console.log(`[PROXY] Polapine invoice: ${method}/${id}`);
    return proxy('https://pay.polapine.com', {
      proxyReqPathResolver: () => req.url
    })(req, res, next);
  }

  // Otherwise it's an OpenNode charge → serve custom payment page
  console.log(`[CUSTOM] OpenNode payment page: ${id}`);
  return res.sendFile(__dirname + '/public/demodesign.html');
});

// --- OpenNode Get Charge Details ---
app.get('/api/get-charge/:chargeId', async (req, res) => {
  try {
    const { chargeId } = req.params;
    const OPENNODE_API_KEY = process.env.OPENNODE_API_KEY;
    const OPENNODE_API_URL = 'https://api.opennode.com/v1';

    console.log(`📦 Fetching charge: ${chargeId}`);
    console.log(`🔑 API Key exists: ${!!OPENNODE_API_KEY}`);

    const response = await axios.get(
      `${OPENNODE_API_URL}/charges/${chargeId}`,
      {
        headers: {
          'Authorization': `${OPENNODE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log(`✅ OpenNode response:`, JSON.stringify(response.data, null, 2));

    const chargeData = response.data?.data;
    if (!chargeData) {
      console.error('❌ No charge data in response');
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    console.log('🔍 Full chargeData:', JSON.stringify(chargeData, null, 2));

    res.json({
      success: true,
      status: chargeData.status,
      uri: chargeData.uri,
      address: chargeData.address,
      lightning_invoice: chargeData.lightning_invoice?.payreq || null,
      amount: chargeData.fiat_value || chargeData.source_fiat_value,
      currency: chargeData.currency || 'USD',
      ttl: chargeData.ttl || 3600
    });
  } catch (error) {
    console.error('❌ Get Charge Error:', error.response?.status, error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch charge', debug: error.message });
  }
});

// --- OpenNode Check Payment Status ---
app.get('/api/check-charge/:chargeId', async (req, res) => {
  try {
    const { chargeId } = req.params;
    const OPENNODE_API_KEY = process.env.OPENNODE_API_KEY;
    const OPENNODE_API_URL = 'https://api.opennode.com/v1';

    const response = await axios.get(
      `${OPENNODE_API_URL}/charges/${chargeId}`,
      {
        headers: {
          'Authorization': `${OPENNODE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const chargeData = response.data?.data;
    if (!chargeData) {
      return res.json({ paid: false, status: 'not_found' });
    }

    const isPaid = chargeData.status === 'paid' || chargeData.status === 'completed';
    
    if (isPaid) {
      sendAdminNotification(chargeData);
    }

    res.json({
      success: true,
      paid: isPaid,
      status: chargeData.status
    });
  } catch (error) {
    console.error('Check Charge Error:', error.message);
    res.json({ paid: false, status: 'error' });
  }
});


// --- Test Email Route (Temporary) ---
app.get('/api/admin/test-email', async (req, res) => {
  console.log('📧 Manual email test triggered...');
  const testCharge = {
    id: 'TEST-12345',
    status: 'paid',
    fiat_value: 5000, // $50.00
    description: 'TEST NOTIFICATION',
    customer_email: 'test@example.com'
  };
  
  // Clear from set so we can test multiple times
  sentEmails.delete(testCharge.id);
  
  await sendAdminNotification(testCharge);
  res.send('Test email triggered! Check your inbox (and Spam). If it fails, check Render logs.');
});

// --- Proxy all Polapine assets and API calls ---
app.use((req, res, next) => {
  // Don't proxy our own API routes
  if (req.path.startsWith('/api/create-invoice') ||
      req.path.startsWith('/api/get-invoice') ||
      req.path.startsWith('/api/check-payment') ||
      req.path.startsWith('/api/admin') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/webhook')) {
    return next();
  }

  // Proxy everything else to Polapine
  proxy('https://pay.polapine.com', {
    proxyReqPathResolver: (req) => req.url
  })(req, res, next);
});


// --- Static Pages ---
app.get('/success', (_req, res) => res.sendFile(__dirname + '/public/success.html'));
app.get('/failed', (_req, res) => res.sendFile(__dirname + '/public/failed.html'));

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`\x1b[32m%s\x1b[0m`, `>>> Production server running on port ${PORT}`);
  console.log(`>>> Mode: ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX/DEV'}`);
});
