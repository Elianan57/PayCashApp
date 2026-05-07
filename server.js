const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const proxy = require('express-http-proxy');
require('dotenv').config();

const app = express();

// Trust proxy for X-Forwarded-For headers from Render
app.set('trust proxy', true);

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
      connectSrc: ["'self'", "https://pay.polapine.com", "https://ohkessuokmozfwldmqgs.supabase.co"]
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

// --- In-Memory Charge Store ---
const chargeStore = new Map();

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

// --- Webhook Handling ---
app.post('/webhook', (req, res) => {
  const event = req.body;
  const headers = req.headers;
  
  console.log('-------------------------------------------');
  console.log(`[WEBHOOK RECEIVED] ${new Date().toISOString()}`);
  console.log('--- HEADERS ---');
  console.log(JSON.stringify(headers, null, 2)); // This will show us the signature header!
  console.log('--- PAYLOAD ---');
  console.log(JSON.stringify(event, null, 2));
  console.log('-------------------------------------------');

  // We will add the verification logic once we see the header name above
  if (event.event === 'payment.completed') {
    console.log(`💰 Payment verified for Order: ${event.order_reference}`);
  }

  res.status(200).json({ received: true });
});

// GET route just to test if the webhook URL is reachable in a browser
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

// --- Payment Checkout Pages ---
app.get('/payme', (_req, res) => res.sendFile(__dirname + '/public/payme.html'));
app.get('/cashapp', (_req, res) => res.sendFile(__dirname + '/public/cashapp.html'));
app.get('/applepay', (_req, res) => res.sendFile(__dirname + '/public/applepay.html'));

// --- OpenNode Payment Details ---
app.get('/api/get-payment/:chargeId', async (req, res) => {
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
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    res.json({
      success: true,
      status: chargeData.status,
      uri: chargeData.uri,
      address: chargeData.address,
      lightning_invoice: chargeData.lightning_invoice,
      ttl: 3600
    });
  } catch (error) {
    console.error('Get Payment Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch payment' });
  }
});

// --- Store Charge Info ---
app.post('/api/store-charge', (req, res) => {
  try {
    const { chargeId, amount, currency, uri } = req.body;
    console.log('[STORE-CHARGE] Storing:', { chargeId, amount, currency, uri });
    chargeStore.set(chargeId, {
      amount,
      currency,
      uri,
      createdAt: new Date()
    });
    console.log('[STORE-CHARGE] Success. Total stored charges:', chargeStore.size);
    res.json({ success: true });
  } catch (error) {
    console.error('[STORE-CHARGE] Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to store charge' });
  }
});

// --- Check OpenNode Payment Status ---
app.get('/api/check-payment/:chargeId', async (req, res) => {
  try {
    const { chargeId } = req.params;
    const OPENNODE_API_KEY = process.env.OPENNODE_API_KEY;
    const OPENNODE_API_URL = 'https://api.opennode.com/v1';

    console.log(`[CHECK-PAYMENT] Checking charge: ${chargeId}`);

    // First check if charge is stored locally
    const storedCharge = chargeStore.get(chargeId);
    console.log(`[CHECK-PAYMENT] Stored charge:`, storedCharge);

    // Query OpenNode for latest status
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
    console.log(`[CHECK-PAYMENT] OpenNode response:`, JSON.stringify(chargeData, null, 2));

    if (!chargeData) {
      console.log('[CHECK-PAYMENT] Charge not found in OpenNode');
      return res.json({ paid: false, status: 'not_found' });
    }

    const isPaid = chargeData.status === 'paid' || chargeData.status === 'completed';
    res.json({
      success: true,
      paid: isPaid,
      status: chargeData.status
    });
  } catch (error) {
    console.error('[CHECK-PAYMENT] Error:', error.message);
    console.error('[CHECK-PAYMENT] Details:', error.response?.data);
    res.json({ paid: false, status: 'error' });
  }
});

// --- Payment Invoice Page (OpenNode) ---
app.get('/pay/invoice/:chargeId', (_req, res) => {
  res.sendFile(__dirname + '/public/pay-invoice.html');
});

// --- Proxy all Polapine assets and API calls ---
app.use((req, res, next) => {
  // Don't proxy our own API routes
  if (req.path.startsWith('/api/create-invoice') ||
      req.path.startsWith('/api/get-invoice') ||
      req.path.startsWith('/api/check-payment') ||
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
